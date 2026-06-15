import { useEffect, useState } from "react";

/**
 * Overlay efêmero que mostra "Legenda: X" ou "Áudio: Y" por 2.2s.
 * Escuta o evento global "lntv:track-osd" com `detail.text`.
 */
export default function TrackOSD() {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let t: number | null = null;
    const onShow = (e: Event) => {
      const detail = (e as CustomEvent<{ text?: string }>).detail;
      if (!detail?.text) return;
      setText(detail.text);
      if (t) clearTimeout(t);
      t = window.setTimeout(() => setText(null), 2200);
    };
    window.addEventListener("lntv:track-osd", onShow as EventListener);
    return () => {
      window.removeEventListener("lntv:track-osd", onShow as EventListener);
      if (t) clearTimeout(t);
    };
  }, []);

  if (!text) return null;
  return (
    <div
      className="absolute top-6 left-1/2 -translate-x-1/2 pointer-events-none z-50 animate-fade-in"
      aria-live="polite"
    >
      <div className="px-5 py-2.5 rounded-lg bg-black/80 text-white text-base font-medium shadow-xl backdrop-blur-sm border border-white/10">
        {text}
      </div>
    </div>
  );
}

export function showTrackOsd(text: string) {
  window.dispatchEvent(new CustomEvent("lntv:track-osd", { detail: { text } }));
}
