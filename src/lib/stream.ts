import { Capacitor } from "@capacitor/core";

const getProxyBaseUrl = () => {
  const backendUrl = import.meta.env.VITE_SUPABASE_URL;

  if (!backendUrl) {
    return null;
  }

  return `${backendUrl}/functions/v1/hls-proxy`;
};

export const getPlayableStreamUrl = (streamUrl: string) => {
  if (!streamUrl) {
    return streamUrl;
  }

  // Em apps nativos (APK Android/iOS) NUNCA proxiar — vai direto na origem,
  // o que é especialmente importante para streams de rede local (latência mínima).
  if (Capacitor.isNativePlatform()) {
    return streamUrl;
  }

  try {
    const parsedUrl = new URL(streamUrl);
    const isBlockedMixedContent =
      typeof window !== "undefined" && window.location.protocol === "https:" && parsedUrl.protocol === "http:";

    if (!isBlockedMixedContent) {
      return streamUrl;
    }

    const proxyBaseUrl = getProxyBaseUrl();

    if (!proxyBaseUrl) {
      return streamUrl;
    }

    const proxyUrl = new URL(proxyBaseUrl);
    proxyUrl.searchParams.set("url", streamUrl);

    return proxyUrl.toString();
  } catch {
    return streamUrl;
  }
};
