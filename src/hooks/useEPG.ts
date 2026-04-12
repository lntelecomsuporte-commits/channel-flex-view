import { useQuery } from "@tanstack/react-query";

export interface EPGProgram {
  title: string;
  start_date: string;
  desc: string | null;
}

export interface EPGData {
  current: EPGProgram | null;
  next: EPGProgram | null;
}

export function useEPG(epgUrl: string | null | undefined) {
  return useQuery<EPGData>({
    queryKey: ["epg", epgUrl],
    enabled: !!epgUrl,
    refetchInterval: 60000, // refresh every minute
    staleTime: 30000,
    queryFn: async () => {
      if (!epgUrl) return { current: null, next: null };

      // Ensure we use the JSON endpoint
      let url = epgUrl;
      if (!url.includes("epg.json")) {
        url = url.replace("epg.xml", "epg.json");
      }

      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch EPG");
      const json = await res.json();

      const programs: EPGProgram[] = json.epg_list || [];
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

      // If no current found, the last program before now
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
