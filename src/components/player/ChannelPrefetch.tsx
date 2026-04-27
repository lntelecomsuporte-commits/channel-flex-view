import { useEffect, useRef } from "react";
import { getPlayableStreamUrl } from "@/lib/stream";

interface ChannelPrefetchProps {
  /** URL do próximo canal (já resolvido). Se nulo, não prefetcha. */
  nextStreamUrl: string | null;
}

/**
 * Pré-aquece o próximo canal baixando o manifest m3u8 (ou os primeiros bytes
 * do MP4) em segundo plano. Quando o usuário aperta UP/DOWN, o WebView já
 * tem manifest + cookies + DNS resolvidos — corta ~500ms a 1s do zap.
 *
 * NÃO usa <video> oculto (que custaria CPU/banda decodificando) — apenas
 * um fetch leve com cache do browser.
 */
const ChannelPrefetch = ({ nextStreamUrl }: ChannelPrefetchProps) => {
  const lastFetchedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!nextStreamUrl) return;
    const url = getPlayableStreamUrl(nextStreamUrl);
    if (!url || url === lastFetchedRef.current) return;
    lastFetchedRef.current = url;

    const ctrl = new AbortController();
    // Pequeno atraso pra não disputar banda com o canal atual no início do zap
    const t = setTimeout(() => {
      fetch(url, {
        signal: ctrl.signal,
        method: "GET",
        cache: "force-cache",
        // Range pra MP4: pega só o primeiro chunk (cabeçalho + moov)
        headers: /\.mp4(\?|$)/i.test(url) ? { Range: "bytes=0-262143" } : undefined,
      }).catch(() => { /* prefetch best-effort */ });
    }, 800);

    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [nextStreamUrl]);

  return null;
};

export default ChannelPrefetch;
