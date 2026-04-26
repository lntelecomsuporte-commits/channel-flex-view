#!/usr/bin/env node
/**
 * sync-logos.mjs
 *
 * Roda no servidor local (tv2). Lê todos os canais ativos do Supabase,
 * baixa cada logo_url externa, redimensiona pro tamanho padrão e salva
 * em /opt/lntv-frontend/public/logos/{channel_number}.png.
 *
 * Em seguida, atualiza channels.logo_url para apontar pro caminho local
 * `/logos/{channel_number}.png?v={updated_at_epoch}` (o `?v=` invalida o
 * cache do APK quando você troca a logo no painel).
 *
 * Uso:
 *   node scripts/sync-logos.mjs            # sincroniza todos
 *   node scripts/sync-logos.mjs --force    # re-baixa mesmo se já existe
 *   node scripts/sync-logos.mjs --channel 5  # só o canal número 5
 *
 * Variáveis de ambiente necessárias (já existem no .env do projeto):
 *   VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   (precisa ser a service-role, não a anon)
 *
 * Cron sugerido (a cada 5 minutos):
 *   *\/5 * * * * cd /opt/lntv-frontend && /usr/bin/node scripts/sync-logos.mjs >> /var/log/lntv-logos.log 2>&1
 */

import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROJECT_ROOT = join(__dirname, "..");
const LOGOS_DIR = join(PROJECT_ROOT, "public", "logos");
const LOGO_SIZE = 200; // px (logo padronizada 200x200, fundo transparente)
const FETCH_TIMEOUT_MS = 15_000;

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("❌ Faltam variáveis: VITE_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY");
  console.error("   Coloque-as no /opt/lntv-frontend/.env ou exporte antes de rodar.");
  process.exit(1);
}

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const channelArgIdx = args.indexOf("--channel");
const SINGLE_CHANNEL = channelArgIdx >= 0 ? parseInt(args[channelArgIdx + 1], 10) : null;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

const log = (...a) => console.log(new Date().toISOString(), ...a);

const isLocalLogo = (url) => !!url && url.startsWith("/logos/");

async function downloadAndResize(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    // sharp: redimensiona mantendo aspect ratio + canvas transparente quadrado
    const out = await sharp(buf)
      .resize(LOGO_SIZE, LOGO_SIZE, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png({ compressionLevel: 9 })
      .toBuffer();
    return out;
  } finally {
    clearTimeout(t);
  }
}

async function fileExists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function syncOne(channel) {
  const { id, channel_number, name, logo_url, updated_at } = channel;
  if (!logo_url) {
    log(`⏭  #${channel_number} ${name} — sem logo_url, pulando`);
    return { skipped: true };
  }

  const localFileName = `${channel_number}.png`;
  const localPath = join(LOGOS_DIR, localFileName);
  const versionedUrl = `/logos/${localFileName}?v=${new Date(updated_at).getTime()}`;

  // Se a URL no banco já é local E o arquivo existe E não é --force, nada a fazer.
  if (!FORCE && isLocalLogo(logo_url) && (await fileExists(localPath))) {
    // mas garante que a query string ?v= bate com updated_at
    if (logo_url === versionedUrl) {
      return { unchanged: true };
    }
    // só atualiza a URL no banco (versão nova)
    await supabase.from("channels").update({ logo_url: versionedUrl }).eq("id", id);
    log(`🔄 #${channel_number} ${name} — atualizou versão para ${versionedUrl}`);
    return { versionBumped: true };
  }

  // Precisamos baixar. Se a URL atual JÁ é local, não temos a externa original
  // — então pula (admin precisa colar a URL externa de novo se quiser re-baixar).
  if (isLocalLogo(logo_url)) {
    if (await fileExists(localPath)) {
      return { unchanged: true };
    }
    log(`⚠️  #${channel_number} ${name} — URL local mas arquivo sumiu, e não há fonte externa`);
    return { error: "missing_source" };
  }

  try {
    log(`⬇️  #${channel_number} ${name} — baixando ${logo_url}`);
    const buf = await downloadAndResize(logo_url);
    await mkdir(LOGOS_DIR, { recursive: true });
    await writeFile(localPath, buf);
    await supabase.from("channels").update({ logo_url: versionedUrl }).eq("id", id);
    log(`✅ #${channel_number} ${name} — salvo em ${localPath}`);
    return { synced: true };
  } catch (e) {
    log(`❌ #${channel_number} ${name} — falhou: ${e.message}`);
    return { error: e.message };
  }
}

async function main() {
  log("🚀 Iniciando sync de logos…");
  log(`   Pasta destino: ${LOGOS_DIR}`);
  log(`   Tamanho padrão: ${LOGO_SIZE}x${LOGO_SIZE}`);
  if (FORCE) log("   Modo: --force (re-baixa todas)");
  if (SINGLE_CHANNEL !== null) log(`   Filtro: --channel ${SINGLE_CHANNEL}`);

  let q = supabase.from("channels").select("id, channel_number, name, logo_url, updated_at").eq("is_active", true);
  if (SINGLE_CHANNEL !== null) q = q.eq("channel_number", SINGLE_CHANNEL);
  const { data: channels, error } = await q.order("channel_number", { ascending: true });

  if (error) {
    console.error("❌ Erro ao buscar canais:", error);
    process.exit(2);
  }

  const summary = { synced: 0, unchanged: 0, skipped: 0, versionBumped: 0, error: 0 };
  for (const ch of channels ?? []) {
    const r = await syncOne(ch);
    if (r.synced) summary.synced++;
    else if (r.unchanged) summary.unchanged++;
    else if (r.skipped) summary.skipped++;
    else if (r.versionBumped) summary.versionBumped++;
    else if (r.error) summary.error++;
  }

  log("📊 Resumo:", summary);
  log("✨ Pronto.");
}

main().catch((e) => {
  console.error("❌ Erro fatal:", e);
  process.exit(99);
});
