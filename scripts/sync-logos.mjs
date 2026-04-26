#!/usr/bin/env node
/**
 * sync-logos.mjs (v3 — direto no Postgres self-hosted, sem Cloud)
 *
 * Lê canais ativos direto do Postgres local (via psql), baixa cada logo externa,
 * redimensiona, salva em public/logos/<n>.png e atualiza logo_url no banco
 * para /logos/<n>.png?v=<epoch>.
 *
 * Requisitos:
 *   - psql instalado e acessível
 *   - Variáveis de conexão no /opt/lntv/.env (POSTGRES_PASSWORD, etc.)
 *     ou variável DATABASE_URL exportada.
 *
 * Por padrão tenta:
 *   DATABASE_URL  (se setada)
 *   ou monta: postgres://postgres:$POSTGRES_PASSWORD@localhost:5432/postgres
 *
 * Uso:
 *   node scripts/sync-logos.mjs
 *   node scripts/sync-logos.mjs --force
 *   node scripts/sync-logos.mjs --channel 5
 *   DATABASE_URL=postgres://... node scripts/sync-logos.mjs
 */

import { mkdir, writeFile, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROJECT_ROOT = join(__dirname, "..");
const LOGOS_DIR = join(PROJECT_ROOT, "public", "logos");
const LOGO_SIZE = 200;
const FETCH_TIMEOUT_MS = 15_000;

// Monta DATABASE_URL se não foi fornecida
let DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  const pwd = process.env.POSTGRES_PASSWORD;
  const host = process.env.POSTGRES_HOST || "localhost";
  const port = process.env.POSTGRES_PORT || "5432";
  const db = process.env.POSTGRES_DB || "postgres";
  const user = process.env.POSTGRES_USER || "postgres";
  if (!pwd) {
    console.error("❌ Faltou DATABASE_URL ou POSTGRES_PASSWORD.");
    console.error("   Carregue o env do stack self-hosted antes de rodar:");
    console.error("     set -a && . /opt/lntv/.env && set +a");
    console.error("   E rode de novo: node scripts/sync-logos.mjs");
    process.exit(1);
  }
  DATABASE_URL = `postgres://${user}:${encodeURIComponent(pwd)}@${host}:${port}/${db}`;
}

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const channelArgIdx = args.indexOf("--channel");
const SINGLE_CHANNEL = channelArgIdx >= 0 ? parseInt(args[channelArgIdx + 1], 10) : null;

const log = (...a) => console.log(new Date().toISOString(), ...a);
const isLocalLogo = (url) => !!url && url.startsWith("/logos/");

function psql(sql) {
  // Executa SQL via psql e retorna stdout como string
  const out = execFileSync("psql", [DATABASE_URL, "-At", "-F", "\t", "-c", sql], {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  return out;
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
      updated_at_epoch: parseInt(epoch, 10) * 1000, // ms
    };
  });
}

function updateChannelLogo(channel_number, version) {
  const newUrl = `/logos/${channel_number}.png?v=${version}`;
  const sql = `UPDATE public.channels SET logo_url = ${sqlEscape(newUrl)} WHERE channel_number = ${channel_number}`;
  psql(sql);
}

async function main() {
  log("🚀 Sync de logos iniciando (modo self-hosted, direto no Postgres)…");
  log(`   Pasta destino: ${LOGOS_DIR}`);
  if (FORCE) log("   Modo: --force");
  if (SINGLE_CHANNEL !== null) log(`   Filtro: --channel ${SINGLE_CHANNEL}`);

  // testa conexão
  try {
    psql("SELECT 1");
  } catch (e) {
    console.error("❌ Falha ao conectar no Postgres:", e.message);
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
