const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, range",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
};

const mediaExtensions = [
  ".m3u8",
  ".m4s",
  ".ts",
  ".aac",
  ".mp3",
  ".mp4",
  ".m4a",
  ".key",
  ".vtt",
  ".webvtt",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
];

const isPrivateHostname = (hostname: string) => {
  const normalized = hostname.toLowerCase();

  if (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "0.0.0.0" ||
    normalized === "::1" ||
    normalized.endsWith(".local")
  ) {
    return true;
  }

  const ipv4Match = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);

  if (ipv4Match) {
    const [a, b] = ipv4Match.slice(1).map(Number);

    return (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }

  return normalized.startsWith("fc") || normalized.startsWith("fd");
};

const isMediaRequest = (pathname: string) => {
  const lowerPath = pathname.toLowerCase();
  return mediaExtensions.some((extension) => lowerPath.endsWith(extension));
};

const buildProxyUrl = (targetUrl: string, proxyEndpoint: string) => {
  const proxyUrl = new URL(proxyEndpoint);
  proxyUrl.searchParams.set("url", targetUrl);
  return proxyUrl.toString();
};

const rewriteTagUris = (line: string, baseUrl: string, proxyEndpoint: string) => {
  return line.replace(/URI="([^"]+)"/g, (_, uri: string) => {
    const absoluteUrl = new URL(uri, baseUrl).toString();
    return `URI="${buildProxyUrl(absoluteUrl, proxyEndpoint)}"`;
  });
};

const rewritePlaylist = (playlist: string, baseUrl: string, proxyEndpoint: string) => {
  return playlist
    .split(/\r?\n/)
    .map((line) => {
      const trimmedLine = line.trim();

      if (!trimmedLine) {
        return line;
      }

      if (trimmedLine.startsWith("#")) {
        return trimmedLine.includes('URI="') ? rewriteTagUris(line, baseUrl, proxyEndpoint) : line;
      }

      const absoluteUrl = new URL(trimmedLine, baseUrl).toString();
      return buildProxyUrl(absoluteUrl, proxyEndpoint);
    })
    .join("\n");
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const requestUrl = new URL(request.url);
  const target = requestUrl.searchParams.get("url");

  if (!target) {
    return new Response("Missing url parameter", {
      status: 400,
      headers: corsHeaders,
    });
  }

  let upstreamUrl: URL;

  try {
    upstreamUrl = new URL(target);
  } catch {
    return new Response("Invalid url parameter", {
      status: 400,
      headers: corsHeaders,
    });
  }

  if (!["http:", "https:"].includes(upstreamUrl.protocol)) {
    return new Response("Unsupported protocol", {
      status: 400,
      headers: corsHeaders,
    });
  }

  if (isPrivateHostname(upstreamUrl.hostname) || !isMediaRequest(upstreamUrl.pathname)) {
    return new Response("URL blocked by proxy policy", {
      status: 403,
      headers: corsHeaders,
    });
  }

  const upstreamHeaders = new Headers();
  const range = request.headers.get("range");
  const accept = request.headers.get("accept");

  if (range) {
    upstreamHeaders.set("range", range);
  }

  if (accept) {
    upstreamHeaders.set("accept", accept);
  }

  const upstreamResponse = await fetch(upstreamUrl, {
    method: "GET",
    headers: upstreamHeaders,
    redirect: "follow",
  });

  const contentType = upstreamResponse.headers.get("content-type")?.toLowerCase() ?? "";
  const proxyEndpoint = `${requestUrl.origin}${requestUrl.pathname}`;

  if (
    upstreamResponse.url.toLowerCase().includes(".m3u8") ||
    contentType.includes("application/vnd.apple.mpegurl") ||
    contentType.includes("application/x-mpegurl") ||
    contentType.includes("audio/mpegurl")
  ) {
    const playlist = await upstreamResponse.text();
    const rewrittenPlaylist = rewritePlaylist(playlist, upstreamResponse.url, proxyEndpoint);

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

  ["content-type", "content-length", "content-range", "accept-ranges", "cache-control", "etag", "last-modified"].forEach(
    (headerName) => {
      const headerValue = upstreamResponse.headers.get(headerName);
      if (headerValue) {
        responseHeaders.set(headerName, headerValue);
      }
    },
  );

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
});