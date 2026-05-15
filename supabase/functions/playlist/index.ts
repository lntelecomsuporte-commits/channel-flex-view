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
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const res = await fetch(url, {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      accept: "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[playlist] PostgREST ${table} ${res.status}: ${body}`);
    throw new Error(`Database error on ${table}`);
  }

  return await res.json() as T[];
};

const isLocalProxyHost = (host: string) => {
  const hostname = host.split(":")[0]?.toLowerCase() ?? "";
  return ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(hostname) || hostname.endsWith(".local");
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

const getPublicOrigin = (req: Request, requestUrl: URL) => {
  const envOrigin = Deno.env.get("LNTV_PUBLIC_ORIGIN") || Deno.env.get("PUBLIC_PROXY_BASE_URL");
  if (envOrigin) return envOrigin.replace(/\/$/, "");

  const forwardedHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || req.headers.get("host") || requestUrl.host;
  if (!host) return FALLBACK_ORIGIN;

  const protocol = isLocalProxyHost(host) ? getForwardedProtocol(req, requestUrl) : "https";
  return `${protocol}://${host}`;
};

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (req.method !== "GET" && req.method !== "HEAD") {
      return errorResponse("Method not allowed", 405);
    }

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !SECRET) {
      console.error("[playlist] Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or STREAM_TOKEN_SECRET");
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
      const st = await sign(`${profile.user_id}.${ch.id}.${exp}`);
      const proxyUrl =
        `${publicOrigin}/functions/v1/hls-proxy` +
        `?ch=${encodeURIComponent(ch.id)}` +
        `&uid=${encodeURIComponent(profile.user_id)}` +
        `&exp=${exp}` +
        `&st=${st}`;

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
