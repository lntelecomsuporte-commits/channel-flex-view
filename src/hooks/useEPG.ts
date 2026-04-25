import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

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

const IS_NATIVE = typeof window !== "undefined" && !!(window as any).Capacitor?.isNativePlatform?.();

const yieldToMain = () =>
  new Promise<void>((resolve) => {
    // @ts-ignore scheduler é suportado em Chromium moderno / WebView recente
    if (typeof scheduler !== "undefined" && scheduler.yield) {
      // @ts-ignore
      scheduler.yield().then(resolve);
    } else if (typeof requestIdleCallback !== "undefined") {
      // No APK preferimos idle callback para não competir com o vídeo
      requestIdleCallback(() => resolve(), { timeout: 200 });
    } else {
      setTimeout(resolve, 0);
    }
  });

export function getEpgSource(channel: {
  epg_type?: string | null;
  epg_url?: string | null;
}) {
  const effectiveType = channel.epg_type || (channel.epg_url ? "epg_pw" : null);
  if (!effectiveType || effectiveType === "none" || effectiveType === "alt_text" || !channel.epg_url) {
    return null;
  }
  const isXmltv = effectiveType === "iptv_epg_org" || effectiveType === "open_epg" || effectiveType === "github_xml";
  return {
    kind: (isXmltv ? "xmltv" : "epgpw") as "xmltv" | "epgpw",
    url: channel.epg_url,
  };
}

export async function fetchXmltvBundle(url: string, channelIds?: string[]): Promise<XmltvBundle> {
  let proxyUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/epg-proxy?url=${encodeURIComponent(normalizeGithubUrl(url))}`;
  if (channelIds && channelIds.length > 0) {
    // Pede ao servidor para filtrar — devolve apenas <programme> dos canais usados.
    // Reduz drasticamente o tamanho do download e o parsing no aparelho.
    const unique = Array.from(new Set(channelIds.filter(Boolean))).sort();
    proxyUrl += `&channels=${encodeURIComponent(unique.join(","))}`;
  }
  const res = await fetch(proxyUrl);
  const byChannel = new Map<string, EPGProgram[]>();
  if (!res.ok) return { kind: "xmltv", byChannel };
  const text = await res.text();

  await yieldToMain();
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "text/xml");
  await yieldToMain();

  const programmes = doc.getElementsByTagName("programme");
  const total = programmes.length;
  const CHUNK = IS_NATIVE ? 100 : 500;

  for (let i = 0; i < total; i++) {
    const prog = programmes[i];
    const channelId = prog.getAttribute("channel");
    if (!channelId) continue;
    const startAttr = prog.getAttribute("start");
    if (!startAttr) continue;
    const startIso = parseXmltvDateToIso(startAttr);
    if (!startIso) continue;

    const titleEl = prog.getElementsByTagName("title")[0];
    const descEl = prog.getElementsByTagName("desc")[0];
    const ratingEl = prog.querySelector("rating value");

    const program: EPGProgram = {
      title: titleEl?.textContent || "",
      start_date: startIso,
      desc: descEl?.textContent || null,
      rating: ratingEl?.textContent || null,
    };

    const arr = byChannel.get(channelId);
    if (arr) arr.push(program);
    else byChannel.set(channelId, [program]);

    if (i > 0 && i % CHUNK === 0) {
      await yieldToMain();
    }
  }

  byChannel.forEach((arr) => arr.sort((a, b) => a.start_date.localeCompare(b.start_date)));
  return { kind: "xmltv", byChannel };
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
    queryKey: ["epg-bundle", source?.kind ?? "none", source?.url ?? ""],
    enabled: enabled && !!source,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchInterval: 10 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    queryFn: () => {
      if (!source) return Promise.resolve({ kind: "epgpw", programs: [] } as Bundle);
      return source.kind === "xmltv" ? fetchXmltvBundle(source.url) : fetchEpgPw(source.url);
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
