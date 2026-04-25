import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";

const isLocalHostname = (hostname: string) =>
  ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(hostname) || hostname.endsWith(".local");

const getProxyBaseUrl = () => {
  const backendUrl = import.meta.env.VITE_SUPABASE_URL;
  if (!backendUrl) return null;

  try {
    const url = new URL(backendUrl);
    if (
      typeof window !== "undefined" &&
      window.location.protocol === "https:" &&
      url.protocol === "http:" &&
      !isLocalHostname(url.hostname)
    ) {
      url.protocol = "https:";
    }
    return `${url.origin}/functions/v1/hls-proxy`;
  } catch {
    return `${backendUrl.replace(/\/$/, "")}/functions/v1/hls-proxy`;
  }
};

const isHlsPlaylistUrl = (streamUrl: string) => {
  try {
    return new URL(streamUrl).pathname.toLowerCase().endsWith(".m3u8");
  } catch {
    return streamUrl.toLowerCase().split("?")[0].endsWith(".m3u8");
  }
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
    const shouldProxyHlsPlaylist =
      typeof window !== "undefined" &&
      window.location.protocol === "https:" &&
      isHlsPlaylistUrl(streamUrl);

    // Mesmo quando a URL inicial é HTTPS, algumas playlists HLS apontam para
    // sub-playlists/segmentos HTTP. No browser isso vira Mixed Content; passando
    // a playlist pelo proxy, o backend reescreve todos os links internos para HTTPS.
    if (!isBlockedMixedContent && !shouldProxyHlsPlaylist) return streamUrl;

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

// Lê o token DIRETAMENTE do localStorage de forma síncrona.
// O supabase-js v2 persiste a sessão em uma chave `sb-<ref>-auth-token`.
// Como HLS.js carrega segmentos sem await, precisamos do token disponível
// já no primeiro frame — não dá pra esperar getSession() resolver.
const readTokenFromStorage = (): string | null => {
  if (typeof localStorage === "undefined") return null;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const token = parsed?.access_token ?? parsed?.currentSession?.access_token ?? null;
      if (typeof token === "string" && token.length > 0) return token;
    }
  } catch {
    /* ignore */
  }
  return null;
};

let cachedToken: string | null = readTokenFromStorage();

const getCurrentAccessTokenSync = (): string | null => {
  // Sempre re-tenta o storage caso o cache esteja vazio (ex.: login recém-feito)
  if (!cachedToken) cachedToken = readTokenFromStorage();
  return cachedToken;
};

// Mantém o cache atualizado quando a sessão muda
supabase.auth.getSession().then(({ data }) => {
  if (data.session?.access_token) cachedToken = data.session.access_token;
});
supabase.auth.onAuthStateChange((_event, session) => {
  cachedToken = session?.access_token ?? readTokenFromStorage();
});
