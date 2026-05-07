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
export const buildProxyStreamUrl = (streamUrl: string): string | null => {
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

/** True quando a URL já aponta pro nosso hls-proxy (qualquer modo). */
export const isProxiedStreamUrl = (url: string): boolean => {
  return url.includes("/functions/v1/hls-proxy");
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
 * Resolve redirects (301/302/encurtadores) ANTES de entregar pro hls.js.
 * Comportamento equivalente ao do VLC nativo: o player recebe a URL final
 * já resolvida, em vez de uma URL de encurtador que o WebView Android
 * frequentemente falha em seguir cross-origin.
 *
 * Cache em memória pra não fazer HEAD a cada zap. Falha silenciosa: se
 * der erro (CORS, timeout, etc.), retorna a URL original e o player tenta
 * normalmente (e cai pro fallback de proxy se precisar).
 */
const redirectCache = new Map<string, { url: string; expiresAt: number }>();
const REDIRECT_CACHE_MS = 5 * 60_000;

export const resolveRedirects = async (streamUrl: string, timeoutMs = 4000): Promise<string> => {
  if (!streamUrl) return streamUrl;
  const cached = redirectCache.get(streamUrl);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    // GET com Range pra baixar só os primeiros bytes — segue redirects
    // server-side (igual VLC) e devolve a URL final em response.url.
    const res = await fetch(streamUrl, {
      method: "GET",
      redirect: "follow",
      headers: { range: "bytes=0-0" },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    res.body?.cancel().catch(() => {});
    const finalUrl = res.url || streamUrl;
    redirectCache.set(streamUrl, { url: finalUrl, expiresAt: Date.now() + REDIRECT_CACHE_MS });
    if (finalUrl !== streamUrl) {
      console.log(`[stream] Redirect resolvido: ${streamUrl} → ${finalUrl}`);
    }
    return finalUrl;
  } catch (e) {
    // Falhou (CORS, timeout, rede) — devolve original. O player tentará
    // direto e cairá no corsFallback se precisar.
    return streamUrl;
  }
};

/**
 * URL inicial do player.
 * - HTTP em página HTTPS: usa proxy imediatamente para evitar Mixed Content.
 * - HTTP no APK: também usa proxy. O WebView do Android (mesmo com
 *   allowMixedContent) frequentemente bloqueia HLS HTTP servido a partir
 *   de assets HTTPS, e muitos TV Boxes simplesmente recusam HTTP cleartext.
 *   Roteando pelo hls-proxy (HTTPS) o player recebe sempre HTTPS válido.
 * - HTTPS: toca direto. Proxy só entra se o admin marcar "Ocultar URL".
 */
export const getPlayableStreamUrl = (streamUrl: string): string => {
  if (!streamUrl) return streamUrl;

  try {
    const parsedUrl = new URL(streamUrl);

    if (Capacitor.isNativePlatform()) {
      // APK: HTTPS toca DIRETO (menor latência no zap, sem hop pelo edge).
      // HTTP precisa do proxy porque WebView Android frequentemente bloqueia
      // cleartext mesmo com allowMixedContent (varia por TV Box/versão).
      if (parsedUrl.protocol === "http:") {
        return buildProxyStreamUrl(streamUrl) ?? streamUrl;
      }
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
  // "Ocultar URL" só faz sentido no web (DevTools/F12). No APK não há como
  // o usuário inspecionar a URL, então ignoramos a flag e usamos o fluxo
  // padrão (HTTPS direto, HTTP pelo proxy) — melhor latência no zap.
  if (useProxyToken && channelId && !Capacitor.isNativePlatform()) {
    const signed = await buildSignedProxyStreamUrl(streamUrl, channelId);
    if (signed) return signed;
    // Segurança (web): se admin marcou "Ocultar URL" e o token falhou,
    // bloqueia para não expor a origem no F12.
    console.error("[stream] Ocultar URL ativo, mas token assinado não foi gerado — bloqueando URL direta");
    return "";
  }
  return getPlayableStreamUrl(streamUrl);
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
