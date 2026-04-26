import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Capacitor } from "@capacitor/core";
import { getLocalFunctionUrl } from "@/lib/localBackend";
import { getConsolidatedEpgUrl, getConsolidatedEpgJsonUrl, getLocalSourceUrl } from "@/lib/epgCache";

export interface EPGProgram {
  title: string;
  start_date: string;
  desc: string | null;
  rating: string | null;
}

export interface EPGData {
  current: EPGProgram | null;
  next: EPGProgram | null;
}

export type XmltvBundle = { kind: "xmltv"; byChannel: Map<string, EPGProgram[]> };
export type EpgPwBundle = { kind: "epgpw"; programs: EPGProgram[] };
export type Bundle = XmltvBundle | EpgPwBundle;

export function getCurrentAndNextPrograms(programs: EPGProgram[]): EPGData {
  const now = new Date();
  let current: EPGProgram | null = null;
  let next: EPGProgram | null = null;

  for (let i = 0; i < programs.length; i++) {
    const start = new Date(programs[i].start_date);
    const endTime = i + 1 < programs.length ? new Date(programs[i + 1].start_date) : null;
    if (start <= now && (!endTime || endTime > now)) {
      current = programs[i];
      next = programs[i + 1] || null;
      break;
    }
  }

  if (!current && programs.length > 0) {
    for (let i = programs.length - 1; i >= 0; i--) {
      if (new Date(programs[i].start_date) <= now) {
        current = programs[i];
        next = programs[i + 1] || null;
        break;
      }
    }
  }

  return { current, next };
}

// Convert github.com blob URLs to raw.githubusercontent.com
export function normalizeGithubUrl(url: string): string {
  if (!url) return url;
  const m = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
  if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`;
  return url;
}

export function parseXmltvDate(str: string): Date | null {
  // Format: 20260414120000 +0000 or 20260414120000
  const match = str.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?/);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, tz] = match;
  const isoStr = `${y}-${mo}-${d}T${h}:${mi}:${s}${tz ? tz.replace(/(\d{2})(\d{2})/, "$1:$2") : "+00:00"}`;
  return new Date(isoStr);
}

function parseXmltvDateToIso(str: string): string | null {
  const parsed = parseXmltvDate(str);
  return parsed ? parsed.toISOString() : null;
}

const IS_NATIVE = Capacitor.isNativePlatform();

const yieldToMain = () =>
  new Promise<void>((resolve) => {
    // No APK NUNCA usar requestIdleCallback — com o vídeo HLS rodando
    // o thread principal nunca fica idle e o parser trava por minutos.
    if (IS_NATIVE) {
      setTimeout(resolve, 0);
      return;
    }
    // @ts-ignore scheduler é suportado em Chromium moderno
    if (typeof scheduler !== "undefined" && scheduler.yield) {
      // @ts-ignore
      scheduler.yield().then(resolve);
    } else if (typeof requestIdleCallback !== "undefined") {
      requestIdleCallback(() => resolve(), { timeout: 200 });
    } else {
      setTimeout(resolve, 0);
    }
  });

export function getEpgSource(channel: {
  epg_type?: string | null;
  epg_url?: string | null;
}) {
  const effectiveType = channel.epg_type || (channel.epg_url ? "xmltv" : null);
  if (!effectiveType || effectiveType === "none" || effectiveType === "alt_text" || !channel.epg_url) {
    return null;
  }
  // Legacy values (iptv_epg_org, open_epg, github_xml, epg_pw) all treated as xmltv now.
  const isEpgPw = effectiveType === "epg_pw";
  return {
    kind: (isEpgPw ? "epgpw" : "xmltv") as "xmltv" | "epgpw",
    url: channel.epg_url,
  };
}

async function fetchXmlText(url: string, channelIds?: string[]): Promise<string | null> {
  // 1) Tenta cache local servido pelo nginx (mesmo domínio, sem CORS, sem anti-bot).
  //    O servidor (scripts/sync-epg.mjs) baixa as URLs salvas em epg_url_presets
  //    a cada 3h. Funciona para QUALQUER URL que tenha sido cadastrada no admin.
  try {
    const localRes = await fetch(getLocalSourceUrl(url), { cache: "no-cache" });
    if (localRes.ok) {
      const text = await localRes.text();
      if (text && text.length > 100) return text;
    }
  } catch { /* segue pro fallback */ }

  // 2) Fallback: proxy remoto (URLs não cacheadas / dev local sem nginx)
  let proxyUrl = `${getLocalFunctionUrl("epg-proxy")}?url=${encodeURIComponent(normalizeGithubUrl(url))}`;
  if (channelIds && channelIds.length > 0) {
    const unique = Array.from(new Set(channelIds.filter(Boolean))).sort();
    proxyUrl += `&channels=${encodeURIComponent(unique.join(","))}`;
  }
  try {
    const res = await fetch(proxyUrl);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Lê o XML consolidado /epg/lntv.xml (gerado pelo sync-epg.mjs no servidor).
 * Contém SÓ os nossos canais — geralmente alguns KB. Reduz drasticamente o
 * trabalho de parsing nos receptores. Quando disponível, dispensa qualquer
 * fetch das URLs originais.
 */
export async function fetchConsolidatedXmltv(): Promise<XmltvBundle | null> {
  // 1) JSON pré-parseado — instantâneo no APK (sem regex em ~1MB de XML)
  try {
    const res = await fetch(getConsolidatedEpgJsonUrl(), { cache: "no-cache" });
    if (res.ok) {
      const json = await res.json();
      const byChannelObj = json?.byChannel;
      if (byChannelObj && typeof byChannelObj === "object") {
        const byChannel = new Map<string, EPGProgram[]>();
        for (const id of Object.keys(byChannelObj)) {
          const arr = byChannelObj[id];
          if (Array.isArray(arr)) byChannel.set(id, arr as EPGProgram[]);
        }
        return { kind: "xmltv", byChannel };
      }
    }
  } catch { /* fallback pro XML */ }

  // 2) Fallback: XML consolidado (parse via regex no cliente)
  try {
    const res = await fetch(getConsolidatedEpgUrl(), { cache: "no-cache" });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text || text.length < 50) return null;
    return await parseXmltvText(text);
  } catch {
    return null;
  }
}

// Decodifica entidades XML básicas (sem DOMParser — muito mais rápido em WebView Android)
function decodeXmlEntities(s: string): string {
  if (!s) return s;
  if (s.indexOf("&") === -1) return s;
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

/**
 * Parser XMLTV via regex — muito mais rápido que DOMParser em WebView Android.
 * O DOMParser de WebViews antigos engasga com arquivos > 500KB e pode travar
 * o thread principal por minutos enquanto o vídeo HLS está rodando.
 */
async function parseXmltvText(text: string): Promise<XmltvBundle> {
  const byChannel = new Map<string, EPGProgram[]>();

  // Regex global para cada <programme ...>...</programme>
  const progRe = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
  const attrRe = /(\w+)\s*=\s*"([^"]*)"/g;
  const titleRe = /<title\b[^>]*>([\s\S]*?)<\/title>/;
  const descRe = /<desc\b[^>]*>([\s\S]*?)<\/desc>/;
  const ratingRe = /<rating\b[^>]*>[\s\S]*?<value\b[^>]*>([\s\S]*?)<\/value>[\s\S]*?<\/rating>/;

  const CHUNK = 400;
  let count = 0;
  let m: RegExpExecArray | null;

  await yieldToMain();

  while ((m = progRe.exec(text)) !== null) {
    const attrs = m[1];
    const inner = m[2];

    let channelId: string | null = null;
    let startAttr: string | null = null;
    attrRe.lastIndex = 0;
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(attrs)) !== null) {
      if (am[1] === "channel") channelId = am[2];
      else if (am[1] === "start") startAttr = am[2];
      if (channelId && startAttr) break;
    }
    if (!channelId || !startAttr) continue;

    const startIso = parseXmltvDateToIso(startAttr);
    if (!startIso) continue;

    const titleM = titleRe.exec(inner);
    const descM = descRe.exec(inner);
    const ratingM = ratingRe.exec(inner);

    const program: EPGProgram = {
      title: titleM ? decodeXmlEntities(titleM[1].trim()) : "",
      start_date: startIso,
      desc: descM ? decodeXmlEntities(descM[1].trim()) : null,
      rating: ratingM ? decodeXmlEntities(ratingM[1].trim()) : null,
    };

    const arr = byChannel.get(channelId);
    if (arr) arr.push(program);
    else byChannel.set(channelId, [program]);

    count++;
    if (count % CHUNK === 0) {
      await yieldToMain();
    }
  }

  byChannel.forEach((arr) => arr.sort((a, b) => a.start_date.localeCompare(b.start_date)));
  return { kind: "xmltv", byChannel };
}

export async function fetchXmltvBundle(url: string, channelIds?: string[]): Promise<XmltvBundle> {
  const text = await fetchXmlText(url, channelIds);
  if (!text) return { kind: "xmltv", byChannel: new Map() };
  return await parseXmltvText(text);
}

export async function fetchEpgPw(url: string): Promise<EpgPwBundle> {
  let resolvedUrl = url;
  if (!resolvedUrl.includes("epg.json")) resolvedUrl = resolvedUrl.replace("epg.xml", "epg.json");
  const res = await fetch(resolvedUrl);
  if (!res.ok) return { kind: "epgpw", programs: [] };
  const json = await res.json();
  return { kind: "epgpw", programs: (json.epg_list || []) as EPGProgram[] };
}

// Get logo URL from iptv-epg.org XML
export async function fetchIptvEpgLogo(xmlUrl: string, channelId: string): Promise<string | null> {
  try {
    const res = await fetch(xmlUrl);
    if (!res.ok) return null;
    const text = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, "text/xml");
    const channel = doc.querySelector(`channel[id="${channelId}"]`);
    if (!channel) return null;
    const icon = channel.querySelector("icon");
    return icon?.getAttribute("src") || null;
  } catch {
    return null;
  }
}

export function useEPG(channel: {
  epg_type?: string | null;
  epg_url?: string | null;
  epg_channel_id?: string | null;
}, enabled: boolean = true) {
  const source = getEpgSource(channel);

  const bundleQuery = useQuery<Bundle>({
    queryKey: ["epg-bundle", source?.kind ?? "none", source?.url ?? "", channel.epg_channel_id ?? ""],
    enabled: enabled && !!source,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchInterval: 10 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    queryFn: () => {
      if (!source) return Promise.resolve({ kind: "epgpw", programs: [] } as Bundle);
      return source.kind === "xmltv"
        ? fetchXmltvBundle(source.url, channel.epg_channel_id ? [channel.epg_channel_id] : undefined)
        : fetchEpgPw(source.url);
    },
  });

  const data = useMemo<EPGData>(() => {
    if (!bundleQuery.data || !source) return { current: null, next: null };

    const programs =
      bundleQuery.data.kind === "xmltv"
        ? channel.epg_channel_id
          ? bundleQuery.data.byChannel.get(channel.epg_channel_id) || []
          : []
        : bundleQuery.data.programs;

    return getCurrentAndNextPrograms(programs);
  }, [bundleQuery.data, source, channel.epg_channel_id]);

  return {
    ...bundleQuery,
    data,
  };
}
