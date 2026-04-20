import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { normalizeGithubUrl, type EPGProgram } from "./useEPG";

interface ChannelEPGInput {
  id: string;
  epg_type?: string | null;
  epg_url?: string | null;
  epg_channel_id?: string | null;
}

function parseXmltvDate(str: string): Date | null {
  const match = str.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?/);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, tz] = match;
  const isoStr = `${y}-${mo}-${d}T${h}:${mi}:${s}${tz ? tz.replace(/(\d{2})(\d{2})/, "$1:$2") : "+00:00"}`;
  return new Date(isoStr);
}

type XmltvBundle = { kind: "xmltv"; byChannel: Map<string, EPGProgram[]> };
type EpgPwBundle = { kind: "epgpw"; programs: EPGProgram[] };
type Bundle = XmltvBundle | EpgPwBundle;

async function fetchXmltvBundle(url: string): Promise<XmltvBundle> {
  const proxyUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/epg-proxy?url=${encodeURIComponent(normalizeGithubUrl(url))}`;
  const res = await fetch(proxyUrl);
  const byChannel = new Map<string, EPGProgram[]>();
  if (!res.ok) return { kind: "xmltv", byChannel };
  const text = await res.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "text/xml");
  // Single pass over all programmes — group by channel attribute
  const programmes = doc.getElementsByTagName("programme");
  for (let i = 0; i < programmes.length; i++) {
    const prog = programmes[i];
    const channelId = prog.getAttribute("channel") || "";
    if (!channelId) continue;
    const startAttr = prog.getAttribute("start") || "";
    const startDate = parseXmltvDate(startAttr);
    if (!startDate) continue;
    const titleEl = prog.getElementsByTagName("title")[0];
    const descEl = prog.getElementsByTagName("desc")[0];
    const ratingEl = prog.querySelector("rating value");
    const program: EPGProgram = {
      title: titleEl?.textContent || "",
      start_date: startDate.toISOString(),
      desc: descEl?.textContent || null,
      rating: ratingEl?.textContent || null,
    };
    const arr = byChannel.get(channelId);
    if (arr) arr.push(program);
    else byChannel.set(channelId, [program]);
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

export function useMultiEPG(channels: ChannelEPGInput[]) {
  // Group channels by unique source (type + url) so each EPG file is fetched/parsed ONCE
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
  }, [channels.map((c) => `${c.epg_type}|${c.epg_url}`).join("~")]);

  const queries = useQueries({
    queries: sources.map((src) => ({
      queryKey: ["epg-bundle", src.kind, src.url],
      staleTime: 60_000,
      refetchInterval: 120_000,
      queryFn: () => (src.kind === "xmltv" ? fetchXmltvBundle(src.url) : fetchEpgPw(src.url)),
    })),
  });

  // Build stable map only when query data changes
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
  }, [dataSig, channels.length]);

  return epgMap;
}
