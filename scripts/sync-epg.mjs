#!/usr/bin/env node
/**
 * sync-epg.mjs — baixa fontes EPG e gera XML consolidado dos nossos canais
 *
 * Funciona igual ao sync-logos.mjs:
 *   - Lê epg_url_presets do Postgres (URLs salvas no admin)
 *   - Baixa cada XML para public/epg/sources/<slug>.xml
 *   - Lê public.channels e gera public/epg/lntv.xml só com nossos canais
 *
 * Uso:
 *   node scripts/sync-epg.mjs                 # ciclo completo
 *   node scripts/sync-epg.mjs --consolidate   # só regenera lntv.xml (sem rebaixar)
 *   node scripts/sync-epg.mjs --force         # ignora cache de modificação
 *
 * Cron sugerido (a cada 3h):
 *   0 *\/3 * * *  cd /opt/lntv-frontend && node scripts/sync-epg.mjs >> /var/log/lntv-epg-sync.log 2>&1
 */

import { mkdir, writeFile, readFile, stat, readdir, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROJECT_ROOT = join(__dirname, "..");
const EPG_DIR = join(PROJECT_ROOT, "public", "epg");
const SOURCES_DIR = join(EPG_DIR, "sources");
const CONSOLIDATED_PATH = join(EPG_DIR, "lntv.xml");
const FETCH_TIMEOUT_MS = 90_000;

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
const CONSOLIDATE_ONLY = args.includes("--consolidate");

let psqlMode = process.env.PSQL_MODE || "auto";
const log = (...a) => console.log(new Date().toISOString(), ...a);

function run(cmd, cmdArgs, options = {}) {
  return execFileSync(cmd, cmdArgs, { encoding: "utf8", maxBuffer: 200 * 1024 * 1024, ...options });
}
function dockerComposePsql(sql) {
  return run("docker", [
    "compose", "--env-file", `${STACK_DIR}/.env`, "-f", `${STACK_DIR}/docker-compose.yml`,
    "exec", "-T", DB_SERVICE, "psql", "-U", DB_USER, "-d", DB_NAME,
    "-At", "-F", "\t", "-c", sql,
  ]);
}
function directPsql(sql) {
  if (!DATABASE_URL) throw new Error("Faltou DATABASE_URL ou POSTGRES_PASSWORD");
  return run("psql", [DATABASE_URL, "-At", "-F", "\t", "-c", sql]);
}
function hasDockerCompose() {
  return spawnSync("docker", ["compose", "version"], { encoding: "utf8" }).status === 0;
}
function psql(sql) {
  if (psqlMode === "docker") return dockerComposePsql(sql);
  if (psqlMode === "direct") return directPsql(sql);
  if (DB_HOST === "db" && hasDockerCompose()) { psqlMode = "docker"; return dockerComposePsql(sql); }
  try { psqlMode = "direct"; return directPsql(sql); }
  catch (e1) {
    if (hasDockerCompose()) {
      try { psqlMode = "docker"; return dockerComposePsql(sql); }
      catch (e2) { throw new Error(`${e1.message}\nDocker fallback: ${e2.message}`); }
    }
    throw e1;
  }
}

async function fileExists(p) { try { await stat(p); return true; } catch { return false; } }

function urlToSlug(url) {
  // hash curto + nome legível
  const h = createHash("sha1").update(url).digest("hex").slice(0, 8);
  const name = url
    .replace(/^https?:\/\//, "")
    .replace(/\/+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .slice(-60);
  return `${name}-${h}.xml`;
}

function looksLikeXmltv(text) {
  if (!text || text.length < 20) return false;
  const head = text.slice(0, 2048).toLowerCase();
  if (head.includes("<!doctype html") || head.includes("<html")) return false;
  if (/^\s*<span/i.test(text)) return false;
  return head.includes("<tv") || head.includes("<channel") || head.includes("<programme");
}

async function fetchOnce(url, browserLike) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  const headers = browserLike
    ? {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Accept: "*/*",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
      }
    : {
        "User-Agent": "Mozilla/5.0 (compatible; LNTV-EPG-Sync/1.0)",
        Accept: "application/xml, text/xml, */*",
      };
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers, redirect: "follow" });
    if (!res.ok) { log(`   HTTP ${res.status} ${res.statusText}`); return null; }
    return await res.text();
  } catch (e) {
    log(`   fetch error: ${e.message}`);
    return null;
  } finally { clearTimeout(t); }
}

async function downloadXml(url) {
  let text = await fetchOnce(url, false);
  if (!text || !looksLikeXmltv(text)) {
    if (text) log(`   resposta não-XMLTV (1ª) — primeiros 200: ${text.slice(0, 200)}`);
    await new Promise((r) => setTimeout(r, 1500));
    text = await fetchOnce(url, true);
  }
  if (!text || !looksLikeXmltv(text)) {
    if (text) log(`   resposta não-XMLTV (2ª) — primeiros 200: ${text.slice(0, 200)}`);
    return null;
  }
  return text;
}

function fetchPresets() {
  const sql = `SELECT url FROM public.epg_url_presets WHERE epg_type = 'xmltv' ORDER BY name`;
  const raw = psql(sql).trim();
  if (!raw) return [];
  return raw.split("\n").map((u) => u.trim()).filter(Boolean);
}

function fetchOurChannels() {
  // Só canais XMLTV ativos com epg_channel_id e epg_url preenchidos
  const sql = `
    SELECT id, name, channel_number, epg_url, epg_channel_id, COALESCE(logo_url,'')
    FROM public.channels
    WHERE is_active = true
      AND epg_channel_id IS NOT NULL AND epg_channel_id <> ''
      AND epg_url IS NOT NULL AND epg_url <> ''
      AND (epg_type IS NULL OR epg_type IN ('xmltv','iptv_epg_org','open_epg','github_xml'))
    ORDER BY channel_number ASC
  `;
  const raw = psql(sql).trim();
  if (!raw) return [];
  return raw.split("\n").map((line) => {
    const [id, name, channel_number, epg_url, epg_channel_id, logo_url] = line.split("\t");
    return { id, name, channel_number: parseInt(channel_number, 10), epg_url, epg_channel_id, logo_url };
  });
}

async function syncSources(presetUrls) {
  await mkdir(SOURCES_DIR, { recursive: true });
  const slugByUrl = new Map();
  const stats = { downloaded: 0, kept: 0, failed: 0 };

  for (const url of presetUrls) {
    const slug = urlToSlug(url);
    slugByUrl.set(url, slug);
    const dest = join(SOURCES_DIR, slug);

    if (!FORCE && await fileExists(dest)) {
      const st = await stat(dest);
      const ageMin = (Date.now() - st.mtimeMs) / 60_000;
      if (ageMin < 150) { // arquivo com < 2h30 → mantém
        log(`✓ ${slug} (cache ${Math.round(ageMin)}min)`);
        stats.kept++;
        continue;
      }
    }

    log(`⬇  ${url}`);
    const text = await downloadXml(url);
    if (!text) {
      log(`✗ falhou: ${url}`);
      stats.failed++;
      continue;
    }
    await writeFile(dest, text, "utf8");
    log(`✓ ${slug} (${(text.length / 1024 / 1024).toFixed(1)} MB)`);
    stats.downloaded++;
  }

  // Limpa arquivos órfãos (URLs removidas do admin)
  const validSlugs = new Set(slugByUrl.values());
  try {
    const files = await readdir(SOURCES_DIR);
    for (const f of files) {
      if (!f.endsWith(".xml")) continue;
      if (!validSlugs.has(f)) {
        await unlink(join(SOURCES_DIR, f));
        log(`🗑  removido órfão: ${f}`);
      }
    }
  } catch {}

  log(`📊 fontes: ${stats.downloaded} baixadas, ${stats.kept} cache, ${stats.failed} falhas`);
  return slugByUrl;
}

function escapeXml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Extrai <channel id="..."> e <programme channel="..."> de `xml` para os IDs em `wanted`. */
function extractFromXml(xml, wantedIds) {
  const channelOut = [];
  const progOut = [];
  const wanted = new Set(wantedIds);
  const wantedLower = new Set(wantedIds.map((id) => id.toLowerCase()));
  const matches = (id) => wanted.has(id) || wantedLower.has(id.toLowerCase());

  const channelRe = /<channel\b[^>]*\bid\s*=\s*"([^"]+)"[^>]*>[\s\S]*?<\/channel>/g;
  let m;
  const seenChannel = new Set();
  while ((m = channelRe.exec(xml)) !== null) {
    if (matches(m[1]) && !seenChannel.has(m[1])) {
      seenChannel.add(m[1]);
      channelOut.push({ id: m[1], xml: m[0] });
    }
  }

  const progRe = /<programme\b[^>]*\bchannel\s*=\s*"([^"]+)"[^>]*>[\s\S]*?<\/programme>/g;
  while ((m = progRe.exec(xml)) !== null) {
    if (matches(m[1])) progOut.push(m[0]);
  }

  return { channels: channelOut, programmes: progOut };
}

async function consolidate(slugByUrl) {
  const channels = fetchOurChannels();
  log(`📺 canais nossos com EPG: ${channels.length}`);

  // Agrupa por URL → IDs que precisamos buscar nessa URL
  const wantedByUrl = new Map();
  for (const ch of channels) {
    if (!slugByUrl.has(ch.epg_url)) {
      // Canal aponta pra URL que não está em epg_url_presets — ignora silenciosamente
      // (admin pode digitar URL solta; nesse caso o sistema cai no proxy remoto)
      continue;
    }
    let arr = wantedByUrl.get(ch.epg_url);
    if (!arr) { arr = []; wantedByUrl.set(ch.epg_url, arr); }
    arr.push(ch.epg_channel_id);
  }

  // Acumula <channel> e <programme> filtrados de cada fonte
  const allChannelXml = new Map(); // id → xml
  const allProgrammeXml = [];

  for (const [url, ids] of wantedByUrl) {
    const slug = slugByUrl.get(url);
    const path = join(SOURCES_DIR, slug);
    if (!await fileExists(path)) {
      log(`⚠  fonte ausente: ${slug}`);
      continue;
    }
    const xml = await readFile(path, "utf8");
    const { channels: ch, programmes: pr } = extractFromXml(xml, ids);
    log(`   ${slug}: ${ch.length} canais, ${pr.length} programas`);
    for (const c of ch) if (!allChannelXml.has(c.id)) allChannelXml.set(c.id, c.xml);
    for (const p of pr) allProgrammeXml.push(p);
  }

  // Adiciona metadados dos nossos canais (display-name + icon do nosso logo, se houver)
  // Para canais sem entry no XML original (ex: canal só com logo nosso), cria <channel> mínimo.
  const ourChannelMeta = [];
  for (const ch of channels) {
    if (allChannelXml.has(ch.epg_channel_id)) continue;
    const icon = ch.logo_url ? `<icon src="${escapeXml(ch.logo_url)}"/>` : "";
    ourChannelMeta.push(
      `<channel id="${escapeXml(ch.epg_channel_id)}"><display-name>${escapeXml(ch.name)}</display-name>${icon}</channel>`
    );
  }

  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<!-- LN TV consolidated EPG · generated ${new Date().toISOString()} · ${channels.length} channels -->`,
    '<tv generator-info-name="lntv-sync-epg">',
    ...allChannelXml.values(),
    ...ourChannelMeta,
    ...allProgrammeXml,
    '</tv>',
  ].join("\n");

  await mkdir(EPG_DIR, { recursive: true });
  await writeFile(CONSOLIDATED_PATH, out, "utf8");
  log(`✅ ${CONSOLIDATED_PATH} — ${(out.length / 1024).toFixed(1)} KB · ${allChannelXml.size + ourChannelMeta.length} canais · ${allProgrammeXml.length} programas`);
}

async function main() {
  log("🚀 sync-epg iniciando…");
  log(`   destino: ${EPG_DIR}`);
  if (FORCE) log("   modo: --force");
  if (CONSOLIDATE_ONLY) log("   modo: --consolidate (sem download)");

  try { psql("SELECT 1"); log(`   Postgres: ${psqlMode}`); }
  catch (e) { console.error("❌ Postgres falhou:", e.message); process.exit(2); }

  let slugByUrl;
  if (CONSOLIDATE_ONLY) {
    // Reconstrói o mapa só pelas URLs do banco (arquivos já estão em disco)
    const presets = fetchPresets();
    slugByUrl = new Map(presets.map((u) => [u, urlToSlug(u)]));
  } else {
    const presets = fetchPresets();
    log(`   URLs salvas: ${presets.length}`);
    slugByUrl = await syncSources(presets);
  }

  await consolidate(slugByUrl);
  log("✨ pronto.");
}

main().catch((e) => { console.error("❌ erro fatal:", e); process.exit(99); });
