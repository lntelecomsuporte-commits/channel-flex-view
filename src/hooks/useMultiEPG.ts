import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { fetchEpgPw, fetchXmltvBundle, getEpgSource, type Bundle, type EPGProgram } from "./useEPG";

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

/**
 * Hook que pré-carrega EPG em segundo plano. Pode ser chamado enquanto
 * o usuário está assistindo TV — o parsing roda em chunks com yield para
 * não travar a UI. Quando a lista de canais abrir, os dados já estarão prontos.
 */
export function useMultiEPG(channels: ChannelEPGInput[], enabled: boolean = true) {
  // Group by unique source so each EPG file is fetched/parsed ONCE
  const sourcesKey = channels.map((c) => `${c.epg_type}|${c.epg_url}|${c.epg_channel_id ?? ""}`).join("~");

  const sources = useMemo(() => {
    const map = new Map<string, { kind: "xmltv" | "epgpw"; url: string; channelIds: Set<string> }>();
    for (const ch of channels) {
      const source = getEpgSource(ch);
      if (!source) continue;
      const key = `${source.kind}::${source.url}`;
      let entry = map.get(key);
      if (!entry) {
        entry = { kind: source.kind, url: source.url, channelIds: new Set<string>() };
        map.set(key, entry);
      }
      if (source.kind === "xmltv" && ch.epg_channel_id) {
        entry.channelIds.add(ch.epg_channel_id);
      }
    }
    return Array.from(map.entries()).map(([key, v]) => ({
      key,
      kind: v.kind,
      url: v.url,
      channelIds: Array.from(v.channelIds).sort(),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourcesKey]);

  const queries = useQueries({
    queries: sources.map((src) => ({
      queryKey: ["epg-bundle", src.kind, src.url, src.channelIds.join(",")],
      enabled,
      // Cache agressivo — EPG não muda toda hora
      staleTime: 5 * 60_000, // 5 min
      gcTime: 30 * 60_000, // 30 min
      refetchInterval: 10 * 60_000, // refresh em segundo plano a cada 10 min
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      queryFn: () =>
        src.kind === "xmltv"
          ? fetchXmltvBundle(src.url, src.channelIds.length > 0 ? src.channelIds : undefined)
          : fetchEpgPw(src.url),
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
      const source = getEpgSource(ch);
      if (!source) continue;
      const key = `${source.kind}::${source.url}`;
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
