// @vitest-environment node
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import ts from "typescript";
import { describe, it, expect, vi } from "vitest";

const source = readFileSync("supabase/functions/hls-proxy/index.ts", "utf8")
  .replace(/^import \{ createClient \} from [^;]+;/m, "");
const js = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const secret = "test-only-stream-secret";

function setup(options: { blocked?: boolean; active?: boolean; channelActive?: boolean; stream?: string } = {}) {
  let handler: (request: Request) => Promise<Response> = async () => new Response(null, { status: 500 });
  const fetchMock = vi.fn(async () => new Response("#EXTM3U\n#EXTINF:6,\nsegment.ts\n", {
    headers: { "content-type": "application/vnd.apple.mpegurl" },
  }));
  const from = vi.fn((table: string) => {
    const data = table === "profiles"
      ? { user_id: "user-1", is_active: options.active ?? true, is_blocked: options.blocked ?? false }
      : table === "channels"
        ? { stream_url: options.stream ?? "https://provider.example/live/index.m3u8", is_active: options.channelActive ?? true, name: "Test channel" }
        : null;
    const query: Record<string, unknown> = {};
    for (const key of ["select", "eq", "is", "gte", "order", "limit", "insert", "update"]) query[key] = () => query;
    query.maybeSingle = async () => ({ data });
    return query;
  });
  new Function("Deno", "createClient", "fetch", "crypto", js)(
    { env: { get: (name: string) => name === "STREAM_TOKEN_SECRET" ? secret : "test-env" }, serve: (fn: typeof handler) => { handler = fn; } },
    () => ({ from }), fetchMock, webcrypto,
  );
  return { handler, fetchMock, from };
}

const request = (query = "ch=channel-1&pt=test-playlist", method = "GET") =>
  new Request(`https://tv2.lntelecom.net/functions/v1/hls-proxy/playlist.m3u8?${query}`, { method });

describe("Existing M3U links", () => {
  it("redirects the existing channel path without fetching any video", async () => {
    const { handler, fetchMock } = setup();
    const response = await handler(request());
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://provider.example/live/index.m3u8");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves the changed destination without changing the saved playlist link", async () => {
    const { handler } = setup({ stream: "https://new-provider.example/new.ts" });
    expect((await handler(request())).headers.get("location")).toBe("https://new-provider.example/new.ts");
  });

  it.each([{ blocked: true }, { active: false }])("rejects a blocked/inactive subscriber: %j", async (options) => {
    const { handler, fetchMock } = setup(options);
    const response = await handler(request());
    expect(response.status).toBe(401);
    expect(response.headers.get("location")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a disabled channel", async () => {
    expect((await setup({ channelActive: false }).handler(request())).status).toBe(404);
  });

  it("preserves existing private-host restrictions", async () => {
    expect((await setup({ stream: "http://192.168.1.1/live.ts" }).handler(request())).status).toBe(403);
  });

  it("redirects HEAD requests without reporting playback", async () => {
    const { handler, from } = setup();
    expect((await handler(request(undefined, "HEAD"))).status).toBe(302);
    expect(from.mock.calls.map(([table]) => table)).toEqual(["profiles", "channels"]);
  });

  it("accepts encrypted segments from previously loaded manifests", async () => {
    const key = await webcrypto.subtle.importKey("raw", await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)), "AES-GCM", false, ["encrypt"]);
    const iv = new Uint8Array(12);
    const encrypted = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode("https://provider.example/live/segment.ts"));
    const cipher = Buffer.concat([Buffer.from(iv), Buffer.from(encrypted)]).toString("base64url");
    const { handler, fetchMock } = setup();
    const response = await handler(request(`ch=channel-1&pt=test-playlist&u=${cipher}`));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://provider.example/live/segment.ts");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps signed browser playback proxied even with an extra playlist parameter", async () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const key = await webcrypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = Buffer.from(await webcrypto.subtle.sign("HMAC", key, new TextEncoder().encode(`user-1.channel-1.${exp}`))).toString("base64url");
    const { handler, fetchMock } = setup();
    const response = await handler(request(`ch=channel-1&uid=user-1&st=${sig}&exp=${exp}&pt=test-playlist`));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = await response.text();
    expect(body).toContain("/functions/v1/hls-proxy/");
    expect(body).not.toContain("provider.example");
  });
});