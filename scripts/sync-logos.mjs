#!/usr/bin/env node
/**
 * sync-logos.mjs (v4 — direto no Postgres self-hosted, sem Cloud)
 *
 * Lê canais ativos do Postgres self-hosted, baixa cada logo externa,
 * redimensiona, salva em public/logos/<n>.png e atualiza logo_url no banco
 * para /logos/<n>.png?v=<epoch>.
 *
 * Funciona de dois jeitos:
 *   1) psql direto, quando o banco está acessível pelo host
 *   2) docker compose exec db psql, quando POSTGRES_HOST=db só existe dentro do Docker
 *
 * Uso:
 *   node scripts/sync-logos.mjs
 *   node scripts/sync-logos.mjs --force
 *   node scripts/sync-logos.mjs --channel 5
 */

import { mkdir, writeFile, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROJECT_ROOT = join(__dirname, "..");
const LOGOS_DIR = join(PROJECT_ROOT, "public", "logos");
const LOGO_SIZE = 200;
const FETCH_TIMEOUT_MS = 15_000;
const STACK_DIR = process.env.LNTV_STACK_DIR || "/opt/lntv";
const DB_SERVICE = process.env.POSTGRES_DOCKER_SERVICE || "db";

const DB_USER = process.env.POSTGRES_USER || "postgres";
const DB_NAME = process.env.POSTGRES_DB || "postgres";
const DB_HOST = process.env.POSTGRES_HOST || "localhost";
const DB_PORT = process.env.POSTGRES_PORT || "5432";
const DB_PASSWORD = process.env.POSTGRES_PASSWORD || "";

let DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL && DB_PASSWORD) {
  DATABASE_URL = `postgres://${DB_USER}:${encodeURIComponent(DB_PASSWORD)}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;
}

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const channelArgIdx = args.indexOf("--channel");
const SINGLE_CHANNEL = channelArgIdx >= 0 ? parseInt(args[channelArgIdx + 1], 10) : null;

let psqlMode = process.env.PSQL_MODE || "auto";
const log = (...a) => console.log(new Date().toISOString(), ...a);
const isLocalLogo = (url) => !!url && url.startsWith("/logos/");

function run(cmd, cmdArgs, options = {}) {
  return execFileSync(cmd, cmdArgs, {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    ...options,
  });
}

function dockerComposePsql(sql) {
  return run("docker", [
    "compose",
    "--env-file", `${STACK_DIR}/.env`,
    "-f", `${STACK_DIR}/docker-compose.yml`,
    "exec", "-T", DB_SERVICE,
    "psql", "-U", DB_USER, "-d", DB_NAME,
    "-At", "-F", "\t", "-c", sql,
  ]);
}

function directPsql(sql) {
  if (!DATABASE_URL) {
    throw new Error("Faltou DATABASE_URL ou POSTGRES_PASSWORD para conectar direto no Postgres.");
  }
  return run("psql", [DATABASE_URL, "-At", "-F", "\t", "-c", sql]);
}

function hasDockerCompose() {
  const result = spawnSync("docker", ["compose", "version"], { encoding: "utf8" });
  return result.status === 0;
}

function psql(sql) {
  if (psqlMode === "docker") return dockerComposePsql(sql);
  if (psqlMode === "direct") return directPsql(sql);

  if (DB_HOST === "db" && hasDockerCompose()) {
    psqlMode = "docker";
    return dockerComposePsql(sql);
  }

  try {
    psqlMode = "direct";
    return directPsql(sql);
  } catch (directError) {
    if (hasDockerCompose()) {
      try {
        psqlMode = "docker";
        log("   psql direto falhou; tentando via Docker Compose…");
        return dockerComposePsql(sql);
      } catch (dockerError) {
        throw new Error(`${directError.message}\nDocker Compose também falhou: ${dockerError.message}`);
      }
    }
    throw directError;
  }
}

function sqlEscape(s) {
  if (s === null || s === undefined) return "NULL";
  return `'${String(s).replace(/'/g, "''")}'`;
}

async function downloadAndResize(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return await sharp(buf)
      .resize(LOGO_SIZE, LOGO_SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toBuffer();
  } finally {
    clearTimeout(t);
  }
}

async function fileExists(p) { try { await stat(p); return true; } catch { return false; } }

function fetchChannels() {
  const sql = `
    SELECT channel_number, name, COALESCE(logo_url, ''),
           EXTRACT(EPOCH FROM updated_at)::bigint
    FROM public.channels
    WHERE is_active = true
    ORDER BY channel_number ASC
  `;
  const raw = psql(sql).trim();
  if (!raw) return [];
  return raw.split("\n").map((line) => {
    const [channel_number, name, logo_url, epoch] = line.split("\t");
    return {
      channel_number: parseInt(channel_number, 10),
      name,
      logo_url: logo_url || null,
      updated_at_epoch: parseInt(epoch, 10) * 1000,
    };
  });
}

function updateChannelLogo(channel_number, version) {
  const newUrl = `/logos/${channel_number}.png?v=${version}`;
  const sql = `UPDATE public.channels SET logo_url = ${sqlEscape(newUrl)} WHERE channel_number = ${channel_number}`;
  psql(sql);
}

async function main() {
  log("🚀 Sync de logos iniciando (self-hosted, sem Cloud)…");
  log(`   Pasta destino: ${LOGOS_DIR}`);
  log(`   Stack Docker: ${STACK_DIR}`);
  if (FORCE) log("   Modo: --force");
  if (SINGLE_CHANNEL !== null) log(`   Filtro: --channel ${SINGLE_CHANNEL}`);

  try {
    psql("SELECT 1");
    log(`   Conexão Postgres: ${psqlMode}`);
  } catch (e) {
    console.error("❌ Falha ao conectar no Postgres:", e.message);
    console.error("   Se o serviço não se chama 'db', rode com POSTGRES_DOCKER_SERVICE=nome_do_servico.");
    process.exit(2);
  }

  await mkdir(LOGOS_DIR, { recursive: true });

  let channels = fetchChannels();
  if (SINGLE_CHANNEL !== null) channels = channels.filter((c) => c.channel_number === SINGLE_CHANNEL);

  log(`   Canais ativos: ${channels.length}`);

  const summary = { synced: 0, unchanged: 0, skipped: 0, versionBumped: 0, error: 0 };

  for (const ch of channels) {
    const { channel_number, name, logo_url, updated_at_epoch } = ch;
    if (!logo_url) { log(`⏭  #${channel_number} ${name} — sem logo_url`); summary.skipped++; continue; }

    const localPath = join(LOGOS_DIR, `${channel_number}.png`);
    const version = updated_at_epoch;
    const versionedUrl = `/logos/${channel_number}.png?v=${version}`;

    if (!FORCE && isLocalLogo(logo_url) && (await fileExists(localPath))) {
      if (logo_url === versionedUrl) { summary.unchanged++; continue; }
      try {
        updateChannelLogo(channel_number, version);
        summary.versionBumped++;
        log(`🔄 #${channel_number} ${name} — version bump`);
      } catch (e) {
        log(`❌ #${channel_number} ${name} — update falhou: ${e.message}`);
        summary.error++;
      }
      continue;
    }

    if (isLocalLogo(logo_url)) {
      if (await fileExists(localPath)) { summary.unchanged++; continue; }
      log(`⚠️  #${channel_number} ${name} — URL local, arquivo sumiu, sem fonte externa`);
      summary.error++;
      continue;
    }

    try {
      log(`⬇️  #${channel_number} ${name} — baixando ${logo_url}`);
      const buf = await downloadAndResize(logo_url);
      await writeFile(localPath, buf);
      updateChannelLogo(channel_number, version);
      summary.synced++;
      log(`✅ #${channel_number} ${name} — salvo`);
    } catch (e) {
      log(`❌ #${channel_number} ${name} — ${e.message}`);
      summary.error++;
    }
  }

  log("📊 Resumo:", summary);
  log("✨ Pronto.");
}

main().catch((e) => { console.error("❌ Erro fatal:", e); process.exit(99); });
