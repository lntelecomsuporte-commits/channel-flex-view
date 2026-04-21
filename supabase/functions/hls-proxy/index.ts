import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, range, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const getProxyEndpoint = () => `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/hls-proxy`;

const mediaExtensions = [".m3u8", ".m4s", ".ts", ".aac", ".mp3", ".mp4", ".m4a", ".key", ".vtt", ".webvtt", ".jpg", ".jpeg", ".png", ".webp", ".gif"];

const isPrivateHostname = (hostname: string) => {
  const normalized = hostname.toLowerCase();
  if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(normalized) || normalized.endsWith(".local")) return true;
  const ipv4Match = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [a, b] = ipv4Match.slice(1).map(Number);
    return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return normalized.startsWith("fc") || normalized.startsWith("fd");
};

const isMediaRequest = (pathname: string) => {
  const lowerPath = pathname.toLowerCase();
  return mediaExtensions.some((ext) => lowerPath.endsWith(ext));
};

const buildProxyUrl = (targetUrl: string, proxyEndpoint: string, token: string) => {
  const proxyUrl = new URL(proxyEndpoint);
  proxyUrl.searchParams.set("url", targetUrl);
  proxyUrl.searchParams.set("token", token);
  return proxyUrl.toString();
};

const rewriteTagUris = (line: string, baseUrl: string, proxyEndpoint: string, token: string) => {
  return line.replace(/URI="([^"]+)"/g, (_, uri: string) => {
    const absoluteUrl = new URL(uri, baseUrl).toString();
    return `URI="${buildProxyUrl(absoluteUrl, proxyEndpoint, token)}"`;
  });
};

const rewritePlaylist = (playlist: string, baseUrl: string, proxyEndpoint: string, token: string) => {
  return playlist
    .split(/\r?\n/)
    .map((line) => {
      const trimmedLine = line.trim();
      if (!trimmedLine) return line;
      if (trimmedLine.startsWith("#")) {
        return trimmedLine.includes('URI="') ? rewriteTagUris(line, baseUrl, proxyEndpoint, token) : line;
      }
      const absoluteUrl = new URL(trimmedLine, baseUrl).toString();
      return buildProxyUrl(absoluteUrl, proxyEndpoint, token);
    })
    .join("\n");
};

const getClientIp = (request: Request): string => {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    "unknown"
  );
};

// Cache de validação de token (60s) para reduzir hits no auth
const tokenCache = new Map<string, { userId: string; expiresAt: number }>();

const validateToken = async (token: string): Promise<string | null> => {
  const cached = tokenCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.userId;

  try {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error } = await userClient.auth.getUser(token);
    if (error || !user) return null;
    tokenCache.set(token, { userId: user.id, expiresAt: Date.now() + 60_000 });
    return user.id;
  } catch {
    return null;
  }
};

// Cache de canais (5min). Chave = host + primeiro segmento distintivo do path
// (ex: "200.194.238.229:8383|urbanturbo") para diferenciar canais no mesmo host.
const channelCache = new Map<string, { id: string | null; name: string | null; expiresAt: number }>();

const getChannelKey = (u: URL): string => {
  // Pega o segmento mais "distintivo" do path: normalmente o nome do stream
  // Ex: /live/urbanturbo/playlist.m3u8 → "urbanturbo"
  const segments = u.pathname.split("/").filter(Boolean);
  // Remove segmentos genéricos finais (playlist.m3u8, index.m3u8, chunklist*, etc) e iniciais (live)
  const meaningful = segments.filter(
    (s) => !/^(live|hls|stream)$/i.test(s) && !/\.(m3u8|ts|m4s|mp4|key)$/i.test(s) && !/^chunklist/i.test(s),
  );
  const distinctive = meaningful[0] ?? segments[0] ?? "";
  return `${u.host}|${distinctive}`;
};

const lookupChannel = async (targetUrl: string): Promise<{ id: string | null; name: string | null }> => {
  try {
    const u = new URL(targetUrl);
    const cacheKey = getChannelKey(u);
    const cached = channelCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return { id: cached.id, name: cached.name };

    // Match exato pelo path do stream (mais preciso que match por host)
    // Buscamos canais cujo stream_url contém host + segmento distintivo
    const [, distinctive] = cacheKey.split("|");
    let query = adminClient.from("channels").select("id, name, stream_url").ilike("stream_url", `%${u.host}%`);
    if (distinctive) query = query.ilike("stream_url", `%/${distinctive}/%`);

    const { data } = await query.limit(1);
    const ch = data?.[0];
    const result = { id: ch?.id ?? null, name: ch?.name ?? null };
    channelCache.set(cacheKey, { ...result, expiresAt: Date.now() + 5 * 60_000 });
    return result;
  } catch {
    return { id: null, name: null };
  }
};

const logProxyAccess = async (
  userId: string | null,
  ip: string,
  targetUrl: string,
  bytes: number,
) => {
  try {
    const { id: channelId, name: channelName } = await lookupChannel(targetUrl);
    const host = new URL(targetUrl).host;
    const bucket = new Date(Math.floor(Date.now() / 60000) * 60000).toISOString();

    // Upsert agregado por minuto: tenta UPDATE, se não houver, INSERT
    const { data: existing } = await adminClient
      .from("proxy_access_log")
      .select("id, request_count, bytes_transferred")
      .eq("ip_address", ip)
      .eq("bucket_minute", bucket)
      .eq("user_id", userId as any)
      .eq("channel_id", channelId as any)
      .maybeSingle();

    if (existing) {
      await adminClient
        .from("proxy_access_log")
        .update({
          request_count: existing.request_count + 1,
          bytes_transferred: existing.bytes_transferred + bytes,
          last_seen_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
    } else {
      await adminClient.from("proxy_access_log").insert({
        user_id: userId,
        ip_address: ip,
        channel_id: channelId,
        channel_name: channelName,
        stream_host: host,
        bucket_minute: bucket,
        request_count: 1,
        bytes_transferred: bytes,
      });
    }
  } catch (e) {
    console.error("logProxyAccess error", e);
  }
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const requestUrl = new URL(request.url);
  const target = requestUrl.searchParams.get("url");
  const token = requestUrl.searchParams.get("token");

  if (!target) {
    return new Response("Missing url parameter", { status: 400, headers: corsHeaders });
  }

  // ===== JWT obrigatório =====
  if (!token) {
    return new Response("Missing token parameter", { status: 401, headers: corsHeaders });
  }

  const userId = await validateToken(token);
  if (!userId) {
    return new Response("Invalid or expired token", { status: 401, headers: corsHeaders });
  }

  let upstreamUrl: URL;
  try {
    upstreamUrl = new URL(target);
  } catch {
    return new Response("Invalid url parameter", { status: 400, headers: corsHeaders });
  }

  if (!["http:", "https:"].includes(upstreamUrl.protocol)) {
    return new Response("Unsupported protocol", { status: 400, headers: corsHeaders });
  }

  if (isPrivateHostname(upstreamUrl.hostname) || !isMediaRequest(upstreamUrl.pathname)) {
    return new Response("URL blocked by proxy policy", { status: 403, headers: corsHeaders });
  }

  const upstreamHeaders = new Headers();
  const range = request.headers.get("range");
  const accept = request.headers.get("accept");
  if (range) upstreamHeaders.set("range", range);
  if (accept) upstreamHeaders.set("accept", accept);

  const upstreamResponse = await fetch(upstreamUrl, {
    method: "GET",
    headers: upstreamHeaders,
    redirect: "follow",
  });

  const contentType = upstreamResponse.headers.get("content-type")?.toLowerCase() ?? "";
  const proxyEndpoint = getProxyEndpoint();
  const ip = getClientIp(request);
  const contentLength = parseInt(upstreamResponse.headers.get("content-length") ?? "0", 10) || 0;

  // Log assíncrono (não bloqueia resposta)
  logProxyAccess(userId, ip, target, contentLength).catch(() => {});

  if (
    upstreamResponse.url.toLowerCase().includes(".m3u8") ||
    contentType.includes("application/vnd.apple.mpegurl") ||
    contentType.includes("application/x-mpegurl") ||
    contentType.includes("audio/mpegurl")
  ) {
    const playlist = await upstreamResponse.text();
    const rewrittenPlaylist = rewritePlaylist(playlist, upstreamResponse.url, proxyEndpoint, token);

    return new Response(rewrittenPlaylist, {
      status: upstreamResponse.status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "no-store",
      },
    });
  }

  const responseHeaders = new Headers(corsHeaders);
  ["content-type", "content-length", "content-range", "accept-ranges", "cache-control", "etag", "last-modified"].forEach((h) => {
    const v = upstreamResponse.headers.get(h);
    if (v) responseHeaders.set(h, v);
  });

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
});
