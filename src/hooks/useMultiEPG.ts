import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { fetchConsolidatedXmltv, fetchEpgPw, fetchXmltvBundle, getEpgSource, type Bundle, type EPGProgram } from "./useEPG";

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

  // 1) PRIMEIRA escolha: XML consolidado (/epg/lntv.xml) — gerado pelo
  //    sync-epg.mjs no servidor. Já vem só com nossos canais, super leve.
  const consolidated = useQuery({
    queryKey: ["epg-consolidated"],
    enabled,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchInterval: 10 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    queryFn: fetchConsolidatedXmltv,
  });

  // Fallback DESABILITADO: se o canal não está no /epg/lntv.xml consolidado,
  // ele simplesmente fica sem EPG. Antes tentávamos baixar a fonte original
  // (via /epg/sources/<slug>.xml ou epg-proxy), mas isso causava centenas de
  // 404 e travava a UI por minutos. O servidor (sync-epg.mjs) é a única
  // fonte de verdade — se o canal não aparece no consolidado, é porque o
  // epg_channel_id está errado ou a URL não está em epg_url_presets.
  const sources: { key: string; kind: "xmltv" | "epgpw"; url: string; channelIds: string[] }[] = [];

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

  const dataSig = queries.map((q) => (q.data ? "1" : "0")).join("") + (consolidated.data ? "C" : "_");

  const epgMap = useMemo(() => {
    const result = new Map<string, EPGProgram[]>();

    // 1) Aplica primeiro o consolidado (cobre a maioria dos canais)
    if (consolidated.data?.kind === "xmltv") {
      for (const ch of channels) {
        if (!ch.epg_channel_id) continue;
        const arr = consolidated.data.byChannel.get(ch.epg_channel_id);
        if (arr) result.set(ch.id, arr);
      }
    }

    // 2) Preenche os canais faltantes via fallback
    const bundleByKey = new Map<string, Bundle>();
    sources.forEach((src, i) => {
      const data = queries[i]?.data;
      if (data) bundleByKey.set(src.key, data);
    });

    for (const ch of channels) {
      if (result.has(ch.id)) continue;
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
