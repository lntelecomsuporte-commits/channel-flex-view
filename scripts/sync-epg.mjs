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
const CONSOLIDATED_JSON_PATH = join(EPG_DIR, "lntv.json");
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

async function fetchOnce(url, browserLike, extraHeaders) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  const headers = browserLike
    ? {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Accept: "*/*",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        ...(extraHeaders || {}),
      }
    : {
        "User-Agent": "Mozilla/5.0 (compatible; LNTV-EPG-Sync/1.0)",
        Accept: "application/xml, text/xml, */*",
        ...(extraHeaders || {}),
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

/** URLs avulsas: canais que apontam pra uma epg_url que NÃO está em epg_url_presets. */
function fetchChannelEpgUrls() {
  const sql = `
    SELECT DISTINCT c.epg_url
    FROM public.channels c
    WHERE c.is_active = true
      AND c.epg_url IS NOT NULL AND c.epg_url <> ''
      AND c.epg_channel_id IS NOT NULL AND c.epg_channel_id <> ''
      AND (c.epg_type IS NULL OR c.epg_type IN ('xmltv','iptv_epg_org','open_epg','github_xml'))
  `;
  const raw = psql(sql).trim();
  if (!raw) return [];
  return raw.split("\n").map((u) => u.trim()).filter(Boolean);
}

/** Une presets + URLs avulsas dos canais (deduplicado, preserva ordem). */
function fetchAllEpgUrls() {
  const seen = new Set();
  const out = [];
  for (const u of fetchPresets()) { if (!seen.has(u)) { seen.add(u); out.push(u); } }
  let extras = 0;
  for (const u of fetchChannelEpgUrls()) {
    if (!seen.has(u)) { seen.add(u); out.push(u); extras++; }
  }
  if (extras > 0) log(`   + ${extras} URL(s) avulsa(s) de canais (sem preset)`);
  return out;
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

/* ───────────────────────── InnovaTV (API JSON) ───────────────────────── */

const INNOVATV_BASE_URL = "https://api.innovatv.tv.br/epg/api/epg_list/by_date";

function fetchInnovaChannels() {
  const sql = `
    SELECT id, name, channel_number, COALESCE(epg_url,''), epg_channel_id, COALESCE(logo_url,'')
    FROM public.channels
    WHERE is_active = true
      AND epg_type = 'innovatv'
      AND epg_channel_id IS NOT NULL AND epg_channel_id <> ''
    ORDER BY channel_number ASC
  `;
  const raw = psql(sql).trim();
  if (!raw) return [];
  return raw.split("\n").map((line) => {
    const [id, name, channel_number, epg_url, epg_channel_id, logo_url] = line.split("\t");
    return { id, name, channel_number: parseInt(channel_number, 10), epg_url, epg_channel_id, logo_url };
  });
}

function innovaUrl(channelId, baseUrl) {
  const base = (baseUrl || "").trim() || INNOVATV_BASE_URL;
  const params = new URLSearchParams({
    date: "-2,2",
    id: channelId,
    time_zone: "America/Sao_Paulo",
  });
  return `${base}?${params.toString()}`;
}

function innovaSlug(channelId) {
  const h = createHash("sha1").update(channelId).digest("hex").slice(0, 8);
  const name = channelId.replace(/[^a-zA-Z0-9._-]/g, "").slice(-40);
  return `innovatv-${name}-${h}.json`;
}

function innovaItemsToPrograms(items) {
  if (!Array.isArray(items)) return [];
  const out = [];
  for (const raw of items) {
    const startRaw = raw?.start_ut ?? raw?.start;
    const startSec = typeof startRaw === "string" ? parseInt(startRaw, 10) : startRaw;
    if (!startSec || !Number.isFinite(startSec)) continue;
    const title = String(raw?.title || "").trim();
    const desc = String(raw?.desc || "").trim();
    const pg = String(raw?.pg || "").trim();
    out.push({
      title,
      start_date: new Date(startSec * 1000).toISOString(),
      desc: desc && desc !== title ? desc : null,
      rating: pg && pg !== "S/C" && pg !== "-1" ? pg : null,
    });
  }
  out.sort((a, b) => a.start_date.localeCompare(b.start_date));
  return out;
}

/** Baixa (com cache de 2h30) os programas InnovaTV de cada canal. */
async function fetchInnovaPrograms(channels) {
  await mkdir(SOURCES_DIR, { recursive: true });
  const byChannelId = new Map();

  for (const ch of channels) {
    const dest = join(SOURCES_DIR, innovaSlug(ch.epg_channel_id));
    let json = null;

    if (!FORCE && await fileExists(dest)) {
      const st = await stat(dest);
      const ageMin = (Date.now() - st.mtimeMs) / 60_000;
      if (ageMin < 150) {
        try {
          json = JSON.parse(await readFile(dest, "utf8"));
          log(`✓ innovatv ${ch.epg_channel_id} (cache ${Math.round(ageMin)}min)`);
        } catch { json = null; }
      }
    }

    if (!json) {
      const url = innovaUrl(ch.epg_channel_id, ch.epg_url);
      log(`⬇  innovatv ${ch.epg_channel_id}`);
      const text = await fetchOnce(url, true);
      if (!text) { log(`✗ falhou innovatv: ${ch.epg_channel_id}`); continue; }
      try { json = JSON.parse(text); }
      catch { log(`✗ resposta não-JSON innovatv ${ch.epg_channel_id} — ${text.slice(0, 120)}`); continue; }
      await writeFile(dest, JSON.stringify(json), "utf8");
    }

    const programs = innovaItemsToPrograms(json);
    if (programs.length === 0) { log(`   ⚠ innovatv ${ch.epg_channel_id}: 0 programas`); continue; }
    byChannelId.set(ch.epg_channel_id, programs);
    log(`   ${ch.epg_channel_id}: ${programs.length} programas`);
  }

  return byChannelId;
}

/* ───────────────────────── NXTV (API JSON) ───────────────────────── */

const NXTV_BASE_URL = "https://gateway.nxtv.com.br/api//epg";

/* Credenciais (env ou /opt/lntv-frontend/.env.nxtv) */
async function loadNxtvCreds() {
  let email = process.env.NXTV_USERNAME || process.env.NXTV_EMAIL || "";
  let password = process.env.NXTV_PASSWORD || "";
  let appId = process.env.NXTV_APP_ID || "1";
  if (!email || !password) {
    for (const f of [".env.nxtv", ".env"]) {
      try {
        const txt = await readFile(join(PROJECT_ROOT, f), "utf8");
        for (const line of txt.split("\n")) {
          const m = line.match(/^\s*(NXTV_USERNAME|NXTV_EMAIL|NXTV_PASSWORD|NXTV_APP_ID)\s*=\s*(.*)\s*$/);
          if (!m) continue;
          const val = m[2].replace(/^["']|["']$/g, "").trim();
          if (m[1] === "NXTV_PASSWORD") password ||= val;
          else if (m[1] === "NXTV_APP_ID") appId = val || appId;
          else email ||= val;
        }
      } catch { /* arquivo ausente */ }
      if (email && password) break;
    }
  }
  const app = Number.parseInt(appId, 10);
  return email && password ? { email, password, app: Number.isFinite(app) ? app : 1 } : null;
}

let nxtvTokenCache = null;
async function nxtvToken(base) {
  if (nxtvTokenCache) return nxtvTokenCache;
  const creds = await loadNxtvCreds();
  if (!creds) return null;
  let origin = "https://gateway.nxtv.com.br";
  try { origin = new URL(base).origin; } catch { /* usa default */ }
  try {
    const res = await fetch(`${origin}/api/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(creds),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) { log(`✗ nxtv login HTTP ${res.status}: ${JSON.stringify(json)?.slice(0, 160)}`); return null; }
    const token = json?.token || json?.access_token || json?.jwt || json?.data?.token || json?.user?.token;
    if (!token) { log(`✗ nxtv login sem token na resposta: ${JSON.stringify(json)?.slice(0, 160)}`); return null; }
    log("✓ nxtv autenticado");
    nxtvTokenCache = String(token);
    return nxtvTokenCache;
  } catch (e) {
    log(`✗ nxtv login erro: ${e.message}`);
    return null;
  }
}

function fetchNxtvChannels() {

  const sql = `
    SELECT id, name, channel_number, COALESCE(epg_url,''), epg_channel_id, COALESCE(logo_url,'')
    FROM public.channels
    WHERE is_active = true
      AND epg_type = 'nxtv'
      AND epg_channel_id IS NOT NULL AND epg_channel_id <> ''
    ORDER BY channel_number ASC
  `;
  const raw = psql(sql).trim();
  if (!raw) return [];
  return raw.split("\n").map((line) => {
    const [id, name, channel_number, epg_url, epg_channel_id, logo_url] = line.split("\t");
    return { id, name, channel_number: parseInt(channel_number, 10), epg_url, epg_channel_id, logo_url };
  });
}

function nxtvSlug(baseUrl) {
  const h = createHash("sha1").update(baseUrl).digest("hex").slice(0, 8);
  return `nxtv-${h}.json`;
}

function nxtvTimeToIso(value) {
  if (!value) return null;
  const s = String(value).trim();
  const hasTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s);
  const d = new Date(hasTz ? s : `${s}-03:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function nxtvProgramsToPrograms(programs) {
  if (!Array.isArray(programs)) return [];
  const out = [];
  for (const raw of programs) {
    const start = nxtvTimeToIso(raw?.start_time);
    if (!start) continue;
    const title = String(raw?.program_title || "").trim();
    if (!title) continue;
    const desc = String(raw?.program_description || "").trim();
    out.push({ title, start_date: start, desc: desc && desc !== title ? desc : null, rating: null });
  }
  out.sort((a, b) => a.start_date.localeCompare(b.start_date));
  return out;
}

/** Baixa o(s) feed(s) NXTV (cache 2h30) e mapeia epg_channel_id → programas. */
async function fetchNxtvPrograms(channels) {
  await mkdir(SOURCES_DIR, { recursive: true });
  const byChannelId = new Map();

  // Agrupa por URL base (normalmente uma só)
  const byBase = new Map();
  for (const ch of channels) {
    const base = (ch.epg_url || "").trim() || NXTV_BASE_URL;
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(ch);
  }

  for (const [base, chans] of byBase) {
    const dest = join(SOURCES_DIR, nxtvSlug(base));
    let json = null;

    if (!FORCE && await fileExists(dest)) {
      const st = await stat(dest);
      const ageMin = (Date.now() - st.mtimeMs) / 60_000;
      if (ageMin < 150) {
        try { json = JSON.parse(await readFile(dest, "utf8")); log(`✓ nxtv feed (cache ${Math.round(ageMin)}min)`); }
        catch { json = null; }
      }
    }

    if (!json) {
      log(`⬇  nxtv ${base}`);
      const token = await nxtvToken(base);
      if (!token) log("   ⚠ nxtv sem credenciais/token — tentando sem autenticação");
      const text = await fetchOnce(base, true, token ? { Authorization: `Bearer ${token}`, "x-access-token": token } : undefined);
      if (!text) { log(`✗ falhou nxtv: ${base}`); continue; }

      try { json = JSON.parse(text); }
      catch { log(`✗ resposta não-JSON nxtv — ${text.slice(0, 120)}`); continue; }
      await writeFile(dest, JSON.stringify(json), "utf8");
    }

    if (!Array.isArray(json)) { log(`✗ nxtv: formato inesperado em ${base}`); continue; }

    const index = new Map();
    const feedIds = [];
    for (const c of json) {
      const id = String(c?.channel_id ?? c?.id ?? "").trim().toLowerCase();
      const title = String(c?.channel_title ?? c?.title ?? "").trim().toLowerCase();
      if (id) { index.set(id, c); feedIds.push(`${id}${title ? ` (${title})` : ""}`); }
      if (title && !index.has(title)) index.set(title, c);
    }
    log(`   nxtv feed: ${json.length} canais com grade`);
    await writeFile(join(SOURCES_DIR, "nxtv-feed-ids.txt"), feedIds.join("\n"), "utf8");

    for (const ch of chans) {
      const match = index.get(ch.epg_channel_id.trim().toLowerCase());
      if (!match) { log(`   ⚠ nxtv ${ch.epg_channel_id}: sem grade no feed (o gateway não publica EPG para este canal)`); continue; }
      const programs = nxtvProgramsToPrograms(match?.schedule?.programs);
      if (programs.length === 0) { log(`   ⚠ nxtv ${ch.epg_channel_id}: 0 programas`); continue; }
      byChannelId.set(ch.epg_channel_id, programs);
      log(`   nxtv ${ch.epg_channel_id}: ${programs.length} programas`);
    }

  }

  return byChannelId;
}

/* ───────────────────────── Hallo (raspa programacao.php) ───────────────────────── */

const HALLO_BASE_URL = "https://hallo.tv.br/programacao.php";
// Páginas de 6h: t=0 é a janela atual; t=1..8 cobrem as próximas ~48h.
const HALLO_T_MAX = 8;

function fetchHalloChannels() {
  const sql = `
    SELECT id, name, channel_number, COALESCE(epg_url,''), epg_channel_id, COALESCE(logo_url,'')
    FROM public.channels
    WHERE is_active = true
      AND epg_type = 'hallo'
      AND epg_channel_id IS NOT NULL AND epg_channel_id <> ''
    ORDER BY channel_number ASC
  `;
  const raw = psql(sql).trim();
  if (!raw) return [];
  return raw.split("\n").map((line) => {
    const [id, name, channel_number, epg_url, epg_channel_id, logo_url] = line.split("\t");
    return { id, name, channel_number: parseInt(channel_number, 10), epg_url, epg_channel_id, logo_url };
  });
}

/** "26/08 17:37" (+ stop "18:01") em horário de Brasília → ISO UTC. */
function halloTimeToIso(dayMonth, time, refStartDate) {
  const tm = String(time || "").match(/^(\d{2}):(\d{2})$/);
  if (!tm) return null;
  let day, month;
  if (dayMonth) {
    const dm = String(dayMonth).match(/^(\d{2})\/(\d{2})$/);
    if (!dm) return null;
    day = parseInt(dm[1], 10);
    month = parseInt(dm[2], 10);
  } else if (refStartDate) {
    day = refStartDate.day;
    month = refStartDate.month;
  } else {
    return null;
  }
  const now = new Date();
  let year = now.getUTCFullYear();
  // Virada de ano: se a data ficou mais de 30 dias no passado, é do ano seguinte.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getTime() < now.getTime() - 30 * 86400_000) year++;
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${tm[1]}:${tm[2]}:00-03:00`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Extrai os programas de uma página da grade.
 * Cada célula tem data-prog="{...JSON HTML-escapado...}" com
 * title, desc, rating, start ("26/08 17:37"), stop ("18:01") e channel.
 */
function halloParsePage(html) {
  const out = [];
  const re = /data-prog="([\s\S]*?)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    let prog;
    try { prog = JSON.parse(decodeXmlEntities(m[1])); }
    catch { continue; }
    const title = String(prog?.title || "").trim();
    const channel = String(prog?.channel || "").trim();
    if (!title || !channel) continue;
    const startM = String(prog?.start || "").match(/^(\d{2}\/\d{2})\s+(\d{2}:\d{2})$/);
    if (!startM) continue;
    const startIso = halloTimeToIso(startM[1], startM[2]);
    if (!startIso) continue;
    const desc = String(prog?.desc || "").trim();
    const rating = String(prog?.rating || "").trim();
    out.push({
      channel,
      title,
      start_date: startIso,
      desc: desc && desc !== title ? desc : null,
      rating: rating && rating !== "S/C" && rating !== "-" ? rating : null,
    });
  }
  return out;
}

/** Baixa (cache 2h30) as páginas da grade e devolve Map nomeDoCanal → programas. */
async function fetchHalloPrograms(channels) {
  await mkdir(SOURCES_DIR, { recursive: true });
  const dest = join(SOURCES_DIR, "hallo-grade.json");
  let all = null;

  if (!FORCE && await fileExists(dest)) {
    const st = await stat(dest);
    const ageMin = (Date.now() - st.mtimeMs) / 60_000;
    if (ageMin < 150) {
      try {
        all = JSON.parse(await readFile(dest, "utf8"));
        log(`✓ hallo grade (cache ${Math.round(ageMin)}min)`);
      } catch { all = null; }
    }
  }

  if (!all) {
    all = [];
    for (let t = 0; t <= HALLO_T_MAX; t++) {
      const url = `${HALLO_BASE_URL}?t=${t}`;
      log(`⬇  hallo ${url}`);
      const text = await fetchOnce(url, true);
      if (!text) { log(`✗ falhou hallo t=${t}`); continue; }
      const progs = halloParsePage(text);
      log(`   hallo t=${t}: ${progs.length} programas`);
      all.push(...progs);
    }
    if (all.length > 0) await writeFile(dest, JSON.stringify(all), "utf8");
  }

  // Agrupa por canal (nome normalizado), removendo duplicados de mesma start_date
  const byName = new Map();
  const seen = new Set();
  for (const p of all) {
    const key = `${p.channel.toLowerCase()}|${p.start_date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const norm = p.channel.toLowerCase();
    let arr = byName.get(norm);
    if (!arr) { arr = []; byName.set(norm, arr); }
    arr.push(p);
  }

  const byChannelId = new Map();
  for (const ch of channels) {
    const wanted = ch.epg_channel_id.trim().toLowerCase();
    const programs = byName.get(wanted);
    if (!programs || programs.length === 0) {
      const available = [...byName.keys()].join(", ");
      log(`   ⚠ hallo ${ch.epg_channel_id}: não encontrado na grade (disponíveis: ${available || "nenhum"})`);
      continue;
    }
    programs.sort((a, b) => a.start_date.localeCompare(b.start_date));
    byChannelId.set(ch.epg_channel_id, programs);
    log(`   hallo ${ch.epg_channel_id}: ${programs.length} programas`);
  }

  return byChannelId;
}

/** Converte um programa interno em <programme> XMLTV. */
function programToXmltv(channelId, prog, nextStartIso) {
  const fmt = (iso) => {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())} +0000`;
  };
  const stop = nextStartIso ? ` stop="${fmt(nextStartIso)}"` : "";
  const desc = prog.desc ? `<desc lang="pt">${escapeXml(prog.desc)}</desc>` : "";
  const rating = prog.rating
    ? `<rating><value>${escapeXml(prog.rating)}</value></rating>`
    : "";
  return `<programme start="${fmt(prog.start_date)}"${stop} channel="${escapeXml(channelId)}"><title lang="pt">${escapeXml(prog.title)}</title>${desc}${rating}</programme>`;
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

function decodeXmlEntities(s) {
  if (!s) return s;
  if (s.indexOf("&") === -1) return s;
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

function parseXmltvDateToIso(str) {
  const m = String(str || "").match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, tz] = m;
  const tzF = tz ? tz.replace(/(\d{2})(\d{2})/, "$1:$2") : "+00:00";
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${tzF}`).toISOString();
}

/** Extrai <channel id="..."> e <programme channel="..."> de `xml` para os IDs em `wanted`. */
function extractFromXml(xml, wantedIds) {
  const channelOut = [];
  const progOut = [];
  const progStruct = []; // { channel, title, start_date, desc, rating }
  const wanted = new Set(wantedIds);
  const wantedLower = new Set(wantedIds.map((id) => id.toLowerCase()));
  const matches = (id) => wanted.has(id) || wantedLower.has(id.toLowerCase());
  // mapa para devolver o ID exato como cadastrado no banco (preserva case)
  const canonicalById = new Map();
  for (const id of wantedIds) {
    canonicalById.set(id, id);
    canonicalById.set(id.toLowerCase(), id);
  }
  const canonical = (id) => canonicalById.get(id) || canonicalById.get(id.toLowerCase()) || id;

  const channelRe = /<channel\b[^>]*\bid\s*=\s*"([^"]+)"[^>]*>[\s\S]*?<\/channel>/g;
  let m;
  const seenChannel = new Set();
  while ((m = channelRe.exec(xml)) !== null) {
    if (matches(m[1]) && !seenChannel.has(m[1])) {
      seenChannel.add(m[1]);
      channelOut.push({ id: m[1], xml: m[0] });
    }
  }

  const progRe = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
  const attrRe = /(\w+)\s*=\s*"([^"]*)"/g;
  const titleRe = /<title\b[^>]*>([\s\S]*?)<\/title>/;
  const descRe = /<desc\b[^>]*>([\s\S]*?)<\/desc>/;
  const ratingRe = /<rating\b[^>]*>[\s\S]*?<value\b[^>]*>([\s\S]*?)<\/value>[\s\S]*?<\/rating>/;

  while ((m = progRe.exec(xml)) !== null) {
    const attrs = m[1];
    const inner = m[2];
    let channelId = null;
    let startAttr = null;
    attrRe.lastIndex = 0;
    let am;
    while ((am = attrRe.exec(attrs)) !== null) {
      if (am[1] === "channel") channelId = am[2];
      else if (am[1] === "start") startAttr = am[2];
      if (channelId && startAttr) break;
    }
    if (!channelId || !startAttr) continue;
    if (!matches(channelId)) continue;
    const startIso = parseXmltvDateToIso(startAttr);
    if (!startIso) continue;
    progOut.push(m[0]);
    const titleM = titleRe.exec(inner);
    const descM = descRe.exec(inner);
    const ratingM = ratingRe.exec(inner);
    progStruct.push({
      channel: canonical(channelId),
      title: titleM ? decodeXmlEntities(titleM[1].trim()) : "",
      start_date: startIso,
      desc: descM ? decodeXmlEntities(descM[1].trim()) : null,
      rating: ratingM ? decodeXmlEntities(ratingM[1].trim()) : null,
    });
  }

  return { channels: channelOut, programmes: progOut, programStructs: progStruct };
}

async function consolidate(slugByUrl) {
  const channels = fetchOurChannels();
  log(`📺 canais nossos com EPG: ${channels.length}`);

  // Agrupa por URL → IDs que precisamos buscar nessa URL
  const wantedByUrl = new Map();
  for (const ch of channels) {
    if (!slugByUrl.has(ch.epg_url)) {
      // URL não foi baixada (ex.: download falhou) — cai no proxy remoto no cliente.
      log(`   ⚠ canal ${ch.channel_number} ${ch.name}: URL sem cache local (${ch.epg_url.slice(0, 80)}…)`);
      continue;
    }
    let arr = wantedByUrl.get(ch.epg_url);
    if (!arr) { arr = []; wantedByUrl.set(ch.epg_url, arr); }
    arr.push(ch.epg_channel_id);
  }

  // Acumula <channel> e <programme> filtrados de cada fonte
  const allChannelXml = new Map(); // id → xml
  const allProgrammeXml = [];
  const byChannelStruct = new Map(); // canonical id → [program]

  for (const [url, ids] of wantedByUrl) {
    const slug = slugByUrl.get(url);
    const path = join(SOURCES_DIR, slug);
    if (!await fileExists(path)) {
      log(`⚠  fonte ausente: ${slug}`);
      continue;
    }
    const xml = await readFile(path, "utf8");
    const { channels: ch, programmes: pr, programStructs: ps } = extractFromXml(xml, ids);
    log(`   ${slug}: ${ch.length} canais, ${pr.length} programas`);
    for (const c of ch) if (!allChannelXml.has(c.id)) allChannelXml.set(c.id, c.xml);
    for (const p of pr) allProgrammeXml.push(p);
    for (const p of ps) {
      let arr = byChannelStruct.get(p.channel);
      if (!arr) { arr = []; byChannelStruct.set(p.channel, arr); }
      arr.push({ title: p.title, start_date: p.start_date, desc: p.desc, rating: p.rating });
    }
  }

  // ── InnovaTV (API JSON) ──────────────────────────────────────────────
  const innovaChannels = fetchInnovaChannels();
  if (innovaChannels.length > 0) {
    log(`📡 canais InnovaTV: ${innovaChannels.length}`);
    const innovaByChannelId = await fetchInnovaPrograms(innovaChannels);
    for (const [chanId, programs] of innovaByChannelId) {
      byChannelStruct.set(chanId, programs);
      for (let i = 0; i < programs.length; i++) {
        allProgrammeXml.push(programToXmltv(chanId, programs[i], programs[i + 1]?.start_date));
      }
    }
  }

  // ── NXTV (API JSON) ──────────────────────────────────────────────────
  const nxtvChannels = fetchNxtvChannels();
  if (nxtvChannels.length > 0) {
    log(`📡 canais NXTV: ${nxtvChannels.length}`);
    const nxtvByChannelId = await fetchNxtvPrograms(nxtvChannels);
    for (const [chanId, programs] of nxtvByChannelId) {
      byChannelStruct.set(chanId, programs);
      for (let i = 0; i < programs.length; i++) {
        allProgrammeXml.push(programToXmltv(chanId, programs[i], programs[i + 1]?.start_date));
      }
    }
  }

  // Ordena os programas por horário (mesma ordem que o cliente faria)
  byChannelStruct.forEach((arr) => arr.sort((a, b) => a.start_date.localeCompare(b.start_date)));

  // Adiciona metadados dos nossos canais (display-name + icon do nosso logo, se houver)
  // Para canais sem entry no XML original (ex: canal só com logo nosso), cria <channel> mínimo.
  const ourChannelMeta = [];
  for (const ch of [...channels, ...innovaChannels, ...nxtvChannels]) {
    if (allChannelXml.has(ch.epg_channel_id)) continue;
    if (ourChannelMeta.some((x) => x.includes(`id="${escapeXml(ch.epg_channel_id)}"`))) continue;
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

  // JSON pré-parseado — o cliente (APK) só faz JSON.parse (instantâneo).
  const byChannelObj = {};
  byChannelStruct.forEach((arr, id) => { byChannelObj[id] = arr; });
  const json = {
    generated: new Date().toISOString(),
    channelCount: byChannelStruct.size,
    programCount: allProgrammeXml.length,
    byChannel: byChannelObj,
  };
  await writeFile(CONSOLIDATED_JSON_PATH, JSON.stringify(json), "utf8");
  const jsonSize = (await stat(CONSOLIDATED_JSON_PATH)).size;
  log(`✅ ${CONSOLIDATED_JSON_PATH} — ${(jsonSize / 1024).toFixed(1)} KB · ${byChannelStruct.size} canais`);
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
    const allUrls = fetchAllEpgUrls();
    slugByUrl = new Map(allUrls.map((u) => [u, urlToSlug(u)]));
  } else {
    const allUrls = fetchAllEpgUrls();
    log(`   URLs totais (presets + avulsas): ${allUrls.length}`);
    slugByUrl = await syncSources(allUrls);
  }

  await consolidate(slugByUrl);
  log("✨ pronto.");
}

main().catch((e) => { console.error("❌ erro fatal:", e); process.exit(99); });
