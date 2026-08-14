/**
 * MasperTV EPG — o site não publica XMLTV, mas expõe a programação em JSON
 * pela REST API do WordPress:
 *
 * https://www.maspertv.com.br/wp-json/schedule/v1/list?id=93&extra=1
 *
 * A resposta é um array de programas com start/end em epoch (segundos, UTC).
 */
import type { EPGProgram } from "@/hooks/useEPG";

export const MASPERTV_BASE_URL = "https://www.maspertv.com.br/wp-json/schedule/v1/list";

export interface MasperTvItem {
  title?: string;
  start?: number | string;
  end?: number | string;
  content?: string | null;
}

/** Monta a URL da API para um ID de programação da MasperTV. */
export function buildMasperTvUrl(scheduleId: string, baseUrl?: string): string {
  const base = (baseUrl || "").trim() || MASPERTV_BASE_URL;
  const params = new URLSearchParams({ id: scheduleId, extra: "1" });
  return `${base}?${params.toString()}`;
}

function stripHtml(text: string): string {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Converte a resposta da MasperTV para o formato interno de programas. */
export function masperItemsToPrograms(items: unknown): EPGProgram[] {
  if (!Array.isArray(items)) return [];
  const out: EPGProgram[] = [];
  for (const raw of items as MasperTvItem[]) {
    const startRaw = raw?.start;
    const startSec = typeof startRaw === "string" ? parseInt(startRaw, 10) : startRaw;
    if (!startSec || !Number.isFinite(startSec)) continue;
    const title = String(raw?.title || "").trim();
    if (!title) continue;
    const desc = stripHtml(String(raw?.content || ""));
    out.push({
      title,
      start_date: new Date(startSec * 1000).toISOString(),
      desc: desc && desc !== title ? desc : null,
      rating: null,
    });
  }
  out.sort((a, b) => a.start_date.localeCompare(b.start_date));
  return out;
}

/** Busca e converte o EPG de um canal MasperTV. */
export async function fetchMasperTvPrograms(scheduleId: string, baseUrl?: string): Promise<EPGProgram[]> {
  const res = await fetch(buildMasperTvUrl(scheduleId, baseUrl));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return masperItemsToPrograms(await res.json());
}
