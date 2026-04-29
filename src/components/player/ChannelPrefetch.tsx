import { useEffect, useRef } from "react";
import { getPlayableStreamUrl, resolveChannelStreamUrl } from "@/lib/stream";

interface ChannelPrefetchProps {
  /** URL do próximo canal (já resolvido). Se nulo, não prefetcha. */
  nextStreamUrl: string | null;
  channelId?: string | null;
  useProxyToken?: boolean;
}

/**
 * Pré-aquece o próximo canal baixando o manifest m3u8 (ou os primeiros bytes
 * do MP4) em segundo plano. Quando o usuário aperta UP/DOWN, o WebView já
 * tem manifest + cookies + DNS resolvidos — corta ~500ms a 1s do zap.
 *
 * NÃO usa <video> oculto (que custaria CPU/banda decodificando) — apenas
 * um fetch leve com cache do browser.
 */
const ChannelPrefetch = ({ nextStreamUrl, channelId = null, useProxyToken = false }: ChannelPrefetchProps) => {
  const lastFetchedRef = useRef<string | null>(null);

  const canPrefetchWithoutCorsNoise = (url: string) => {
    try {
      const parsed = new URL(url);
      // Só pré-busca URLs que já passaram pelo nosso origin/proxy. HTTPS externo
      // direto fica por conta do player; fetch em background só gera erro de CORS.
      return parsed.pathname.includes("/functions/v1/hls-proxy") || parsed.origin === window.location.origin;
    } catch {
      return false;
    }
  };

  useEffect(() => {
    if (!nextStreamUrl) return;

    const ctrl = new AbortController();
    // Pequeno atraso pra não disputar banda com o canal atual no início do zap
    const t = setTimeout(() => {
      (async () => {
        const url = useProxyToken && channelId
          ? await resolveChannelStreamUrl(nextStreamUrl, channelId, true)
          : getPlayableStreamUrl(nextStreamUrl);
        if (!url || url === lastFetchedRef.current) return;
        if (!canPrefetchWithoutCorsNoise(url)) return;
        lastFetchedRef.current = url;
        fetch(url, {
          signal: ctrl.signal,
          method: "GET",
          cache: "force-cache",
          // Range pra MP4: pega só o primeiro chunk (cabeçalho + moov)
          headers: /\.mp4(\?|$)/i.test(url) ? { Range: "bytes=0-262143" } : undefined,
        }).catch(() => { /* prefetch best-effort */ });
      })().catch(() => { /* prefetch best-effort */ });
    }, 800);

    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [nextStreamUrl, channelId, useProxyToken]);

  return null;
};

export default ChannelPrefetch;
