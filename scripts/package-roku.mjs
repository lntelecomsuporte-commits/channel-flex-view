#!/usr/bin/env node
/**
 * package-roku.mjs — Empacota o canal Roku como .pkg assinado.
 *
 * Como funciona:
 *  1. Compacta tudo em /roku como um .zip.
 *  2. Envia (sideload) pro Roku em modo desenvolvedor na sua rede via /plugin_install.
 *  3. Pede pro próprio Roku gerar o .pkg assinado com a signing key registrada
 *     no device (/plugin_package) e baixa o arquivo final pra dist/roku/.
 *
 * Pré-requisitos:
 *  - Um Roku físico em modo desenvolvedor (Home 3x, Up 2x, Right, Left, Right, Left, Right).
 *  - Senha do dev server (a que você cadastrou na primeira instalação).
 *  - Signing key já gerada nesse Roku (botão "Generate New Key" na webUI →
 *     anota a senha que aparece). Sem isso o Roku Store rejeita.
 *
 * Uso:
 *   node scripts/package-roku.mjs \
 *     --ip 192.168.0.50 \
 *     --user rokudev \
 *     --password SENHA_DEV \
 *     --signing-password SENHA_DA_SIGNING_KEY
 *
 * Ou via .env (na raiz do projeto):
 *   ROKU_IP=192.168.0.50
 *   ROKU_USER=rokudev
 *   ROKU_PASSWORD=...
 *   ROKU_SIGNING_PASSWORD=...
 *
 * Saída:
 *   dist/roku/lntv-<version>.zip   (sideload — bom pra teste local)
 *   dist/roku/lntv-<version>.pkg   (pra postar no Roku Developer Dashboard)
 */

import { mkdir, readFile, writeFile, readdir, stat } from "node:fs/promises";
import { createWriteStream, createReadStream } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const ROOT = join(dirname(__filename), "..");
const ROKU_DIR = join(ROOT, "roku");
const OUT_DIR = join(ROOT, "dist", "roku");

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const val = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true";
    out[key] = val;
  }
  return out;
}

function loadDotEnv() {
  try {
    const txt = require("node:fs").readFileSync(join(ROOT, ".env"), "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* sem .env é ok */ }
}
loadDotEnv();

const argv = parseArgs();
const IP = argv.ip || process.env.ROKU_IP;
const USER = argv.user || process.env.ROKU_USER || "rokudev";
const PASSWORD = argv.password || process.env.ROKU_PASSWORD;
const SIGNING_PASSWORD = argv["signing-password"] || process.env.ROKU_SIGNING_PASSWORD;

if (!IP || !PASSWORD) {
  console.error("❌ Faltam parâmetros. Uso:");
  console.error("   node scripts/package-roku.mjs --ip <IP_DO_ROKU> --password <SENHA_DEV> --signing-password <SENHA_DA_KEY>");
  console.error("   (ou defina ROKU_IP / ROKU_PASSWORD / ROKU_SIGNING_PASSWORD no .env)");
  process.exit(2);
}
if (!SIGNING_PASSWORD) {
  console.error("❌ Faltou --signing-password (a senha que o Roku te mostrou ao clicar 'Generate New Key').");
  console.error("   Sem ela, o .pkg fica sem assinatura e a Roku Store rejeita.");
  process.exit(2);
}

const BASE = `http://${IP}`;
const log = (...a) => console.log(new Date().toISOString(), ...a);

// ─────────────────────────────── ZIP ───────────────────────────────
async function readVersion() {
  const txt = await readFile(join(ROKU_DIR, "manifest"), "utf8");
  const major = txt.match(/^major_version=(\d+)/m)?.[1] ?? "1";
  const minor = txt.match(/^minor_version=(\d+)/m)?.[1] ?? "0";
  const build = txt.match(/^build_version=(\S+)/m)?.[1] ?? "0";
  return `${major}.${minor}.${build}`;
}

async function buildZip(zipPath) {
  // Usa /usr/bin/zip se disponível (presente em mac/linux). No Windows, sugere instalar.
  const has = spawnSync("zip", ["-v"], { stdio: "ignore" }).status === 0;
  if (!has) {
    console.error("❌ Preciso do binário 'zip' no PATH. Instale: brew install zip / apt install zip.");
    process.exit(3);
  }
  await mkdir(dirname(zipPath), { recursive: true });
  // -r recursivo, -X sem metadata extra. Roda DENTRO de roku/ pra paths ficarem relativos.
  const r = spawnSync("zip", ["-r", "-X", zipPath, "manifest", "source", "components", "images"], {
    cwd: ROKU_DIR, stdio: "inherit",
  });
  if (r.status !== 0) { console.error("❌ zip falhou"); process.exit(3); }
}

// ────────────────────── HTTP Digest Auth (Roku usa) ──────────────────────
function md5(s) { return createHash("md5").update(s).digest("hex"); }

function parseDigest(header) {
  const out = {};
  const body = header.replace(/^Digest\s+/i, "");
  body.replace(/(\w+)=(?:"([^"]*)"|([^,]+))/g, (_, k, v1, v2) => { out[k] = v1 ?? v2; return ""; });
  return out;
}

function buildDigest(method, uri, challenge) {
  const cnonce = randomBytes(8).toString("hex");
  const nc = "00000001";
  const ha1 = md5(`${USER}:${challenge.realm}:${PASSWORD}`);
  const ha2 = md5(`${method}:${uri}`);
  const qop = (challenge.qop || "auth").split(",")[0].trim();
  const response = md5(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
  return `Digest username="${USER}", realm="${challenge.realm}", nonce="${challenge.nonce}", uri="${uri}", qop=${qop}, nc=${nc}, cnonce="${cnonce}", response="${response}"${challenge.opaque ? `, opaque="${challenge.opaque}"` : ""}`;
}

async function rokuPost(path, formData, { responseType = "text" } = {}) {
  const url = `${BASE}${path}`;
  // 1ª tentativa pra pegar o challenge
  let res = await fetch(url, { method: "POST", body: formData });
  if (res.status === 401) {
    const challenge = parseDigest(res.headers.get("www-authenticate") || "");
    const auth = buildDigest("POST", path, challenge);
    res = await fetch(url, { method: "POST", body: formData, headers: { Authorization: auth } });
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`POST ${path} → HTTP ${res.status}\n${t.slice(0, 500)}`);
  }
  if (responseType === "buffer") return Buffer.from(await res.arrayBuffer());
  return await res.text();
}

async function rokuGetBinary(path) {
  const url = `${BASE}${path}`;
  let res = await fetch(url);
  if (res.status === 401) {
    const challenge = parseDigest(res.headers.get("www-authenticate") || "");
    const auth = buildDigest("GET", path, challenge);
    res = await fetch(url, { headers: { Authorization: auth } });
  }
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ──────────────────── Sideload + Package no Roku ────────────────────
async function sideload(zipPath) {
  const buf = await readFile(zipPath);
  const fd = new FormData();
  fd.append("mysubmit", "Install");
  fd.append("archive", new Blob([buf], { type: "application/zip" }), "channel.zip");
  log("📤 Enviando sideload pro Roku…");
  const html = await rokuPost("/plugin_install", fd);
  if (/Install Failure/i.test(html) || /Error/i.test(html.slice(0, 2000))) {
    const msg = html.match(/<font[^>]*>(.*?)<\/font>/i)?.[1] || "";
    throw new Error(`Sideload falhou: ${msg || "ver webUI"}`);
  }
  log("✅ Sideload OK");
}

async function packageOnRoku(version) {
  const fd = new FormData();
  fd.append("mysubmit", "Package");
  fd.append("app_name", `LN TV / ${version}`);
  fd.append("passwd", SIGNING_PASSWORD);
  fd.append("pkg_time", String(Date.now()));
  log("📦 Pedindo pro Roku gerar .pkg assinado…");
  const html = await rokuPost("/plugin_package", fd);

  // Extrai o link "pkgs/PXXXXX.pkg" do HTML retornado
  const link = html.match(/href="(pkgs\/[^"]+\.pkg)"/i)?.[1];
  if (!link) {
    const err = html.match(/<font color="red">(.*?)<\/font>/i)?.[1] || html.slice(0, 600);
    throw new Error(`Roku não retornou link do .pkg.\nResposta: ${err}`);
  }
  return `/${link}`;
}

// ──────────────────────────── Main ────────────────────────────
async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const version = await readVersion();
  const zipPath = join(OUT_DIR, `lntv-${version}.zip`);
  const pkgPath = join(OUT_DIR, `lntv-${version}.pkg`);

  log(`🚀 Empacotando LN TV ${version} via Roku em ${IP}`);
  await buildZip(zipPath);
  log(`📁 zip: ${relative(ROOT, zipPath)}`);

  await sideload(zipPath);
  const pkgUrl = await packageOnRoku(version);
  log(`⬇️  Baixando ${pkgUrl}…`);
  const pkgBuf = await rokuGetBinary(pkgUrl);
  await writeFile(pkgPath, pkgBuf);
  log(`✅ .pkg salvo em ${relative(ROOT, pkgPath)} (${pkgBuf.length} bytes)`);
  log("");
  log("📮 Próximo passo: faça upload do .pkg em https://developer.roku.com/ → seu canal → Package Upload.");
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
