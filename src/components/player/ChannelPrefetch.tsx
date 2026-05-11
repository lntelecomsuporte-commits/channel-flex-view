import { useEffect, useRef } from "react";
import { getPlayableStreamUrl, resolveChannelStreamUrl, resolveRedirects } from "@/lib/stream";
import { LntvPlayer, shouldUseNativePlayer } from "@/lib/native/lntvPlayer";

interface ChannelPrefetchProps {
  /** URL do próximo canal (já resolvido). Se nulo, não prefetcha. */
  nextStreamUrl: string | null;
  channelId?: string | null;
  useProxyToken?: boolean;
  forceProxyNative?: boolean;
}

/**
 * Pre-cache REAL do próximo/anterior canal.
 *
 * Antes (versão antiga): só fazia fetch no-cors/force-cache, que devolvia
 * resposta opaca e NÃO era reaproveitada pelo hls.js. Resultado: aquecia
 * só DNS/TLS — nenhum byte de mídia ficava em cache.
 *
 * Agora baixamos com CORS as MESMAS URLs e headers que o hls.js vai pedir
 * quando o usuário trocar de canal:
 *   1. Resolve a URL final (proxy/token/redirect) igual ao VideoPlayer.
 *   2. GET CORS no manifest .m3u8 → fica no HTTP cache do browser.
 *   3. Parseia manifest, acha 1ª variant (se master) e o 1º segmento .ts,
 *      faz GET CORS dele também.
 *   4. Para MP4: GET com Range bytes=0-524287 (~512KB, cobre moov + 1-2s).
 *
 * Quando o usuário aperta UP/DOWN, o hls.js dispara as MESMAS requests e
 * bate em cache local instantaneamente (manifest <5ms, segmento <50ms).
 *
 * Throttle: refaz só quando a URL muda. AbortController cancela tudo
 * agressivamente quando troca de canal pra não competir banda.
 */
const ChannelPrefetch = ({
  nextStreamUrl,
  channelId = null,
  useProxyToken = false,
  forceProxyNative = false,
}: ChannelPrefetchProps) => {
  const lastFetchedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!nextStreamUrl) return;

    const ctrl = new AbortController();
    // Delay curto: dá prioridade pro canal atual abrir, mas curto o bastante
    // pra que zaps consecutivos (UP, UP, UP) já achem cache pronto.
    const t = setTimeout(() => {
      void prefetchChannel({
        nextStreamUrl,
        channelId,
        useProxyToken,
        forceProxyNative,
        signal: ctrl.signal,
        lastFetchedRef,
      });
    }, 150);

    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [nextStreamUrl, channelId, useProxyToken, forceProxyNative]);

  return null;
};

interface PrefetchArgs {
  nextStreamUrl: string;
  channelId: string | null;
  useProxyToken: boolean;
  forceProxyNative: boolean;
  signal: AbortSignal;
  lastFetchedRef: React.MutableRefObject<string | null>;
}

const prefetchChannel = async ({
  nextStreamUrl,
  channelId,
  useProxyToken,
  forceProxyNative,
  signal,
  lastFetchedRef,
}: PrefetchArgs) => {
  try {
    // 1) Pré-aquece redirectCache (best-effort, falha silenciosa).
    resolveRedirects(nextStreamUrl).catch(() => {});

    // 2) Resolve a URL final que o player vai usar.
    const url =
      (useProxyToken || forceProxyNative) && channelId
        ? await resolveChannelStreamUrl(nextStreamUrl, channelId, useProxyToken, forceProxyNative)
        : getPlayableStreamUrl(nextStreamUrl);
    if (!url || signal.aborted) return;
    if (url === lastFetchedRef.current) return;
    lastFetchedRef.current = url;

    // 2.b) APK Android: ExoPlayer nativo pré-buffera direto via prepareNext.
    // Próximo zap é resolvido via swapToNext() → ~50ms.
    if (shouldUseNativePlayer()) {
      try {
        await LntvPlayer.prepareNext({ url });
      } catch {
        /* best-effort */
      }
      return;
    }

    const isMp4 = /\.mp4(\?|$)/i.test(url);
    const isM3u8 = /\.m3u8(\?|$)/i.test(url) || url.includes("/hls-proxy");

    if (isMp4) {
      // MP4: baixa primeiros 512KB com Range — cobre moov + alguns segundos.
      await fetchWithFallback(url, {
        signal,
        method: "GET",
        cache: "force-cache",
        credentials: "omit",
        headers: { Range: "bytes=0-524287" },
      });
      return;
    }

    if (!isM3u8) {
      // Tipo desconhecido: warm-up básico (no-cors).
      await fetchWithFallback(url, {
        signal,
        method: "GET",
        cache: "force-cache",
        mode: "no-cors",
        credentials: "omit",
      });
      return;
    }

    // 3) HLS: baixa o manifest com CORS pra cair no HTTP cache.
    const manifestRes = await fetchWithFallback(url, {
      signal,
      method: "GET",
      cache: "force-cache",
      credentials: "omit",
    });
    if (!manifestRes || !manifestRes.ok || signal.aborted) return;

    let manifestText = "";
    try {
      manifestText = await manifestRes.text();
    } catch {
      return;
    }
    if (!manifestText || signal.aborted) return;

    // 4) Se for master playlist, segue pra 1ª variant (qualidade mais baixa).
    const variantUrl = pickFirstVariant(manifestText, url);
    let mediaPlaylistUrl = url;
    let mediaPlaylistText = manifestText;

    if (variantUrl && variantUrl !== url) {
      const variantRes = await fetchWithFallback(variantUrl, {
        signal,
        method: "GET",
        cache: "force-cache",
        credentials: "omit",
      });
      if (!variantRes || !variantRes.ok || signal.aborted) return;
      try {
        mediaPlaylistText = await variantRes.text();
        mediaPlaylistUrl = variantUrl;
      } catch {
        return;
      }
    }

    // 5) Acha o 1º segmento e baixa (cache para o player puxar instantâneo).
    const firstSegment = pickFirstSegment(mediaPlaylistText, mediaPlaylistUrl);
    if (firstSegment && !signal.aborted) {
      await fetchWithFallback(firstSegment, {
        signal,
        method: "GET",
        cache: "force-cache",
        credentials: "omit",
      });
    }
  } catch {
    /* prefetch é best-effort */
  }
};

/**
 * Tenta CORS primeiro (popula cache). Se CORS falhar (ex: provedor sem
 * Access-Control-Allow-Origin), cai pra no-cors — pelo menos aquece TLS.
 * Retorna a Response do CORS (ou null se ambos falharem).
 */
const fetchWithFallback = async (url: string, init: RequestInit): Promise<Response | null> => {
  try {
    const res = await fetch(url, { ...init, mode: init.mode ?? "cors" });
    return res;
  } catch {
    if (init.mode === "no-cors" || init.signal?.aborted) return null;
    try {
      await fetch(url, { ...init, mode: "no-cors" });
    } catch {
      /* ignore */
    }
    return null;
  }
};

/** Resolve URL relativa contra a base do manifest. */
const resolveAgainst = (base: string, ref: string): string => {
  try {
    return new URL(ref, base).toString();
  } catch {
    return ref;
  }
};

/** Em master playlist, pega a primeira URL de variant (BANDWIDTH). */
const pickFirstVariant = (manifest: string, baseUrl: string): string | null => {
  const lines = manifest.split(/\r?\n/);
  let isMaster = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("#EXT-X-STREAM-INF")) {
      isMaster = true;
      const next = lines[i + 1]?.trim();
      if (next && !next.startsWith("#") && next.length > 0) {
        return resolveAgainst(baseUrl, next);
      }
    }
  }
  return isMaster ? null : null;
};

/** Em media playlist, pega a primeira URI de segmento. */
const pickFirstSegment = (manifest: string, baseUrl: string): string | null => {
  const lines = manifest.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    return resolveAgainst(baseUrl, line);
  }
  return null;
};

export default ChannelPrefetch;
