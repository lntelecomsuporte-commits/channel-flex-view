import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync("supabase/functions/session-heartbeat/index.ts", "utf8")
  .replace(/^import \{ createClient \} from [^;]+;/m, "");
const js = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

type DeviceBinding = { id: string; user_id: string; is_active: boolean } | null;

type SetupOptions = {
  ended?: boolean;
  pendingCommand?: string | null;
  device?: DeviceBinding;
  forceSignoutAt?: string | null;
  sessionDeviceId?: string | null;
  sessionPlatform?: string | null;
};

function setup(options: SetupOptions = {}) {
  let handler = async (_request: Request): Promise<Response> => new Response(null, { status: 500 });
  const update = vi.fn();
  const insert = vi.fn();
  let binding: DeviceBinding = options.device === undefined
    ? { id: "device-1", user_id: "user-1", is_active: true }
    : options.device;
  const row = {
    id: "session-1",
    user_id: "user-1",
    started_at: "2026-11-06T03:00:00Z",
    ended_at: options.ended ? "2026-11-06T03:10:00Z" : null,
    last_command_at: null,
    device_id: options.sessionDeviceId ?? null,
    platform: options.sessionPlatform ?? null,
  };

  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    let inserting = false;
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters[key] = value; return query; },
      or: () => query,
      gt: () => query,
      order: () => query,
      limit: () => query,
      is: (key: string, value: unknown) => { filters[key] = value; return query; },
      insert: (value: Record<string, unknown>) => {
        inserting = true;
        insert({ table, value });
        if (table === "user_devices") {
          binding = {
            id: "inserted-device",
            user_id: String(value.user_id),
            is_active: value.is_active === true,
          };
        }
        return query;
      },
      update: (value: unknown) => { update({ table, value }); return query; },
      maybeSingle: async () => {
        if (table === "app_commands") {
          return {
            data: options.pendingCommand
              ? { command: options.pendingCommand, created_at: "2026-11-06T03:05:00Z" }
              : null,
            error: null,
          };
        }
        if (table === "profiles") {
          return { data: { force_signout_at: options.forceSignoutAt ?? null }, error: null };
        }
        if (table === "user_devices") return { data: binding, error: null };
        const matches = Object.entries(filters).every(
          ([key, value]) => row[key as keyof typeof row] === value,
        );
        return { data: matches ? row : null, error: null };
      },
      single: async () => ({
        data: inserting && table === "user_sessions"
          ? { id: "new-session", started_at: "2026-11-06T04:00:00Z" }
          : null,
        error: null,
      }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({
        data: table === "user_devices" ? [] : null,
        error: null,
      }).then(resolve),
    };
    return query;
  };

  new Function("Deno", "createClient", js)(
    { env: { get: () => "test-only" }, serve: (fn: typeof handler) => { handler = fn; } },
    () => ({
      from,
      rpc: async () => ({ data: 3, error: null }),
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    }),
  );

  const invoke = (body: Record<string, unknown>) => handler(new Request(
    "https://tv2.lntelecom.net/functions/v1/session-heartbeat",
    {
      method: "POST",
      headers: { Authorization: "Bearer test-only", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  ));
  return { invoke, update, insert };
}

const nativeStart = {
  action: "start",
  sessionToken: "native-session",
  userAgent: "LNTV-Native/1.0.62 Android 12",
  platform: "android",
  deviceId: "C48570EDDF",
  isWatching: true,
};

describe("Monitoring session recovery", () => {
  it("rejects an ended session and allows creation of a new visible session", async () => {
    const { invoke, update } = setup({ ended: true });
    const response = await invoke({ action: "heartbeat", sessionId: "session-1", platform: "roku", isWatching: true });
    expect(response.status).toBe(404);
    expect(update).not.toHaveBeenCalled();
    const recreated = await invoke({ action: "start", sessionToken: "test-roku-session", platform: "roku", channelId: "rpc-id", isWatching: true });
    expect(recreated.status).toBe(200);
    expect(await recreated.json()).toEqual({ id: "new-session" });
  });

  it("continues updating an active session", async () => {
    const { invoke, update } = setup();
    const response = await invoke({ action: "heartbeat", sessionId: "session-1", channelId: "rpc-id", channelName: "RPC", isWatching: true });
    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith({
      table: "user_sessions",
      value: expect.objectContaining({ current_channel_id: "rpc-id", current_channel_name: "RPC", is_watching: true }),
    });
  });

  it("accepts Roku lowercase keys when starting and refreshing a session", async () => {
    const { invoke, update } = setup();
    const started = await invoke({ action: "start", sessiontoken: "roku-1", useragent: "Roku/Express", platform: "roku", deviceid: "ABCD12EF", channelid: "rpc-id", iswatching: true });
    expect(started.status).toBe(200);
    expect(await started.json()).toEqual({ id: "new-session" });
    const beat = await invoke({ action: "heartbeat", sessionid: "session-1", channelid: "rpc-id", channelname: "RPC", iswatching: true, platform: "roku", deviceid: "ABCD12EF" });
    expect(beat.status).toBe(200);
    expect(update).toHaveBeenCalledWith({
      table: "user_sessions",
      value: expect.objectContaining({ current_channel_id: "rpc-id", current_channel_name: "RPC", is_watching: true, device_id: "ABCD12EF" }),
    });
  });

  it("does not update another user's session", async () => {
    const { invoke, update } = setup();
    expect((await invoke({ action: "heartbeat", sessionId: "someone-elses-session" })).status).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });

  it("delivers a pending remote command on heartbeat", async () => {
    const { invoke } = setup({ pendingCommand: "force_close" });
    const res = await invoke({ action: "heartbeat", sessionId: "session-1" });
    expect(await res.json()).toMatchObject({ command: "force_close" });
  });
});

describe("Remote signout and device revocation", () => {
  it("returns force_close with forceSignout and ends the revoked login session", async () => {
    const { invoke, update } = setup({ forceSignoutAt: "2026-11-06T03:05:00Z" });
    const res = await invoke({ action: "heartbeat", sessionId: "session-1" });
    expect(await res.json()).toEqual({ forceSignout: true, command: "force_close" });
    expect(update).toHaveBeenCalledWith({ table: "user_sessions", value: { ended_at: expect.any(String) } });
  });

  it("closes the installed Native app when its device binding was removed", async () => {
    const { invoke, update } = setup({
      device: null,
      sessionDeviceId: "C48570EDDF",
      sessionPlatform: "android",
    });
    const res = await invoke({ action: "heartbeat", sessionId: "session-1", platform: "android", deviceId: "C48570EDDF" });
    expect(await res.json()).toEqual({ forceSignout: true, command: "force_close", reason: "device_revoked" });
    expect(update).toHaveBeenCalledWith({ table: "user_sessions", value: { ended_at: expect.any(String) } });
    expect(update).not.toHaveBeenCalledWith({
      table: "user_sessions",
      value: expect.objectContaining({ last_heartbeat_at: expect.any(String) }),
    });
  });

  it("closes a blocked device even though its binding still exists", async () => {
    const { invoke } = setup({
      device: { id: "device-1", user_id: "user-1", is_active: false },
      sessionDeviceId: "C48570EDDF",
      sessionPlatform: "android",
    });
    const res = await invoke({ action: "heartbeat", sessionId: "session-1", platform: "android", deviceId: "C48570EDDF" });
    expect(await res.json()).toMatchObject({ command: "force_close", reason: "device_revoked" });
  });

  it("rejects a device bound to a different account", async () => {
    const { invoke } = setup({
      device: { id: "device-1", user_id: "another-user", is_active: true },
      sessionDeviceId: "C48570EDDF",
      sessionPlatform: "android",
    });
    const res = await invoke({ action: "heartbeat", sessionId: "session-1", platform: "android", deviceId: "C48570EDDF" });
    expect(await res.json()).toMatchObject({ command: "force_close", reason: "device_revoked" });
  });

  it("keeps a session with a valid active device binding", async () => {
    const { invoke } = setup({ sessionDeviceId: "C48570EDDF", sessionPlatform: "android" });
    const res = await invoke({ action: "heartbeat", sessionId: "session-1", platform: "android", deviceId: "C48570EDDF" });
    expect(await res.json()).toEqual({ success: true });
  });

  it("gives an unregistered Native start a session id plus close command without recreating its binding", async () => {
    const { invoke, insert } = setup({ device: null });
    const res = await invoke(nativeStart);
    expect(await res.json()).toEqual({ id: "new-session", forceSignout: true, command: "force_close" });
    expect(insert).not.toHaveBeenCalledWith({ table: "user_devices", value: expect.anything() });
  });

  it("does not recreate a removed Roku binding during session start", async () => {
    const { invoke, insert } = setup({ device: null });
    const res = await invoke({ ...nativeStart, userAgent: "Roku/Express", platform: "roku" });
    expect(await res.json()).toMatchObject({ id: "new-session", command: "force_close" });
    expect(insert).not.toHaveBeenCalledWith({ table: "user_devices", value: expect.anything() });
  });

  it("preserves WebView self-registration and allows its new session", async () => {
    const { invoke, insert } = setup({ device: null });
    const res = await invoke({ ...nativeStart, userAgent: "Mozilla/5.0 Linux Android WebView" });
    expect(await res.json()).toEqual({ id: "new-session" });
    expect(insert).toHaveBeenCalledWith({
      table: "user_devices",
      value: expect.objectContaining({ device_id: "C48570EDDF", platform: "android", created_by: "self_register" }),
    });
  });
});
