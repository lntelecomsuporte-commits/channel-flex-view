import { useEffect, useRef } from "react";
import { getPlayableStreamUrl, resolveChannelStreamUrl, resolveRedirects } from "@/lib/stream";

interface ChannelPrefetchProps {
  /** URL do próximo canal (já resolvido). Se nulo, não prefetcha. */
  nextStreamUrl: string | null;
  channelId?: string | null;
  useProxyToken?: boolean;
  forceProxyNative?: boolean;
}

/**
 * Pré-aquece o próximo/anterior canal:
 *  1. Popula o redirectCache (resolveRedirects) — corta o HEAD/GET de ~300-800ms
 *     que rodaria DENTRO do zap quando o player abrir a stream nova.
 *  2. Faz fetch leve no manifest m3u8 / primeiros bytes do MP4 pra warm-up
 *     de DNS + TCP + TLS + cache HTTP. Usa `mode: "no-cors"` em origens
 *     externas pra evitar CORS errors no console mantendo o benefício de rede.
 *
 * NÃO usa <video> oculto (custaria CPU/banda decodificando) — apenas warm-up
 * de rede, que é o que realmente faz diferença no tempo de troca de canal.
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
    // Delay curto pra não disputar banda com o canal atual logo no início do zap,
    // mas curto o bastante pra que UP/DOWN consecutivos já achem cache pronto.
    const t = setTimeout(() => {
      (async () => {
        // 1) Pré-aquece o redirectCache (essa é a maior economia no zap real).
        //    resolveRedirects faz GET com Range bytes=0-0 e segue redirect.
        //    Em caso de CORS/timeout, falha silenciosamente e devolve a URL
        //    original — sem ruído no console.
        resolveRedirects(nextStreamUrl).catch(() => {});

        // 2) Resolve a URL final que o player usaria (proxy, token assinado, etc.)
        const url =
          (useProxyToken || forceProxyNative) && channelId
            ? await resolveChannelStreamUrl(nextStreamUrl, channelId, useProxyToken, forceProxyNative)
            : getPlayableStreamUrl(nextStreamUrl);
        if (!url || url === lastFetchedRef.current) return;
        lastFetchedRef.current = url;

        let isSameOriginOrProxy = false;
        try {
          const parsed = new URL(url);
          isSameOriginOrProxy =
            parsed.pathname.includes("/functions/v1/hls-proxy") ||
            parsed.origin === window.location.origin;
        } catch {
          /* fall back to no-cors */
        }

        // 3) Warm-up de rede:
        //  - same-origin / proxy → fetch normal (lê resposta, popula cache HTTP)
        //  - cross-origin → no-cors (opaque): aquece DNS/TLS/cache do browser
        //    sem disparar erro de CORS no console
        const isMp4 = /\.mp4(\?|$)/i.test(url);
        const init: RequestInit = {
          signal: ctrl.signal,
          method: "GET",
          cache: "force-cache",
          mode: isSameOriginOrProxy ? "cors" : "no-cors",
          credentials: "omit",
          headers: isMp4 && isSameOriginOrProxy ? { Range: "bytes=0-262143" } : undefined,
        };
        fetch(url, init).catch(() => {
          /* prefetch best-effort */
        });
      })().catch(() => {
        /* prefetch best-effort */
      });
    }, 250);

    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [nextStreamUrl, channelId, useProxyToken, forceProxyNative]);

  return null;
};

export default ChannelPrefetch;
