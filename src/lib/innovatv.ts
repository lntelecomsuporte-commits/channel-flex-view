/**
 * InnovaTV EPG — plataforma MOTV (mw.innova.tv.br), que exige a conta da InnovaTV.
 *
 * O navegador não faz login na InnovaTV: o scripts/sync-epg.mjs autentica no
 * servidor e publica, sem token, dois arquivos no mesmo domínio do painel:
 *   /epg/sources/innovatv-channels.json  → { channels: [{ id, name, logo }] }
 *   /epg/sources/innovatv-motv.json      → { channels, byChannel: { id: EPGProgram[] } }
 */
import type { EPGProgram } from "@/hooks/useEPG";
import { getConsolidatedEpgJsonUrl, getEpgBaseUrl } from "@/lib/epgCache";

export const INNOVATV_BASE_URL = "https://mw.innova.tv.br";

export interface InnovaTvChannel {
  id: string;
  name: string;
  logo?: string | null;
}

interface InnovaTvFeed {
  channels?: InnovaTvChannel[];
  byChannel?: Record<string, EPGProgram[]>;
}

export const getInnovaTvChannelsUrl = (): string => `${getEpgBaseUrl()}/epg/sources/innovatv-channels.json`;
export const getInnovaTvFeedUrl = (): string => `${getEpgBaseUrl()}/epg/sources/innovatv-motv.json`;

/** Chave de comparação igual à do servidor ("HALLO! Anime" → "halloanime"). */
export function innovaKey(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Aceita o ID numérico ("9") ou o nome do canal, como os cadastros antigos. */
export function findInnovaTvPrograms(channelId: string, feed: InnovaTvFeed): EPGProgram[] | null {
  const wanted = channelId.trim();
  const byChannel = feed?.byChannel;
  if (!wanted || !byChannel) return null;
  if (Array.isArray(byChannel[wanted])) return byChannel[wanted];
  const key = innovaKey(wanted);
  if (!key) return null;
  const match = (feed.channels || []).find((c) => innovaKey(c.id) === key || innovaKey(c.name) === key);
  return match && Array.isArray(byChannel[match.id]) ? byChannel[match.id] : null;
}

const NOT_SYNCED =
  "A lista da InnovaTV ainda não foi baixada no servidor. Configure o .env.innovatv e rode o sync-epg.";

/** Canais da conta InnovaTV, já baixados pelo servidor. */
export async function fetchInnovaTvChannelList(): Promise<InnovaTvChannel[]> {
  const res = await fetch(getInnovaTvChannelsUrl(), { cache: "no-cache" });
  if (res.status === 404) throw new Error(NOT_SYNCED);
  if (!res.ok) throw new Error(`Lista da InnovaTV indisponível (HTTP ${res.status})`);
  const json = await res.json().catch(() => null);
  const list = Array.isArray(json?.channels) ? (json.channels as InnovaTvChannel[]) : [];
  return list
    .map((c) => ({ id: String(c?.id ?? "").trim(), name: String(c?.name || c?.id || "").trim(), logo: c?.logo ?? null }))
    .filter((c) => c.id)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
}

/** Grade de um canal: feed completo da conta e, se faltar, o consolidado já publicado. */
export async function fetchInnovaTvPrograms(channelId: string): Promise<EPGProgram[]> {
  const res = await fetch(getInnovaTvFeedUrl(), { cache: "no-cache" });
  if (res.ok) {
    const feed = (await res.json().catch(() => null)) as InnovaTvFeed | null;
    const programs = feed ? findInnovaTvPrograms(channelId, feed) : null;
    if (programs?.length) return programs;
  }

  const consolidated = await fetch(getConsolidatedEpgJsonUrl(), { cache: "no-cache" });
  if (consolidated.ok) {
    const json = await consolidated.json().catch(() => null);
    const programs = json?.byChannel?.[channelId.trim()];
    if (Array.isArray(programs) && programs.length) return programs as EPGProgram[];
  }

  if (res.status === 404) throw new Error(NOT_SYNCED);
  throw new Error(`Canal "${channelId}" está sem grade na InnovaTV`);
}
