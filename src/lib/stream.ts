const getProxyBaseUrl = () => {
  const backendUrl = import.meta.env.VITE_SUPABASE_URL;

  if (!backendUrl) {
    return null;
  }

  return `${backendUrl}/functions/v1/hls-proxy`;
};

export const getProxiedStreamUrl = (streamUrl: string) => {
  if (!streamUrl) return streamUrl;

  const proxyBaseUrl = getProxyBaseUrl();
  if (!proxyBaseUrl) return streamUrl;

  const proxyUrl = new URL(proxyBaseUrl);
  proxyUrl.searchParams.set("url", streamUrl);
  return proxyUrl.toString();
};

const isIpAddress = (hostname: string) => {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.startsWith("[");
};

export const getPlayableStreamUrl = (streamUrl: string) => {
  if (!streamUrl) {
    return streamUrl;
  }

  try {
    const parsedUrl = new URL(streamUrl);
    const isBlockedMixedContent =
      typeof window !== "undefined" && window.location.protocol === "https:" && parsedUrl.protocol === "http:";

    // HTTPS to IP addresses usually means self-signed certs — browsers block these programmatically
    const isSelfSignedHttps = parsedUrl.protocol === "https:" && isIpAddress(parsedUrl.hostname);

    if (!isBlockedMixedContent && !isSelfSignedHttps) {
      return streamUrl;
    }

    return getProxiedStreamUrl(streamUrl);
  } catch {
    return streamUrl;
  }
};
