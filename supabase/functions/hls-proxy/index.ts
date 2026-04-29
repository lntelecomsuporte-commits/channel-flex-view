import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, range, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Expose-Headers": "content-type, content-length, content-range, accept-ranges, x-lntv-final-url, x-lntv-final-content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const STREAM_TOKEN_SECRET = Deno.env.get("STREAM_TOKEN_SECRET") ?? "";

// ===== Validação de token assinado (HMAC) — opção "Ocultar URL" =====
const fromBase64Url = (s: string): Uint8Array => {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

const toBase64Url = (bytes: Uint8Array): string => {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

// ===== Cifragem AES-GCM de URLs de segmento (modo "Ocultar URL") =====
// Deriva uma chave AES de 256 bits a partir do STREAM_TOKEN_SECRET (SHA-256).
let aesKeyPromise: Promise<CryptoKey> | null = null;
const getAesKey = (): Promise<CryptoKey> => {
  if (!aesKeyPromise) {
    aesKeyPromise = (async () => {
      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(STREAM_TOKEN_SECRET));
      return await crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    })();
  }
  return aesKeyPromise;
};

const encryptUrl = async (plain: string): Promise<string> => {
  const key = await getAesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return toBase64Url(out);
};

const decryptUrl = async (cipher: string): Promise<string | null> => {
  try {
    const key = await getAesKey();
    const data = fromBase64Url(cipher);
    const iv = data.slice(0, 12);
    const ct = data.slice(12);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
};

const verifyStreamToken = async (
  signedToken: string,
  uid: string,
  ch: string,
  exp: number,
): Promise<boolean> => {
  if (!STREAM_TOKEN_SECRET) return false;
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  try {
    const payload = `${uid}.${ch}.${exp}`;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(STREAM_TOKEN_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64Url(signedToken).buffer as ArrayBuffer,
      new TextEncoder().encode(payload),
    );
  } catch {
    return false;
  }
};

const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const isLocalProxyHost = (host: string) => {
  const hostname = host.split(":")[0]?.toLowerCase() ?? "";
  return ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(hostname) || hostname.endsWith(".local");
};

// Permite forçar a base pública via env (ex.: PUBLIC_PROXY_BASE_URL=https://tv2.lntelecom.net)
const PUBLIC_PROXY_BASE = Deno.env.get("PUBLIC_PROXY_BASE_URL")?.replace(/\/$/, "") ?? "";

const getForwardedProtocol = (request: Request, requestUrl: URL) => {
  const forwardedValues = request.headers
    .get("x-forwarded-proto")
    ?.split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean) ?? [];

  if (forwardedValues.includes("https")) return "https";
  if (forwardedValues.includes("http")) return "http";
  return requestUrl.protocol.replace(":", "");
};

const getProxyEndpoint = (request: Request, requestUrl: URL) => {
  // 1) Override explícito por env tem prioridade máxima
  if (PUBLIC_PROXY_BASE) return `${PUBLIC_PROXY_BASE}/functions/v1/hls-proxy`;

  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host") || requestUrl.host;
  const forwardedProtocol = getForwardedProtocol(request, requestUrl);
  // Se o host NÃO é local, sempre força HTTPS (evita mixed content quando o
  // proxy reverso não envia x-forwarded-proto)
  const protocol = !isLocalProxyHost(host) ? "https" : forwardedProtocol;
  return `${protocol}://${host}/functions/v1/hls-proxy`;
};

const mediaExtensions = [".m3u8", ".m4s", ".ts", ".aac", ".mp3", ".mp4", ".m4a", ".key", ".vtt", ".webvtt", ".jpg", ".jpeg", ".png", ".webp", ".gif"];

// Content-types aceitos quando a URL não tem extensão de mídia (ex.: MPEG-TS bruto via HTTP)
const allowedUpstreamContentTypes = [
  "video/mp2t",
  "video/mpeg",
  "video/mp4",
  "application/octet-stream", // muitos servidores TS retornam isso
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "audio/mpegurl",
  "audio/aac",
  "audio/mpeg",
  "image/",
];

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

interface AuthCtx {
  jwt?: string;          // JWT do usuário (modo legado)
  signed?: {             // Token assinado (modo "Ocultar URL")
    st: string;          // signature
    uid: string;
    ch: string;
    exp: number;
  };
}

const buildProxyUrl = async (targetUrl: string, proxyEndpoint: string, ctx: AuthCtx): Promise<string> => {
  const proxyUrl = new URL(proxyEndpoint);
  if (ctx.signed) {
    // Modo "Ocultar URL": cifra a URL real com AES-GCM (chave derivada do secret).
    // Cliente nunca vê plaintext da URL upstream.
    const cipher = await encryptUrl(targetUrl);
    proxyUrl.searchParams.set("u", cipher);
    proxyUrl.searchParams.set("st", ctx.signed.st);
    proxyUrl.searchParams.set("uid", ctx.signed.uid);
    proxyUrl.searchParams.set("ch", ctx.signed.ch);
    proxyUrl.searchParams.set("exp", String(ctx.signed.exp));
  } else {
    proxyUrl.searchParams.set("url", targetUrl);
    if (ctx.jwt) proxyUrl.searchParams.set("token", ctx.jwt);
  }
  return proxyUrl.toString();
};

const rewriteTagUris = async (line: string, baseUrl: string, proxyEndpoint: string, ctx: AuthCtx) => {
  const matches = [...line.matchAll(/URI="([^"]+)"/g)];
  let result = line;
  for (const m of matches) {
    const absoluteUrl = new URL(m[1], baseUrl).toString();
    const replacement = `URI="${await buildProxyUrl(absoluteUrl, proxyEndpoint, ctx)}"`;
    result = result.replace(`URI="${m[1]}"`, replacement);
  }
  return result;
};

const rewritePlaylist = async (playlist: string, baseUrl: string, proxyEndpoint: string, ctx: AuthCtx): Promise<string> => {
  const lines = playlist.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      out.push(line);
      continue;
    }
    if (trimmedLine.startsWith("#")) {
      out.push(trimmedLine.includes('URI="') ? await rewriteTagUris(line, baseUrl, proxyEndpoint, ctx) : line);
      continue;
    }
    const absoluteUrl = new URL(trimmedLine, baseUrl).toString();
    out.push(await buildProxyUrl(absoluteUrl, proxyEndpoint, ctx));
  }
  return out.join("\n");
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

    const { data } = await query.limit(20);
    const exact = data?.find((row) => {
      try {
        const stream = new URL(row.stream_url);
        return stream.host === u.host && stream.pathname === u.pathname;
      } catch {
        return row.stream_url === targetUrl;
      }
    });
    const ch = exact ?? data?.[0];
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
  try {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

  const requestUrl = new URL(request.url);
  let target = requestUrl.searchParams.get("url");
  const token = requestUrl.searchParams.get("token");
  const uCipher = requestUrl.searchParams.get("u"); // URL cifrada (segmentos do modo "Ocultar URL")

  // Token assinado (modo "Ocultar URL")
  const st = requestUrl.searchParams.get("st");
  const uid = requestUrl.searchParams.get("uid");
  const ch = requestUrl.searchParams.get("ch");
  const expRaw = requestUrl.searchParams.get("exp");

  let userId: string | null = null;
  let authCtx: AuthCtx;

  if (st && uid && ch && expRaw) {
    const exp = parseInt(expRaw, 10);
    const ok = await verifyStreamToken(st, uid, ch, exp);
    if (!ok) {
      return new Response("Invalid or expired stream token", { status: 401, headers: corsHeaders });
    }
    userId = uid;
    authCtx = { signed: { st, uid, ch, exp } };

    // Se veio `u=<cipher>`, decifra e usa como target (segmentos/variantes).
    if (!target && uCipher) {
      const decrypted = await decryptUrl(uCipher);
      if (!decrypted) {
        return new Response("Invalid encrypted url", { status: 400, headers: corsHeaders });
      }
      target = decrypted;
    }

    // Se o cliente não enviou `url=` (modo "Ocultar URL" puro),
    // resolvemos a stream real pelo channel_id assinado no token.
    if (!target) {
      try {
        const { data, error } = await adminClient
          .from("channels")
          .select("stream_url, is_active")
          .eq("id", ch)
          .maybeSingle();
        if (error || !data?.stream_url || data.is_active === false) {
          return new Response("Channel not found", { status: 404, headers: corsHeaders });
        }
        target = data.stream_url;
      } catch {
        return new Response("Channel lookup failed", { status: 500, headers: corsHeaders });
      }
    }
  } else {
    if (!target) {
      return new Response("Missing url parameter", { status: 400, headers: corsHeaders });
    }
    if (!token) {
      return new Response("Missing token parameter", { status: 401, headers: corsHeaders });
    }
    userId = await validateToken(token);
    if (!userId) {
      return new Response("Invalid or expired token", { status: 401, headers: corsHeaders });
    }
    authCtx = { jwt: token };
  }

  if (!target) {
    return new Response("Missing url parameter", { status: 400, headers: corsHeaders });
  }
  const resolvedTarget: string = target;
  let upstreamUrl: URL;
  try {
    upstreamUrl = new URL(resolvedTarget);
  } catch {
    return new Response("Invalid url parameter", { status: 400, headers: corsHeaders });
  }

  if (!["http:", "https:"].includes(upstreamUrl.protocol)) {
    return new Response("Unsupported protocol", { status: 400, headers: corsHeaders });
  }

  if (isPrivateHostname(upstreamUrl.hostname)) {
    return new Response("URL blocked by proxy policy", { status: 403, headers: corsHeaders });
  }
  // Se a URL tem extensão de mídia, libera direto. Senão, validamos depois pelo content-type upstream.
  const hasMediaExtension = isMediaRequest(upstreamUrl.pathname);

  // Log estruturado de cada request — facilita auditar quem está passando pelo proxy.
  // Formato: [hls-proxy] <method> <proto>//<host><path> mode=<jwt|signed> ua=<short>
  try {
    const mode = authCtx.signed ? "signed" : "jwt";
    const ua = (request.headers.get("user-agent") ?? "").slice(0, 60);
    console.log(
      `[hls-proxy] ${request.method} ${upstreamUrl.protocol}//${upstreamUrl.host}${upstreamUrl.pathname} mode=${mode} ip=${getClientIp(request)} ua="${ua}"`,
    );
  } catch { /* noop */ }

  const upstreamHeaders = new Headers();
  const range = request.headers.get("range");
  const accept = request.headers.get("accept");
  if (range) upstreamHeaders.set("range", range);
  if (accept) upstreamHeaders.set("accept", accept);
  // User-Agent: alguns servidores (Flussonic, nginx-rtmp) exigem UA não vazio
  upstreamHeaders.set("user-agent", request.headers.get("user-agent") ?? "Mozilla/5.0 LNTV-Proxy");

  // Propaga abort do cliente -> upstream (essencial para streams MPEG-TS infinitos:
  // se o player fechar a conexão, o fetch upstream também precisa cancelar,
  // senão fica vazando conexões e o Deno trava).
  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method: "GET",
      headers: upstreamHeaders,
      redirect: "follow",
      signal: request.signal,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("aborted") || msg.includes("AbortError")) {
      return new Response(null, { status: 499, headers: corsHeaders });
    }
    console.error(`[hls-proxy] fetch upstream falhou: ${msg} (${resolvedTarget})`);
    return new Response(`Upstream fetch failed: ${msg}`, { status: 502, headers: corsHeaders });
  }

  const contentType = upstreamResponse.headers.get("content-type")?.toLowerCase() ?? "";
  const proxyEndpoint = getProxyEndpoint(request, requestUrl);
  const ip = getClientIp(request);
  const contentLength = parseInt(upstreamResponse.headers.get("content-length") ?? "0", 10) || 0;

  // Quando a URL não tinha extensão de mídia, valida pelo content-type upstream.
  // Permite MPEG-TS bruto via HTTP (ex.: http://host:porta/) que servidores
  // tipo Flussonic/UDPxy retornam como video/mp2t ou application/octet-stream.
  if (!hasMediaExtension) {
    const allowed = allowedUpstreamContentTypes.some((t) => contentType.includes(t));
    if (!allowed) {
      console.warn(`[hls-proxy] bloqueado: URL sem extensão e content-type não-mídia: ${contentType} (${resolvedTarget})`);
      try { upstreamResponse.body?.cancel(); } catch { /* noop */ }
      return new Response("URL blocked by proxy policy (non-media content-type)", { status: 403, headers: corsHeaders });
    }
  }

  // Log assíncrono (não bloqueia resposta)
  logProxyAccess(userId, ip, resolvedTarget, contentLength).catch(() => {});

  if (
    upstreamResponse.url.toLowerCase().includes(".m3u8") ||
    contentType.includes("application/vnd.apple.mpegurl") ||
    contentType.includes("application/x-mpegurl") ||
    contentType.includes("audio/mpegurl")
  ) {
    const playlist = await upstreamResponse.text();
    const rewrittenPlaylist = await rewritePlaylist(playlist, upstreamResponse.url, proxyEndpoint, authCtx);

    return new Response(rewrittenPlaylist, {
      status: upstreamResponse.status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/vnd.apple.mpegurl",
        "X-LNTV-Final-URL": upstreamResponse.url,
        "X-LNTV-Final-Content-Type": contentType,
        "Cache-Control": "no-store",
      },
    });
  }

  const responseHeaders = new Headers(corsHeaders);
  responseHeaders.set("X-LNTV-Final-URL", upstreamResponse.url);
  responseHeaders.set("X-LNTV-Final-Content-Type", contentType);

  // Detecta MPEG-TS bruto (live stream contínuo, sem extensão de mídia).
  // Para esses, NÃO repassamos content-length nem accept-ranges:
  // - content-length quebra streams infinitos (player espera fim que nunca chega
  //   ou interpreta como tamanho fixo e trava ao atingir o byte count).
  // - accept-ranges induz o player a fazer range requests num live, o que
  //   o servidor de origem (UDPxy/xtream/etc) não suporta corretamente.
  const isRawMpegTs =
    !hasMediaExtension &&
    (contentType.includes("video/mp2t") ||
      contentType.includes("video/mpeg") ||
      contentType.includes("application/octet-stream"));

  if (isRawMpegTs) {
    responseHeaders.set("Content-Type", "video/mp2t");
    responseHeaders.set("Cache-Control", "no-store");
    // Força chunked transfer (Deno faz isso por padrão quando não há content-length).
  } else {
    ["content-type", "content-length", "content-range", "accept-ranges", "cache-control", "etag", "last-modified"].forEach((h) => {
      const v = upstreamResponse.headers.get(h);
      if (v) responseHeaders.set(h, v);
    });
  }

  return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("aborted") || msg.includes("AbortError") || msg.includes("connection closed")) {
      // Cliente fechou conexão — normal pra streams ao vivo
      return new Response(null, { status: 499, headers: corsHeaders });
    }
    console.error(`[hls-proxy] handler crash: ${msg}`);
    return new Response(`Proxy error: ${msg}`, { status: 500, headers: corsHeaders });
  }
});
