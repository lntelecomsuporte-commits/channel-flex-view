import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { normalizeGithubUrl, type EPGProgram } from "./useEPG";

interface ChannelEPGInput {
  id: string;
  epg_type?: string | null;
  epg_url?: string | null;
  epg_channel_id?: string | null;
}

function parseXmltvDate(str: string): string | null {
  // Returns ISO string directly (faster — no Date allocation per program if not needed)
  const match = str.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?/);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, tz] = match;
  const tzFormatted = tz ? tz.replace(/(\d{2})(\d{2})/, "$1:$2") : "+00:00";
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${tzFormatted}`;
}

type XmltvBundle = { kind: "xmltv"; byChannel: Map<string, EPGProgram[]> };
type EpgPwBundle = { kind: "epgpw"; programs: EPGProgram[] };
type Bundle = XmltvBundle | EpgPwBundle;

// Yield to the browser between heavy chunks so UI stays responsive
const yieldToMain = () =>
  new Promise<void>((resolve) => {
    // @ts-ignore — scheduler is available in modern Chromium (Android TV WebView)
    if (typeof scheduler !== "undefined" && scheduler.yield) {
      // @ts-ignore
      scheduler.yield().then(resolve);
    } else {
      setTimeout(resolve, 0);
    }
  });

async function fetchXmltvBundle(url: string): Promise<XmltvBundle> {
  const proxyUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/epg-proxy?url=${encodeURIComponent(normalizeGithubUrl(url))}`;
  const res = await fetch(proxyUrl);
  const byChannel = new Map<string, EPGProgram[]>();
  if (!res.ok) return { kind: "xmltv", byChannel };
  const text = await res.text();

  // Yield before parsing the whole document (can be megabytes)
  await yieldToMain();
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "text/xml");
  await yieldToMain();

  const programmes = doc.getElementsByTagName("programme");
  const total = programmes.length;
  const CHUNK = 500;

  for (let i = 0; i < total; i++) {
    const prog = programmes[i];
    const channelId = prog.getAttribute("channel");
    if (!channelId) continue;
    const startAttr = prog.getAttribute("start");
    if (!startAttr) continue;
    const startIso = parseXmltvDate(startAttr);
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

    // Yield to UI every CHUNK programmes
    if (i > 0 && i % CHUNK === 0) {
      await yieldToMain();
    }
  }

  // Sort each channel's programs once
  byChannel.forEach((arr) => arr.sort((a, b) => a.start_date.localeCompare(b.start_date)));
  return { kind: "xmltv", byChannel };
}

async function fetchEpgPw(url: string): Promise<EpgPwBundle> {
  let u = url;
  if (!u.includes("epg.json")) u = u.replace("epg.xml", "epg.json");
  const res = await fetch(u);
  if (!res.ok) return { kind: "epgpw", programs: [] };
  const json = await res.json();
  return { kind: "epgpw", programs: (json.epg_list || []) as EPGProgram[] };
}

/**
 * Hook que pré-carrega EPG em segundo plano. Pode ser chamado enquanto
 * o usuário está assistindo TV — o parsing roda em chunks com yield para
 * não travar a UI. Quando a lista de canais abrir, os dados já estarão prontos.
 */
export function useMultiEPG(channels: ChannelEPGInput[], enabled: boolean = true) {
  // Group by unique source so each EPG file is fetched/parsed ONCE
  const sourcesKey = channels.map((c) => `${c.epg_type}|${c.epg_url}`).join("~");

  const sources = useMemo(() => {
    const map = new Map<string, { kind: "xmltv" | "epgpw"; url: string }>();
    for (const ch of channels) {
      const effectiveType = ch.epg_type || (ch.epg_url ? "epg_pw" : null);
      if (!effectiveType || effectiveType === "none" || effectiveType === "alt_text" || !ch.epg_url) continue;
      const isXmltv = effectiveType === "iptv_epg_org" || effectiveType === "open_epg" || effectiveType === "github_xml";
      const kind: "xmltv" | "epgpw" = isXmltv ? "xmltv" : "epgpw";
      const key = `${kind}::${ch.epg_url}`;
      if (!map.has(key)) map.set(key, { kind, url: ch.epg_url });
    }
    return Array.from(map.entries()).map(([key, v]) => ({ key, ...v }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourcesKey]);

  const queries = useQueries({
    queries: sources.map((src) => ({
      queryKey: ["epg-bundle", src.kind, src.url],
      enabled,
      // Cache agressivo — EPG não muda toda hora
      staleTime: 5 * 60_000, // 5 min
      gcTime: 30 * 60_000, // 30 min
      refetchInterval: 10 * 60_000, // refresh em segundo plano a cada 10 min
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      queryFn: () => (src.kind === "xmltv" ? fetchXmltvBundle(src.url) : fetchEpgPw(src.url)),
    })),
  });

  const dataSig = queries.map((q) => (q.data ? "1" : "0")).join("");

  const epgMap = useMemo(() => {
    const bundleByKey = new Map<string, Bundle>();
    sources.forEach((src, i) => {
      const data = queries[i]?.data;
      if (data) bundleByKey.set(src.key, data);
    });

    const result = new Map<string, EPGProgram[]>();
    for (const ch of channels) {
      const effectiveType = ch.epg_type || (ch.epg_url ? "epg_pw" : null);
      if (!effectiveType || !ch.epg_url) continue;
      const isXmltv = effectiveType === "iptv_epg_org" || effectiveType === "open_epg" || effectiveType === "github_xml";
      const key = `${isXmltv ? "xmltv" : "epgpw"}::${ch.epg_url}`;
      const bundle = bundleByKey.get(key);
      if (!bundle) continue;
      if (bundle.kind === "xmltv") {
        if (ch.epg_channel_id) {
          const arr = bundle.byChannel.get(ch.epg_channel_id);
          if (arr) result.set(ch.id, arr);
        }
      } else {
        result.set(ch.id, bundle.programs);
      }
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSig, sourcesKey]);

  return epgMap;
}
