// Run with sudo after deploying dist. No changes to proxies, logos or the TV location.
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, basename } from "node:path";
import { pathToFileURL } from "node:url";

const marker = "# LN TV Admin static entry";
const locations = `
    ${marker}
    location = /admin {
        root /var/www/lntv;
        try_files /admin/index.html =404;
        add_header Cache-Control "no-cache" always;
    }
    location ^~ /admin/ {
        root /var/www/lntv;
        try_files /admin/index.html =404;
        add_header Cache-Control "no-cache" always;
    }
`;

export function configureAdminNginx(source) {
  // Mask strings/comments to count only structural braces, preserving offsets.
  const masked = source.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#[^\n]*/g,
    (value) => value.replace(/[^\n]/g, " "));
  const insertions = [];
  let found = false;
  for (const match of masked.matchAll(/\bserver\s*\{/g)) {
    const start = match.index + match[0].length;
    let depth = 1;
    let end = start;
    while (end < masked.length && depth > 0) {
      if (masked[end] === "{") depth++;
      if (masked[end] === "}") depth--;
      end++;
    }
    if (depth !== 0) throw new Error("Bloco server incompleto; nenhuma alteração aplicada.");
    const block = source.slice(start, end - 1);
    const directives = block.replace(/#[^\n]*/g, "");
    const names = directives.match(/\bserver_name\s+([^;]+);/)?.[1]
      .replace(/["']/g, "").split(/\s+/) ?? [];
    if (!names.includes("tv2.lntelecom.net")) continue;
    // Do not add locations to the HTTP redirect-only server.
    if (!/\broot\s+["']?\/var\/www\/lntv\/?["']?\s*;/.test(directives)
      && !/\blisten\s+[^;]*\b443\b[^;]*\bssl\b/.test(directives)) continue;
    found = true;
    if (block.includes(marker)) continue;
    if (/\blocation\s+(?:(?:=|\^~|~\*?)\s+)?["']?\/admin(?:[\s/"'{]|$)/.test(directives)) {
      throw new Error("Já existe uma configuração /admin. Revise-a antes de continuar; nada foi alterado.");
    }
    insertions.push(end - 1);
  }
  let result = source;
  for (const position of insertions.reverse()) {
    result = result.slice(0, position) + locations + result.slice(position);
  }
  return { source: result, found, changed: insertions.length > 0 };
}

function install() {
  if (process.getuid?.() !== 0) throw new Error("Execute este comando com sudo.");
  readFileSync("/var/www/lntv/admin/index.html"); // Require the deployed entry first.
  const dump = execFileSync("nginx", ["-T"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const paths = [...new Set([...dump.matchAll(/^# configuration file (.+):$/gm)]
    .map((match) => realpathSync(match[1])))];
  // Prepare every change before writing anything, so conflicts cannot leave partial edits.
  const files = paths.map((path) => {
    const original = readFileSync(path, "utf8");
    return { path, original, ...configureAdminNginx(original) };
  });
  if (!files.some((file) => file.found)) {
    throw new Error("Não encontrei o bloco do site tv2.lntelecom.net; nenhuma alteração aplicada.");
  }
  const changed = files.filter((file) => file.changed);
  if (changed.length === 0) {
    console.log("Entrada administrativa já configurada.");
    return;
  }
  const backup = `/var/backups/lntv-admin-nginx/${Date.now()}`;
  mkdirSync(backup, { recursive: true, mode: 0o700 });
  try {
    changed.forEach((file, index) => {
      writeFileSync(`${backup}/${index}-${basename(file.path)}`, file.original, { mode: 0o600 });
      writeFileSync(file.path, file.source);
    });
    execFileSync("nginx", ["-t"], { stdio: "pipe" });
    execFileSync("systemctl", ["reload", "nginx"], { stdio: "pipe" });
  } catch {
    changed.forEach((file) => writeFileSync(file.path, file.original));
    throw new Error("A verificação/releitura falhou. A configuração original foi restaurada.");
  }
  console.log(`Entrada administrativa configurada. Backup: ${backup}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { install(); }
  catch (error) {
    console.error(error instanceof Error ? error.message : "Falha ao configurar o painel.");
    process.exitCode = 1;
  }
}