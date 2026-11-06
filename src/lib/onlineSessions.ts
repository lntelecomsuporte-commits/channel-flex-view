export type OnlineSortKey = "recent" | "name" | "channel" | "ip" | "device";

export type OnlineSessionLike = {
  user_id: string;
  channel_name: string | null;
  ip_address: string | null;
  client_ipv4: string | null;
  client_ipv6: string | null;
  user_agent: string | null;
  platform?: string | null;
  last_seen_at: string;
};

/** Friendly receiver model from platform + user agent. */
export function deviceLabel(s: Pick<OnlineSessionLike, "platform" | "user_agent">): string {
  const ua = (s.user_agent ?? "").toLowerCase();
  const p = (s.platform ?? "").toLowerCase();
  if (p === "m3u") {
    if (ua.includes("tivimate")) return "Lista M3U · TiviMate";
    if (ua.includes("smarters")) return "Lista M3U · Smarters";
    if (ua.includes("vlc")) return "Lista M3U · VLC";
    return "Lista M3U";
  }
  if (p === "roku" || ua.includes("roku")) return "Roku";
  if (p === "tizen" || ua.includes("tizen")) return "Samsung Tizen";
  if (ua.includes("web0s") || ua.includes("webos")) return "LG webOS";
  const aft = ua.match(/\b(aft[a-z0-9]+)\b/);
  if (aft) return `Fire TV (${aft[1].toUpperCase()})`;
  const android = (s.user_agent ?? "").match(/Android [\d.]+; (?:[a-z]{2}[-_][a-z]{2}; )?([^;)]+?)(?: Build|\))/i);
  if (android) return `Android · ${android[1].trim()}`;
  if (p === "android" || ua.includes("android")) return "Android";
  if (ua.includes("iphone") || ua.includes("ipad")) return "iOS";
  if (ua.includes("windows")) return "Windows (navegador)";
  if (ua.includes("mac os")) return "Mac (navegador)";
  if (p) return p;
  return "Desconhecido";
}

export const sessionIp = (s: OnlineSessionLike) => s.client_ipv4 || s.client_ipv6 || s.ip_address || "";

const ipKey = (ip: string) =>
  /^\d+\.\d+\.\d+\.\d+$/.test(ip) ? ip.split(".").map((n) => n.padStart(3, "0")).join(".") : `~${ip}`;

export function sortSessions<T extends OnlineSessionLike>(list: T[], key: OnlineSortKey, label: (uid: string) => string): T[] {
  const cmp = (a: string, b: string) => a.localeCompare(b, "pt-BR", { sensitivity: "base" });
  const recent = (a: T, b: T) => new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime();
  return [...list].sort((a, b) => {
    let r = 0;
    if (key === "name") r = cmp(label(a.user_id), label(b.user_id));
    else if (key === "channel") r = cmp(a.channel_name ?? "\uffff", b.channel_name ?? "\uffff");
    else if (key === "ip") r = ipKey(sessionIp(a)).localeCompare(ipKey(sessionIp(b)));
    else if (key === "device") r = cmp(deviceLabel(a), deviceLabel(b));
    return r || recent(a, b);
  });
}

export function filterSessions<T extends OnlineSessionLike>(list: T[], q: string, label: (uid: string) => string): T[] {
  const t = q.trim().toLowerCase();
  if (!t) return list;
  return list.filter((s) =>
    [label(s.user_id), s.channel_name, s.client_ipv4, s.client_ipv6, s.ip_address, deviceLabel(s)]
      .some((v) => (v ?? "").toLowerCase().includes(t)));
}

/** Groups sessions by user, keeping the given order of first appearance. */
export function groupByUser<T extends OnlineSessionLike>(list: T[]): { user_id: string; sessions: T[] }[] {
  const map = new Map<string, T[]>();
  list.forEach((s) => {
    const arr = map.get(s.user_id);
    if (arr) arr.push(s); else map.set(s.user_id, [s]);
  });
  return [...map.entries()].map(([user_id, sessions]) => ({ user_id, sessions }));
}
