import { useQueries } from "@tanstack/react-query";
import type { EPGProgram } from "./useEPG";

export interface ChannelEPG {
  channelId: string;
  programs: EPGProgram[];
}

async function fetchEPG(epgUrl: string): Promise<EPGProgram[]> {
  let url = epgUrl;
  if (!url.includes("epg.json")) {
    url = url.replace("epg.xml", "epg.json");
  }
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = await res.json();
  return (json.epg_list || []) as EPGProgram[];
}

export function useMultiEPG(channels: { id: string; epg_url?: string | null }[]) {
  const queries = useQueries({
    queries: channels.map((ch) => ({
      queryKey: ["epg", ch.epg_url],
      enabled: !!ch.epg_url,
      staleTime: 60000,
      refetchInterval: 120000,
      queryFn: () => fetchEPG(ch.epg_url!),
    })),
  });

  const epgMap = new Map<string, EPGProgram[]>();
  channels.forEach((ch, i) => {
    if (queries[i]?.data) {
      epgMap.set(ch.id, queries[i].data!);
    }
  });

  return epgMap;
}
