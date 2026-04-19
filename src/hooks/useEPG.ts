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

// Parse XMLTV format from iptv-epg.org for a specific channel ID with timezone offset
async function fetchIptvEpgOrg(xmlUrl: string, channelId: string): Promise<EPGProgram[]> {
  const proxyUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/epg-proxy?url=${encodeURIComponent(xmlUrl)}`;
  const res = await fetch(proxyUrl);
  if (!res.ok) return [];
  const text = await res.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "text/xml");

  const programmes = doc.querySelectorAll(`programme[channel="${channelId}"]`);
  const programs: EPGProgram[] = [];

  programmes.forEach((prog) => {
    const startAttr = prog.getAttribute("start") || "";
    const title = prog.querySelector("title")?.textContent || "";
    const desc = prog.querySelector("desc")?.textContent || null;
    const ratingEl = prog.querySelector("rating value");
    const rating = ratingEl?.textContent || null;

    // Parse XMLTV date format: 20260414120000 +0000
    const startDate = parseXmltvDate(startAttr);
    if (startDate) {
      programs.push({ title, start_date: startDate.toISOString(), desc, rating });
    }
  });

  programs.sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime());
  return programs;
}

// Convert github.com blob URLs to raw.githubusercontent.com
export function normalizeGithubUrl(url: string): string {
  if (!url) return url;
  const m = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
  if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`;
  return url;
}

function parseXmltvDate(str: string): Date | null {
  // Format: 20260414120000 +0000 or 20260414120000
  const match = str.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?/);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, tz] = match;
  const isoStr = `${y}-${mo}-${d}T${h}:${mi}:${s}${tz ? tz.replace(/(\d{2})(\d{2})/, "$1:$2") : "+00:00"}`;
  return new Date(isoStr);
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
}) {
  const { epg_type, epg_url, epg_channel_id } = channel;

  // Backward compat: if no epg_type but has epg_url, treat as epg_pw
  const effectiveType = epg_type || (epg_url ? "epg_pw" : null);

  return useQuery<EPGData>({
    queryKey: ["epg", effectiveType, epg_url, epg_channel_id],
    enabled: !!effectiveType && effectiveType !== "none" && effectiveType !== "alt_text" && !!epg_url,
    refetchInterval: 60000,
    staleTime: 30000,
    queryFn: async () => {
      if (!epg_url) return { current: null, next: null };

      let programs: EPGProgram[] = [];

      if ((effectiveType === "iptv_epg_org" || effectiveType === "open_epg" || effectiveType === "github_xml") && epg_channel_id) {
        programs = await fetchIptvEpgOrg(normalizeGithubUrl(epg_url), epg_channel_id);
      } else {
        // EPG.PW format
        let url = epg_url;
        if (!url.includes("epg.json")) {
          url = url.replace("epg.xml", "epg.json");
        }
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to fetch EPG");
        const json = await res.json();
        programs = json.epg_list || [];
      }

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
    },
  });
}
