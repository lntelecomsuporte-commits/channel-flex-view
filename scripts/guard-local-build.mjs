#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const forbiddenHosts = [
  "tv.lntelecom.net",
  "oxunkzltmlafatzfiikj.supabase.co",
  "lovable.app",
  "lovableproject.com",
];

const envFiles = [
  ".env.production.local",
  ".env.local",
  ".env.production",
  ".env",
].map((file) => path.join(root, file));

const values = new Map();
for (const file of envFiles) {
  if (!fs.existsSync(file)) continue;
  const content = fs.readFileSync(file, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!values.has(key)) values.set(key, value);
  }
}

const supabaseUrl = values.get("VITE_SUPABASE_URL") ?? "";
const projectId = values.get("VITE_SUPABASE_PROJECT_ID") ?? "";
const publishableKey = values.get("VITE_SUPABASE_PUBLISHABLE_KEY") ?? values.get("VITE_SUPABASE_ANON_KEY") ?? "";

const failures = [];
if (!supabaseUrl) failures.push("VITE_SUPABASE_URL não encontrado nos arquivos .env locais.");
if (!supabaseUrl.includes("tv2.lntelecom.net")) failures.push(`VITE_SUPABASE_URL precisa apontar para https://tv2.lntelecom.net, atual: ${supabaseUrl || "vazio"}`);
if (forbiddenHosts.some((host) => supabaseUrl.includes(host))) failures.push(`VITE_SUPABASE_URL está apontando para Cloud/preview: ${supabaseUrl}`);
if (projectId && projectId !== "local" && projectId !== "lntv") failures.push(`VITE_SUPABASE_PROJECT_ID local esperado como local/lntv, atual: ${projectId}`);
if (!publishableKey) failures.push("VITE_SUPABASE_PUBLISHABLE_KEY não encontrado; o build local não deve usar chave do Cloud.");

if (failures.length > 0) {
  console.error("\nERRO: build local bloqueado para evitar login/operacao no Cloud.");
  for (const failure of failures) console.error(`- ${failure}`);
  console.error("\nCrie/ajuste /opt/lntv-frontend/.env.production.local com:");
  console.error("VITE_SUPABASE_URL=https://tv2.lntelecom.net");
  console.error("VITE_SUPABASE_PUBLISHABLE_KEY=<anon key local>");
  console.error("VITE_SUPABASE_PROJECT_ID=local\n");
  process.exit(1);
}

console.log(`Build local validado: VITE_SUPABASE_URL=${supabaseUrl}`);
