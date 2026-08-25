/**
 * NXTV EPG — API JSON do gateway NXTV (usada por soplay.com.br e afins).
 *
 * Endpoint: https://gateway.nxtv.com.br/api//epg
 * Resposta: array de canais
 *   [{ channel_id: "748", channel_title: "GPTV",
 *      schedule: { programs: [{ program_title, program_description,
 *                               start_time: "2026-08-25T18:00:00", end_time, ... }] } }]
 *
 * Horários vêm SEM timezone e são horário de Brasília (UTC-3).
 */
import type { EPGProgram } from "@/hooks/useEPG";

export const NXTV_BASE_URL = "https://gateway.nxtv.com.br/api//epg";

export interface NxtvProgram {
  program_title?: string | null;
  program_description?: string | null;
  episode_title?: string | null;
  start_time?: string | null;
  end_time?: string | null;
}

export interface NxtvChannel {
  channel_id?: string | number | null;
  channel_title?: string | null;
  schedule?: { programs?: NxtvProgram[] } | null;
}

/** Converte "2026-08-25T18:00:00" (Brasília) em ISO UTC. */
export function nxtvTimeToIso(value?: string | null): string | null {
  if (!value) return null;
  const s = value.trim();
  // Já tem timezone explícito? usa como está.
  const hasTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s);
  const d = new Date(hasTz ? s : `${s}-03:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Converte a lista de programas de um canal NXTV para o formato interno. */
export function nxtvProgramsToPrograms(programs: unknown): EPGProgram[] {
  if (!Array.isArray(programs)) return [];
  const out: EPGProgram[] = [];
  for (const raw of programs as NxtvProgram[]) {
    const start = nxtvTimeToIso(raw?.start_time);
    if (!start) continue;
    const title = String(raw?.program_title || "").trim();
    if (!title) continue;
    const desc = String(raw?.program_description || "").trim();
    out.push({
      title,
      start_date: start,
      desc: desc && desc !== title ? desc : null,
      rating: null,
    });
  }
  out.sort((a, b) => a.start_date.localeCompare(b.start_date));
  return out;
}

/** Baixa o feed completo do gateway NXTV. */
export async function fetchNxtvFeed(baseUrl?: string): Promise<NxtvChannel[]> {
  const url = (baseUrl || "").trim() || NXTV_BASE_URL;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return Array.isArray(json) ? (json as NxtvChannel[]) : [];
}

/** Endpoint público de catálogo (não exige token) — usado como fallback do seletor. */
export function nxtvCatalogUrl(baseUrl?: string): string {
  const url = (baseUrl || "").trim() || NXTV_BASE_URL;
  try {
    const u = new URL(url);
    return `${u.origin}/api/channels/catalog?app=1`;
  } catch {
    return "https://gateway.nxtv.com.br/api/channels/catalog?app=1";
  }
}

/** Lista de canais via catálogo público (id + título). */
export async function fetchNxtvCatalogList(baseUrl?: string): Promise<{ id: string; name: string }[]> {
  const res = await fetch(nxtvCatalogUrl(baseUrl), { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} no catálogo NXTV`);
  const json = await res.json();
  const arr = Array.isArray(json) ? json : [];
  return arr
    .map((c: { id?: unknown; title?: unknown; subtitle?: unknown }) => ({
      id: String(c?.id ?? "").trim(),
      name: String(c?.title || c?.subtitle || c?.id || "").trim(),
    }))
    .filter((c) => c.id)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
}

/** Lista simplificada de canais (feed EPG; se falhar, catálogo público). */
export async function fetchNxtvChannelList(baseUrl?: string): Promise<{ id: string; name: string }[]> {
  try {
    const feed = await fetchNxtvFeed(baseUrl);
    const list = feed
      .map((c) => ({ id: String(c.channel_id ?? "").trim(), name: (c.channel_title || "").trim() || String(c.channel_id ?? "") }))
      .filter((c) => c.id)
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
    if (list.length) return list;
  } catch (e) {
    console.warn("[nxtv] feed /epg indisponível, usando catálogo público:", e);
  }
  return fetchNxtvCatalogList(baseUrl);
}


/** Busca e converte o EPG de um canal NXTV (por channel_id OU channel_title). */
export async function fetchNxtvPrograms(channelId: string, baseUrl?: string): Promise<EPGProgram[]> {
  const feed = await fetchNxtvFeed(baseUrl);
  const key = channelId.trim().toLowerCase();
  const match = feed.find(
    (c) => String(c.channel_id ?? "").trim().toLowerCase() === key ||
           (c.channel_title || "").trim().toLowerCase() === key
  );
  if (!match) throw new Error(`Canal "${channelId}" não encontrado no feed NXTV`);
  return nxtvProgramsToPrograms(match.schedule?.programs);
}
