import { describe, expect, it } from "vitest";
import { deviceLabel, filterSessions, groupByUser, sortSessions } from "@/lib/onlineSessions";

const s = (user_id: string, channel: string | null, ip: string, ua: string | null, platform: string | null, t: number) => ({
  user_id, channel_name: channel, ip_address: ip, client_ipv4: ip, client_ipv6: null, user_agent: ua, platform,
  last_seen_at: new Date(t).toISOString(),
});
const names: Record<string, string> = { u1: "Lucas", u2: "Ana" };
const label = (id: string) => names[id];

const list = [
  s("u1", "RPC", "10.0.0.20", "Dalvik/2.1.0 (Linux; U; Android 7.1.2; AFTMM Build/NS6711)", "android", 3),
  s("u2", "Band", "9.0.0.1", null, "roku", 2),
  s("u1", "Globo", "100.0.0.1", "TiviMate/4", "m3u", 1),
];

describe("online sessions", () => {
  it("sorts by name, channel, ip and device", () => {
    expect(sortSessions(list, "name", label).map((x) => x.user_id)).toEqual(["u2", "u1", "u1"]);
    expect(sortSessions(list, "channel", label).map((x) => x.channel_name)).toEqual(["Band", "Globo", "RPC"]);
    expect(sortSessions(list, "ip", label).map((x) => x.ip_address)).toEqual(["9.0.0.1", "10.0.0.20", "100.0.0.1"]);
    expect(sortSessions(list, "device", label).map(deviceLabel)).toEqual(["Fire TV (AFTMM)", "Lista M3U · TiviMate", "Roku"]);
  });
  it("groups all points of the same user", () => {
    const g = groupByUser(list);
    expect(g.find((x) => x.user_id === "u1")?.sessions).toHaveLength(2);
  });
  it("filters by name", () => {
    expect(filterSessions(list, "luc", label)).toHaveLength(2);
  });
});
