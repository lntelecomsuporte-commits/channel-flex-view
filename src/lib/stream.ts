import { Capacitor } from "@capacitor/core";
import { supabase } from "@/lib/supabaseLocal";

/**
 * REGRA IMUTÁVEL DESTE PROJETO (LN TV self-hosted):
 * O hls-proxy SEMPRE roda no MESMO domínio que serve o site
 * (ex.: https://tv2.lntelecom.net/functions/v1/hls-proxy via nginx → Kong).
 *
 * NUNCA apontar pro Supabase Cloud (*.supabase.co) — o proxy precisa
 * acessar streams HTTP da rede interna do provedor, coisa que o Cloud
 * não consegue fazer. VITE_SUPABASE_URL é ignorado de propósito aqui.
 *
 * Em ambiente nativo (APK) usamos window.location quando disponível;
 * caso contrário caímos no domínio de produção fixo.
 */
const PRODUCTION_HOST = "https://tv2.lntelecom.net";

const getProxyBaseUrl = () => {
  let origin = PRODUCTION_HOST;
  if (typeof window !== "undefined" && window.location?.origin) {
    const winOrigin = window.location.origin;
    // Se estiver rodando dentro do preview do Lovable (*.lovable.app/.dev),
    // ainda assim força o domínio de produção pra usar o proxy local real.
    if (!/lovable\.(app|dev)$/i.test(new URL(winOrigin).hostname)) {
      origin = winOrigin;
    }
  }
  return `${origin}/functions/v1/hls-proxy`;
};

/**
 * Monta a URL do hls-proxy somente quando for explicitamente necessário.
 * Mantém o token JWT no query param porque o player/HLS carrega segmentos sem await.
 */
const buildProxyStreamUrl = (streamUrl: string): string | null => {
  const proxyBaseUrl = getProxyBaseUrl();
  if (!proxyBaseUrl) return null;

  const token = getCurrentAccessTokenSync();
  if (!token) {
    console.warn("[stream] Sem token JWT — proxy exigirá login");
    return null;
  }

  const proxyUrl = new URL(proxyBaseUrl);
  proxyUrl.searchParams.set("url", streamUrl);
  proxyUrl.searchParams.set("token", token);
  return proxyUrl.toString();
};

/**
 * URL inicial do player.
 * - HTTP em página HTTPS: usa proxy imediatamente para evitar Mixed Content.
 * - HTTPS: toca direto; se falhar, o VideoPlayer aciona fallback para o proxy.
 */
export const getPlayableStreamUrl = (streamUrl: string): string => {
  if (!streamUrl) return streamUrl;
  if (Capacitor.isNativePlatform()) return streamUrl;

  try {
    const parsedUrl = new URL(streamUrl);
    const isBlockedMixedContent =
      typeof window !== "undefined" &&
      window.location.protocol === "https:" &&
      parsedUrl.protocol === "http:";

    if (!isBlockedMixedContent) return streamUrl;
    return buildProxyStreamUrl(streamUrl) ?? streamUrl;
  } catch {
    return streamUrl;
  }
};

/** Força proxy apenas como fallback controlado pelo VideoPlayer. */
export const getProxiedStreamUrl = (streamUrl: string): string => {
  if (!streamUrl) return streamUrl;
  if (Capacitor.isNativePlatform()) return streamUrl;
  return buildProxyStreamUrl(streamUrl) ?? streamUrl;
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
