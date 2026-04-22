import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";

const getProxyBaseUrl = () => {
  const backendUrl = import.meta.env.VITE_SUPABASE_URL;
  if (!backendUrl) return null;
  return `${backendUrl}/functions/v1/hls-proxy`;
};

/**
 * Versão SÍNCRONA: usa o token JWT atual em memória.
 * Necessária porque HLS.js carrega segmentos sem await.
 */
export const getPlayableStreamUrl = (streamUrl: string): string => {
  if (!streamUrl) return streamUrl;

  // Em apps nativos, NUNCA proxiar.
  if (Capacitor.isNativePlatform()) return streamUrl;

  try {
    const parsedUrl = new URL(streamUrl);
    const isBlockedMixedContent =
      typeof window !== "undefined" &&
      window.location.protocol === "https:" &&
      parsedUrl.protocol === "http:";

    if (!isBlockedMixedContent) return streamUrl;

    const proxyBaseUrl = getProxyBaseUrl();
    if (!proxyBaseUrl) return streamUrl;

    // Token sincrono do storage do supabase-js
    const token = getCurrentAccessTokenSync();
    if (!token) {
      console.warn("[stream] Sem token JWT — proxy exigirá login");
      return streamUrl;
    }

    const proxyUrl = new URL(proxyBaseUrl);
    proxyUrl.searchParams.set("url", streamUrl);
    proxyUrl.searchParams.set("token", token);
    return proxyUrl.toString();
  } catch {
    return streamUrl;
  }
};

let cachedToken: string | null = null;

const getCurrentAccessTokenSync = (): string | null => cachedToken;

// Mantém token em cache sincrono via listener
supabase.auth.getSession().then(({ data }) => {
  cachedToken = data.session?.access_token ?? null;
});
supabase.auth.onAuthStateChange((_event, session) => {
  cachedToken = session?.access_token ?? null;
});
