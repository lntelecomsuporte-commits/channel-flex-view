import { Capacitor } from "@capacitor/core";
import { supabase } from "@/lib/supabaseLocal";
import { LOCAL_AUTH_STORAGE_KEY, getLocalFunctionUrl } from "@/lib/localBackend";

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

const isLikelyRawHttpStream = (url: URL): boolean => {
  const path = url.pathname.toLowerCase();
  return url.protocol === "http:" && !/\.(m3u8|mp4|m4a|aac|mp3|ts|m2ts|mts)(\?|$)/.test(path);
};

const getProxyBaseUrl = () => {
  let origin = PRODUCTION_HOST;

  // No APK (Capacitor) window.location.origin aponta pra um host interno
  // (ex.: http://localhost ou capacitor://localhost) — NUNCA usar isso.
  // Sempre forçar o domínio de produção real.
  if (Capacitor.isNativePlatform()) {
    return `${PRODUCTION_HOST}/functions/v1/hls-proxy`;
  }

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
 * Monta a URL do hls-proxy usando token assinado (HMAC) que esconde a URL real.
 * Token expira em 60s — HLS.js renova ao recarregar o m3u8 (precisa chamar de novo).
 * Retorna null em caso de falha (cliente cai pra fluxo normal).
 */
const buildSignedProxyStreamUrl = async (
  streamUrl: string,
  channelId: string,
): Promise<string | null> => {
  const proxyBaseUrl = getProxyBaseUrl();
  if (!proxyBaseUrl) return null;

  const jwt = getCurrentAccessTokenSync();
  if (!jwt) {
    console.warn("[stream] Sem JWT para solicitar token assinado");
    return null;
  }

  try {
    const res = await fetch(getLocalFunctionUrl("sign-stream-token"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ channel_id: channelId }),
    });
    if (!res.ok) {
      console.warn("[stream] sign-stream-token falhou", res.status);
      return null;
    }
    const { token, exp, uid, ch } = await res.json();
    const proxyUrl = new URL(proxyBaseUrl);
    // NÃO incluímos `url=` — o hls-proxy resolve a stream real pelo `ch` no banco.
    // Isso garante que a URL original do flussonic NUNCA apareça na query.
    proxyUrl.searchParams.set("st", token);
    proxyUrl.searchParams.set("uid", uid);
    proxyUrl.searchParams.set("ch", ch);
    proxyUrl.searchParams.set("exp", String(exp));
    return proxyUrl.toString();
  } catch (e) {
    console.warn("[stream] Erro ao assinar token de stream:", e);
    return null;
  }
};

/**
 * URL inicial do player.
 * - HTTP em página HTTPS: usa proxy imediatamente para evitar Mixed Content.
 * - HTTP no APK: também usa proxy. O WebView do Android (mesmo com
 *   allowMixedContent) frequentemente bloqueia HLS HTTP servido a partir
 *   de assets HTTPS, e muitos TV Boxes simplesmente recusam HTTP cleartext.
 *   Roteando pelo hls-proxy (HTTPS) o player recebe sempre HTTPS válido.
 * - HTTPS: toca direto; se falhar, o VideoPlayer aciona fallback para o proxy.
 */
export const getPlayableStreamUrl = (streamUrl: string): string => {
  if (!streamUrl) return streamUrl;

  try {
    const parsedUrl = new URL(streamUrl);

    if (Capacitor.isNativePlatform()) {
      // MPEG-TS bruto HTTP (ex.: http://ip:porta/) precisa tocar direto no APK.
      // Edge Function não é estável para stream infinito e congela após um tempo.
      if (isLikelyRawHttpStream(parsedUrl)) return streamUrl;

      // HLS HTTP continua pelo proxy para evitar mixed content/CORS em WebViews.
      if (parsedUrl.protocol === "http:") return buildProxyStreamUrl(streamUrl) ?? streamUrl;
      return streamUrl;
    }

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

/**
 * Resolve a URL final pro player considerando a flag `use_proxy_token` do canal.
 * Quando ativada, força o stream pelo hls-proxy com token assinado (esconde URL real).
 * Quando desativada, comportamento padrão (`getPlayableStreamUrl`).
 */
export const resolveChannelStreamUrl = async (
  streamUrl: string,
  channelId: string | null | undefined,
  useProxyToken: boolean,
): Promise<string> => {
  // Regra atual: HLS HTTPS deve tocar direto mesmo no navegador.
  // O proxy/token assinado fica restrito a streams HTTP ou fallback controlado.
  try {
    if (new URL(streamUrl).protocol === "https:") {
      return streamUrl;
    }
  } catch {
    /* segue fluxo padrão abaixo */
  }

  // "Ocultar URL" só faz sentido no browser (onde dá pra inspecionar via F12).
  // No APK não há DevTools, então tocamos direto pra economizar latência/banda do proxy.
  if (useProxyToken && channelId && !Capacitor.isNativePlatform()) {
    const signed = await buildSignedProxyStreamUrl(streamUrl, channelId);
    if (signed) return signed;
    // Fallback: melhor tocar pelo proxy normal do que falhar
    return buildProxyStreamUrl(streamUrl) ?? getPlayableStreamUrl(streamUrl);
  }
  return getPlayableStreamUrl(streamUrl);
};

/** Força proxy como fallback controlado pelo VideoPlayer (web e APK). */
export const getProxiedStreamUrl = (streamUrl: string): string => {
  if (!streamUrl) return streamUrl;
  return buildProxyStreamUrl(streamUrl) ?? streamUrl;
};

// Lê o token DIRETAMENTE do localStorage de forma síncrona.
// O supabase-js v2 persiste a sessão em uma chave `sb-<ref>-auth-token`.
// Como HLS.js carrega segmentos sem await, precisamos do token disponível
// já no primeiro frame — não dá pra esperar getSession() resolver.
const readTokenFromStorage = (): string | null => {
  if (typeof localStorage === "undefined") return null;
  try {
    const localRaw = localStorage.getItem(LOCAL_AUTH_STORAGE_KEY);
    if (localRaw) {
      const parsed = JSON.parse(localRaw);
      const token = parsed?.access_token ?? parsed?.currentSession?.access_token ?? null;
      if (typeof token === "string" && token.length > 0) return token;
    }

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
