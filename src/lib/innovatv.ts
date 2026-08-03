/**
 * InnovaTV EPG — API JSON usada por alguns canais (BM&C News, Hallo Anime, …).
 *
 * Exemplo:
 * https://api.innovatv.tv.br/epg/api/epg_list/by_date?date=-2,2&id=BM%26CBM%26C+News&time_zone=America%2FSao_Paulo
 *
 * A resposta é um array plano de programas com start_ut/stop_ut (epoch segundos).
 */
import type { EPGProgram } from "@/hooks/useEPG";

export const INNOVATV_BASE_URL = "https://api.innovatv.tv.br/epg/api/epg_list/by_date";
export const INNOVATV_TIMEZONE = "America/Sao_Paulo";
export const INNOVATV_DATE_RANGE = "-2,2";

export interface InnovaTvItem {
  start_ut?: number | string;
  start?: number | string;
  title?: string;
  desc?: string | null;
  pg?: string | null;
}

/** Monta a URL da API para um ID de canal da InnovaTV. */
export function buildInnovaTvUrl(channelId: string, baseUrl?: string): string {
  const base = (baseUrl || "").trim() || INNOVATV_BASE_URL;
  const params = new URLSearchParams({
    date: INNOVATV_DATE_RANGE,
    id: channelId,
    time_zone: INNOVATV_TIMEZONE,
  });
  return `${base}?${params.toString()}`;
}

/** Converte a resposta da InnovaTV para o formato interno de programas. */
export function innovaItemsToPrograms(items: unknown): EPGProgram[] {
  if (!Array.isArray(items)) return [];
  const out: EPGProgram[] = [];
  for (const raw of items as InnovaTvItem[]) {
    const startRaw = raw?.start_ut ?? raw?.start;
    const startSec = typeof startRaw === "string" ? parseInt(startRaw, 10) : startRaw;
    if (!startSec || !Number.isFinite(startSec)) continue;
    const title = (raw?.title || "").trim();
    const descRaw = (raw?.desc || "").trim();
    const pg = (raw?.pg || "").trim();
    out.push({
      title,
      start_date: new Date(startSec * 1000).toISOString(),
      desc: descRaw && descRaw !== title ? descRaw : null,
      rating: pg && pg !== "S/C" && pg !== "-1" ? pg : null,
    });
  }
  out.sort((a, b) => a.start_date.localeCompare(b.start_date));
  return out;
}

/** Busca e converte o EPG de um canal InnovaTV. */
export async function fetchInnovaTvPrograms(channelId: string, baseUrl?: string): Promise<EPGProgram[]> {
  const res = await fetch(buildInnovaTvUrl(channelId, baseUrl));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return innovaItemsToPrograms(await res.json());
}
