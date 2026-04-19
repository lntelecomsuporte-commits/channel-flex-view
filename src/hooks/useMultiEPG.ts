import { useQueries } from "@tanstack/react-query";
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

async function fetchEPG(ch: ChannelEPGInput): Promise<EPGProgram[]> {
  if (!ch.epg_url) return [];

  if ((ch.epg_type === "iptv_epg_org" || ch.epg_type === "open_epg" || ch.epg_type === "github_xml") && ch.epg_channel_id) {
    const proxyUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/epg-proxy?url=${encodeURIComponent(normalizeGithubUrl(ch.epg_url))}`;
    const res = await fetch(proxyUrl);
    if (!res.ok) return [];
    const text = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, "text/xml");
    const programmes = doc.querySelectorAll(`programme[channel="${ch.epg_channel_id}"]`);
    const programs: EPGProgram[] = [];
    programmes.forEach((prog) => {
      const startAttr = prog.getAttribute("start") || "";
      const title = prog.querySelector("title")?.textContent || "";
      const desc = prog.querySelector("desc")?.textContent || null;
      const ratingEl = prog.querySelector("rating value");
      const rating = ratingEl?.textContent || null;
      const startDate = parseXmltvDate(startAttr);
      if (startDate) {
        programs.push({ title, start_date: startDate.toISOString(), desc, rating });
      }
    });
    programs.sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime());
    return programs;
  }

  // EPG.PW
  let url = ch.epg_url;
  if (!url.includes("epg.json")) {
    url = url.replace("epg.xml", "epg.json");
  }
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = await res.json();
  return (json.epg_list || []) as EPGProgram[];
}

export function useMultiEPG(channels: ChannelEPGInput[]) {
  const queries = useQueries({
    queries: channels.map((ch) => {
      const effectiveType = ch.epg_type || (ch.epg_url ? "epg_pw" : null);
      return {
        queryKey: ["epg-multi", effectiveType, ch.epg_url, ch.epg_channel_id],
        enabled: !!effectiveType && effectiveType !== "none" && effectiveType !== "alt_text" && !!ch.epg_url,
        staleTime: 60000,
        refetchInterval: 120000,
        queryFn: () => fetchEPG({ ...ch, epg_type: effectiveType }),
      };
    }),
  });

  const epgMap = new Map<string, EPGProgram[]>();
  channels.forEach((ch, i) => {
    if (queries[i]?.data) {
      epgMap.set(ch.id, queries[i].data!);
    }
  });

  return epgMap;
}
