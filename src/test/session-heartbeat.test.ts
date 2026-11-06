import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync("supabase/functions/session-heartbeat/index.ts", "utf8")
  .replace(/^import \{ createClient \} from [^;]+;/m, "");
const js = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

function setup(ended: boolean) {
  let handler = async (_request: Request): Promise<Response> => new Response(null, { status: 500 });
  const update = vi.fn();
  const row = { id: "session-1", user_id: "user-1", started_at: "2026-11-06T03:00:00Z", ended_at: ended ? "2026-11-06T03:10:00Z" : null };
  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    let inserting = false;
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters[key] = value; return query; },
      is: (key: string, value: unknown) => { filters[key] = value; return query; },
      insert: () => { inserting = true; return query; },
      update: (value: unknown) => { update(value); return query; },
      maybeSingle: async () => ({ data: table === "profiles" ? { force_signout_at: null } :
        Object.entries(filters).every(([key, value]) => row[key as keyof typeof row] === value) ? row : null, error: null }),
      single: async () => ({ data: inserting ? { id: "new-session", started_at: "2026-11-06T04:00:00Z" } : null, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
    };
    return query;
  };
  new Function("Deno", "createClient", js)(
    { env: { get: () => "test-only" }, serve: (fn: typeof handler) => { handler = fn; } },
    () => ({ from, rpc: async () => ({ data: 3, error: null }), auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) } }),
  );
  const invoke = (body: Record<string, unknown>) => handler(new Request("https://tv2.lntelecom.net/functions/v1/session-heartbeat", {
    method: "POST", headers: { Authorization: "Bearer test-only", "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
  return { invoke, update };
}

describe("Monitoring session recovery", () => {
  it("rejects an ended session and allows creation of a new visible session", async () => {
    const { invoke, update } = setup(true);
    const response = await invoke({ action: "heartbeat", sessionId: "session-1", platform: "roku", isWatching: true });
    expect(response.status).toBe(404);
    expect(update).not.toHaveBeenCalled();
    const recreated = await invoke({ action: "start", sessionToken: "test-roku-session", platform: "roku", channelId: "rpc-id", isWatching: true });
    expect(recreated.status).toBe(200);
    expect(await recreated.json()).toEqual({ id: "new-session" });
  });

  it("continues updating an active session", async () => {
    const { invoke, update } = setup(false);
    const response = await invoke({ action: "heartbeat", sessionId: "session-1", channelId: "rpc-id", channelName: "RPC", isWatching: true });
    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ current_channel_id: "rpc-id", current_channel_name: "RPC", is_watching: true }));
  });

  it("accepts Roku lowercase keys when starting and refreshing a session", async () => {
    const { invoke, update } = setup(false);
    const started = await invoke({ action: "start", sessiontoken: "roku-1", useragent: "Roku/Express", platform: "roku", deviceid: "ABCD12EF", channelid: "rpc-id", iswatching: true });
    expect(started.status).toBe(200);
    expect(await started.json()).toEqual({ id: "new-session" });
    const beat = await invoke({ action: "heartbeat", sessionid: "session-1", channelid: "rpc-id", channelname: "RPC", iswatching: true, platform: "roku", deviceid: "ABCD12EF" });
    expect(beat.status).toBe(200);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ current_channel_id: "rpc-id", current_channel_name: "RPC", is_watching: true, device_id: "ABCD12EF" }));
  });

  it("does not update another user's session", async () => {
    const { invoke, update } = setup(false);
    expect((await invoke({ action: "heartbeat", sessionId: "someone-elses-session" })).status).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });
});