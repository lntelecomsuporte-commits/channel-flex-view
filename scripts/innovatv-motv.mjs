/**
 * InnovaTV (plataforma MOTV) — login de operador + grade completa.
 *
 * A API pública antiga (api.innovatv.tv.br) foi desligada; a grade agora
 * exige a conta da InnovaTV. Este módulo é usado pelo scripts/sync-epg.mjs
 * no servidor. As credenciais ficam em variáveis de ambiente ou no arquivo
 * /opt/lntv-frontend/.env.innovatv — nunca no repositório.
 *
 *   INNOVATV_EMAIL=...
 *   INNOVATV_PASSWORD=...
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const INNOVATV_SMS_URL = "https://sms.innova.tv.br";
export const INNOVATV_MW_URL = "https://mw.innova.tv.br";
const CLIENT_DEVICE_TYPE = "web player";
const CLIENT_VERSION = "1.3.8";

const b64 = (s) => Buffer.from(String(s), "utf8").toString("base64");

/** Chave de comparação: minúsculas, sem acentos e sem símbolos ("HALLO! Anime" → "halloanime"). */
export function innovaKey(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Lê INNOVATV_EMAIL/INNOVATV_PASSWORD do ambiente ou de .env.innovatv / .env. */
export async function loadInnovaCreds(projectRoot, env = process.env) {
  let email = env.INNOVATV_EMAIL || env.INNOVATV_USERNAME || "";
  let password = env.INNOVATV_PASSWORD || "";
  let vendorId = env.INNOVATV_VENDOR_ID || "1";
  if (!email || !password) {
    for (const f of [".env.innovatv", ".env"]) {
      try {
        const txt = await readFile(join(projectRoot, f), "utf8");
        for (const line of txt.split("\n")) {
          const m = line.match(/^\s*(INNOVATV_EMAIL|INNOVATV_USERNAME|INNOVATV_PASSWORD|INNOVATV_VENDOR_ID)\s*=\s*(.*?)\s*$/);
          if (!m) continue;
          const val = m[2].replace(/^["']|["']$/g, "");
          if (m[1] === "INNOVATV_PASSWORD") password ||= val;
          else if (m[1] === "INNOVATV_VENDOR_ID") vendorId = val || vendorId;
          else email ||= val.trim();
        }
      } catch { /* arquivo ausente */ }
      if (email && password) break;
    }
  }
  const vendor = Number.parseInt(vendorId, 10);
  return email && password ? { email, password, vendorId: Number.isFinite(vendor) ? vendor : 1 } : null;
}

function formatUtc(date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

async function postJson(url, body, headers, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...(headers || {}) },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(t);
  }
}

/** Faz login na InnovaTV e devolve os cabeçalhos autenticados do middleware. */
export async function motvLogin(creds, { smsUrl = INNOVATV_SMS_URL, timeoutMs = 30_000 } = {}) {
  const r = await postJson(
    `${smsUrl}/api/Devices/Motv/apiLoginV2`,
    { data: { login: creds.email, password: creds.password, vendors_id: creds.vendorId ?? 1 } },
    undefined,
    timeoutMs,
  );
  const token = r.json?.response?.customers_token;
  if (!r.ok || r.json?.status !== 1 || !token) {
    const reason = Array.isArray(r.json?.response)
      ? r.json.response.map((e) => e?.message || e?.errorAt).filter(Boolean).join("; ")
      : "";
    throw new Error(`login recusado (HTTP ${r.status}${reason ? ` — ${reason}` : ""})`);
  }
  const profiles = Array.isArray(r.json.response.profiles) ? r.json.response.profiles : [];
  const profileId = profiles[0]?.profiles_id ?? 1;
  return {
    Authorization: `Bearer ${token}`,
    devicesType: b64(CLIENT_DEVICE_TYPE),
    version: b64(CLIENT_VERSION),
    profilesId: b64(profileId),
  };
}

/** Converte a lista de canais assinados em [{ id, name, logo }]. */
export function motvChannelsToList(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  const out = [];
  for (const c of items) {
    const id = String(c?.channels_id ?? c?.id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: String(c?.channels_name ?? c?.name ?? id).trim() || id,
      logo: c?.channels_logo ? String(c.channels_logo) : null,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
}

function ratingText(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return null;
  const s = String(value).trim();
  if (!s || s === "S/C" || s === "-1" || s === "0") return null;
  return s;
}

/** Agrupa os eventos da InnovaTV por channels_id no formato interno de programas. */
export function motvEventsToByChannel(events) {
  const byChannel = {};
  if (!Array.isArray(events)) return byChannel;
  for (const ev of events) {
    const channelId = String(ev?.channels_id ?? "").trim();
    const start = ev?.start ? new Date(ev.start) : null;
    if (!channelId || !start || Number.isNaN(start.getTime())) continue;
    const title = String(ev?.title || "").trim();
    if (!title) continue;
    const desc = String(ev?.description || "").trim();
    (byChannel[channelId] ||= []).push({
      title,
      start_date: start.toISOString(),
      desc: desc && desc !== title ? desc : null,
      rating: ratingText(ev?.rating),
    });
  }
  for (const id of Object.keys(byChannel)) {
    const seenStarts = new Set();
    byChannel[id] = byChannel[id]
      .sort((a, b) => a.start_date.localeCompare(b.start_date))
      .filter((p) => (seenStarts.has(p.start_date) ? false : (seenStarts.add(p.start_date), true)));
  }
  return byChannel;
}

/**
 * Encontra a grade de um canal salvo no painel. Aceita o ID numérico da
 * InnovaTV ("9") ou o nome do canal ("HALLO! Anime"), para manter os
 * cadastros antigos que usavam o nome como ID.
 */
export function findInnovaPrograms(epgChannelId, feed) {
  const wanted = String(epgChannelId ?? "").trim();
  if (!wanted || !feed?.byChannel) return null;
  if (Array.isArray(feed.byChannel[wanted])) return feed.byChannel[wanted];
  const key = innovaKey(wanted);
  if (!key) return null;
  const match = (feed.channels || []).find((c) => innovaKey(c.id) === key || innovaKey(c.name) === key);
  return match && Array.isArray(feed.byChannel[match.id]) ? feed.byChannel[match.id] : null;
}

/** Login + canais + grade (janela de -6h a +48h). */
export async function fetchMotvFeed(creds, {
  smsUrl = INNOVATV_SMS_URL,
  mwUrl = INNOVATV_MW_URL,
  now = new Date(),
  pastHours = 6,
  futureHours = 48,
  timeoutMs = 60_000,
} = {}) {
  const headers = await motvLogin(creds, { smsUrl, timeoutMs });

  const ch = await postJson(`${mwUrl}/public/channel/getSubscribedChannels`, { data: {} }, headers, timeoutMs);
  if (!ch.ok || ch.json?.status !== 1) throw new Error(`lista de canais falhou (HTTP ${ch.status})`);
  const channels = motvChannelsToList(ch.json.response);

  const from = formatUtc(new Date(now.getTime() - pastHours * 3_600_000));
  const to = formatUtc(new Date(now.getTime() + futureHours * 3_600_000));
  const ep = await postJson(`${mwUrl}/public/epg/getUpdatedEventsV2`, { data: { timestamp: 0, from, to } }, headers, timeoutMs);
  if (!ep.ok || ep.json?.status !== 1) throw new Error(`grade falhou (HTTP ${ep.status})`);
  const byChannel = motvEventsToByChannel(ep.json.response);

  return { generated: now.toISOString(), channels, byChannel };
}
