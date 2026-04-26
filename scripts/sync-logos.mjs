#!/usr/bin/env node
/**
 * sync-logos.mjs (v2 — via edge function, sem service-role)
 *
 * Lê canais ativos chamando a edge function `sync-logos` no Cloud,
 * baixa cada logo externa, redimensiona, salva em public/logos/<n>.png,
 * e pede pra edge function atualizar logo_url -> /logos/<n>.png?v=<epoch>
 *
 * Variáveis necessárias no /opt/lntv-frontend/.env:
 *   VITE_SUPABASE_URL              (ex: https://oxunkzltmlafatzfiikj.supabase.co)
 *   SYNC_LOGOS_SECRET              (qualquer string longa, igual ao secret no Cloud)
 *
 * Uso:
 *   node scripts/sync-logos.mjs
 *   node scripts/sync-logos.mjs --force
 *   node scripts/sync-logos.mjs --channel 5
 */

import { mkdir, writeFile, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROJECT_ROOT = join(__dirname, "..");
const LOGOS_DIR = join(PROJECT_ROOT, "public", "logos");
const LOGO_SIZE = 200;
const FETCH_TIMEOUT_MS = 15_000;

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SYNC_SECRET = process.env.SYNC_LOGOS_SECRET;

if (!SUPABASE_URL || !SYNC_SECRET) {
  console.error("❌ Faltam variáveis: VITE_SUPABASE_URL e SYNC_LOGOS_SECRET");
  console.error("   Coloque-as no /opt/lntv-frontend/.env");
  process.exit(1);
}

const FN_URL = `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/sync-logos`;

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const channelArgIdx = args.indexOf("--channel");
const SINGLE_CHANNEL = channelArgIdx >= 0 ? parseInt(args[channelArgIdx + 1], 10) : null;

const log = (...a) => console.log(new Date().toISOString(), ...a);
const isLocalLogo = (url) => !!url && url.startsWith("/logos/");

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

async function fetchChannels() {
  const res = await fetch(FN_URL, { headers: { "x-sync-secret": SYNC_SECRET } });
  if (!res.ok) throw new Error(`GET sync-logos falhou: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.channels ?? [];
}

async function pushUpdates(updates) {
  if (updates.length === 0) return { updated: 0 };
  const res = await fetch(FN_URL, {
    method: "POST",
    headers: { "x-sync-secret": SYNC_SECRET, "Content-Type": "application/json" },
    body: JSON.stringify({ updates }),
  });
  if (!res.ok) throw new Error(`POST sync-logos falhou: ${res.status} ${await res.text()}`);
  return await res.json();
}

async function main() {
  log("🚀 Sync de logos iniciando…");
  log(`   Pasta destino: ${LOGOS_DIR}`);
  log(`   Endpoint: ${FN_URL}`);
  if (FORCE) log("   Modo: --force");
  if (SINGLE_CHANNEL !== null) log(`   Filtro: --channel ${SINGLE_CHANNEL}`);

  await mkdir(LOGOS_DIR, { recursive: true });

  let channels = await fetchChannels();
  if (SINGLE_CHANNEL !== null) channels = channels.filter((c) => c.channel_number === SINGLE_CHANNEL);

  const updates = [];
  const summary = { synced: 0, unchanged: 0, skipped: 0, versionBumped: 0, error: 0 };

  for (const ch of channels) {
    const { channel_number, name, logo_url, updated_at } = ch;
    if (!logo_url) { log(`⏭  #${channel_number} ${name} — sem logo_url`); summary.skipped++; continue; }

    const localPath = join(LOGOS_DIR, `${channel_number}.png`);
    const version = new Date(updated_at).getTime();
    const versionedUrl = `/logos/${channel_number}.png?v=${version}`;

    if (!FORCE && isLocalLogo(logo_url) && (await fileExists(localPath))) {
      if (logo_url === versionedUrl) { summary.unchanged++; continue; }
      updates.push({ channel_number, version });
      summary.versionBumped++;
      log(`🔄 #${channel_number} ${name} — version bump`);
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
      updates.push({ channel_number, version });
      summary.synced++;
      log(`✅ #${channel_number} ${name} — salvo`);
    } catch (e) {
      log(`❌ #${channel_number} ${name} — ${e.message}`);
      summary.error++;
    }
  }

  if (updates.length > 0) {
    log(`📡 Enviando ${updates.length} updates pro Cloud…`);
    const r = await pushUpdates(updates);
    log(`   atualizados no banco: ${r.updated}`, r.errors?.length ? `erros: ${r.errors.join("; ")}` : "");
  }

  log("📊 Resumo:", summary);
  log("✨ Pronto.");
}

main().catch((e) => { console.error("❌ Erro fatal:", e); process.exit(99); });
