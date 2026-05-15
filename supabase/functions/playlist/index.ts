// Gera playlist M3U pro cliente com URLs hls-proxy assinadas.
// Auth: ?token=<playlist_token> OU ?u=<email>&p=<playlist_password>
// Sem imports remotos: mais confiável no Supabase self-hosted sem cache/rede externa.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, range",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SECRET = Deno.env.get("STREAM_TOKEN_SECRET") ?? "";
const TTL_SECONDS = 30 * 24 * 60 * 60;
const FALLBACK_ORIGIN = "https://tv2.lntelecom.net";
const REST_TIMEOUT_MS = 4_000;

const REST_BASES = [
  Deno.env.get("LNTV_SUPABASE_INTERNAL_URL")?.replace(/\/$/, ""),
  "http://kong:8000",
  "http://supabase-kong:8000",
  SUPABASE_URL,
].filter((value, index, arr): value is string => Boolean(value) && arr.indexOf(value) === index);

type ProfileRow = {
  user_id: string;
  username: string | null;
  is_blocked: boolean;
  is_active: boolean;
  playlist_token: string;
  playlist_password: string;
};

type AccessRow = { category_id: string; is_trial: boolean; trial_expires_at: string | null };
type IncludeRow = { category_id: string; included_category_id: string };
type ChannelRow = {
  id: string;
  name: string;
  channel_number: number | null;
  logo_url: string | null;
  category_id: string | null;
  epg_channel_id: string | null;
};
type CategoryRow = { id: string; name: string };

const textHeaders = (extra: Record<string, string> = {}) => ({
  ...corsHeaders,
  "Content-Type": "text/plain; charset=utf-8",
  ...extra,
});

const errorResponse = (message: string, status: number) =>
  new Response(message, { status, headers: textHeaders() });

const escAttr = (value: string | null | undefined) =>
  (value ?? "").replace(/"/g, "'").replace(/[\r\n,]/g, " ");

const toBase64Url = (bytes: ArrayBuffer): string => {
  let bin = "";
  for (const byte of new Uint8Array(bytes)) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

let signKeyPromise: Promise<CryptoKey> | null = null;
const getSignKey = (): Promise<CryptoKey> => {
  if (!signKeyPromise) {
    signKeyPromise = crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
  }
  return signKeyPromise;
};

const sign = async (payload: string): Promise<string> => {
  const key = await getSignKey();
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return toBase64Url(sig);
};

const restSelect = async <T>(table: string, params: Record<string, string>): Promise<T[]> => {
  let lastError = "no REST base configured";

  for (const base of REST_BASES) {
    const url = new URL(`${base}/rest/v1/${table}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), REST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: {
          apikey: SERVICE_ROLE_KEY,
          authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          accept: "application/json",
        },
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        lastError = `${base} ${res.status}: ${body.slice(0, 240)}`;
        console.error(`[playlist] PostgREST ${table} ${lastError}`);
        continue;
      }

      return await res.json() as T[];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastError = `${base}: ${message}`;
      console.error(`[playlist] PostgREST ${table} failed via ${lastError}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`Database error on ${table}: ${lastError}`);
};

const isLocalProxyHost = (host: string) => {
  const hostname = host.split(":")[0]?.toLowerCase() ?? "";
  return ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(hostname) || hostname.endsWith(".local");
};

const isInternalDockerHost = (host: string) => {
  const hostname = host.split(":")[0]?.toLowerCase() ?? "";
  return hostname === "kong" || hostname === "functions" || hostname.startsWith("supabase-");
};

const getForwardedProtocol = (req: Request, requestUrl: URL) => {
  const forwardedValues = req.headers
    .get("x-forwarded-proto")
    ?.split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean) ?? [];

  if (forwardedValues.includes("https")) return "https";
  if (forwardedValues.includes("http")) return "http";
  return requestUrl.protocol.replace(":", "");
};

const getPublicOrigin = (_req: Request, _requestUrl: URL) => {
  const envOrigin = Deno.env.get("LNTV_PUBLIC_ORIGIN") || Deno.env.get("PUBLIC_PROXY_BASE_URL");
  if (envOrigin) return envOrigin.replace(/\/$/, "");
  return FALLBACK_ORIGIN;
};

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (req.method !== "GET" && req.method !== "HEAD") {
      return errorResponse("Method not allowed", 405);
    }

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      console.error("[playlist] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
      return errorResponse("Server misconfigured", 500);
    }

    const url = new URL(req.url);
    const token = url.searchParams.get("token") ?? url.searchParams.get("t");
    const u = url.searchParams.get("u") ?? url.searchParams.get("username");
    const p = url.searchParams.get("p") ?? url.searchParams.get("password");
    const type = (url.searchParams.get("type") ?? "m3u").toLowerCase();

    const profileParams: Record<string, string> = {
      select: "user_id,username,is_blocked,is_active,playlist_token,playlist_password",
      limit: "1",
    };
    if (token) {
      profileParams.playlist_token = `eq.${token}`;
    } else if (u && p) {
      profileParams.username = `eq.${u}`;
      profileParams.playlist_password = `eq.${p}`;
    } else {
      return errorResponse("Missing credentials. Use ?token=... or ?u=...&p=...", 400);
    }

    const profiles = await restSelect<ProfileRow>("profiles", profileParams);
    if (profiles.length === 0) return errorResponse("Invalid credentials", 401);

    const profile = profiles[0];
    if (profile.is_blocked || !profile.is_active) return errorResponse("Account blocked", 403);

    const [accessRows, includesRows, channelRows, categoryRows] = await Promise.all([
      restSelect<AccessRow>("user_category_access", {
        select: "category_id,is_trial,trial_expires_at",
        user_id: `eq.${profile.user_id}`,
        is_active: "eq.true",
      }),
      restSelect<IncludeRow>("category_includes", { select: "category_id,included_category_id" }),
      restSelect<ChannelRow>("channels", {
        select: "id,name,channel_number,logo_url,category_id,epg_channel_id",
        is_active: "eq.true",
        order: "channel_number.asc.nullslast",
      }),
      restSelect<CategoryRow>("categories", { select: "id,name" }),
    ]);

    const nowSec = Math.floor(Date.now() / 1000);
    const allowed = new Set<string>();
    for (const row of accessRows) {
      if (row.is_trial && row.trial_expires_at) {
        const trialExp = Math.floor(new Date(row.trial_expires_at).getTime() / 1000);
        if (trialExp < nowSec) continue;
      }
      allowed.add(row.category_id);
    }

    let changed = true;
    while (changed) {
      changed = false;
      for (const rel of includesRows) {
        if (allowed.has(rel.category_id) && !allowed.has(rel.included_category_id)) {
          allowed.add(rel.included_category_id);
          changed = true;
        }
      }
    }

    const categoryName = new Map(categoryRows.map((cat) => [cat.id, cat.name]));
    const publicOrigin = getPublicOrigin(req, url);
    const exp = nowSec + TTL_SECONDS;
    const lines: string[] = ["#EXTM3U"];

    for (const ch of channelRows) {
      if (!ch.category_id || !allowed.has(ch.category_id)) continue;
      // VLC usa a extensão no path para decidir o demuxer antes mesmo de ler
      // o Content-Type. Portanto a URL inicial da playlist também precisa
      // parecer um HLS manifest, não só os manifests reescritos pelo proxy.
      const proxyUrl =
        `${publicOrigin}/functions/v1/hls-proxy/playlist.m3u8` +
        `?ch=${encodeURIComponent(ch.id)}` +
        `&pt=${encodeURIComponent(profile.playlist_token)}`;

      const tvgId = ch.epg_channel_id ? ` tvg-id="${escAttr(ch.epg_channel_id)}"` : "";
      const tvgLogo = ch.logo_url ? ` tvg-logo="${escAttr(ch.logo_url)}"` : "";
      const tvgChno = ch.channel_number != null ? ` tvg-chno="${ch.channel_number}"` : "";
      const group = ch.category_id ? ` group-title="${escAttr(categoryName.get(ch.category_id))}"` : "";
      lines.push(`#EXTINF:-1${tvgId}${tvgLogo}${tvgChno}${group},${escAttr(ch.name)}`);
      lines.push(proxyUrl);
    }

    const filename = type === "hls" ? "lntv.hls.m3u" : "lntv.m3u";
    return new Response(req.method === "HEAD" ? null : lines.join("\n") + "\n", {
      status: 200,
      headers: textHeaders({
        "Content-Type": "application/x-mpegurl; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      }),
    });
  } catch (error) {
    console.error("[playlist] Unhandled error", error);
    return errorResponse("Internal playlist error", 500);
  }
});
