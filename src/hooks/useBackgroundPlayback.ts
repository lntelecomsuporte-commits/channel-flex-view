import { useEffect, useRef } from "react";

/**
 * Mantém a aba "ativa" mesmo em segundo plano para o vídeo continuar tocando.
 *
 * Combina duas técnicas:
 *  1. Screen Wake Lock API — impede o sistema de suspender (Chrome/Edge desktop e Android).
 *  2. AudioContext silencioso — mantém o navegador acreditando que há áudio sendo
 *     reproduzido, evitando que ele "throttle" os timers e pause o decode do vídeo
 *     quando a aba perde o foco.
 *
 * Notas:
 *  - O Wake Lock só é concedido após interação do usuário e em contextos seguros (HTTPS).
 *  - Quando a aba volta a ficar visível, o lock é re-adquirido automaticamente.
 */
export function useBackgroundPlayback(active: boolean) {
  const wakeLockRef = useRef<any>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!active) return;
    if (typeof window === "undefined") return;

    let cancelled = false;

    const acquireWakeLock = async () => {
      try {
        const nav: any = navigator;
        if (nav.wakeLock?.request) {
          const lock = await nav.wakeLock.request("screen");
          if (cancelled) {
            try { await lock.release(); } catch { /* ignore */ }
            return;
          }
          wakeLockRef.current = lock;
          lock.addEventListener?.("release", () => {
            wakeLockRef.current = null;
          });
        }
      } catch {
        // pode falhar se a aba estiver oculta — tentaremos de novo no visibilitychange
      }
    };

    // Áudio silencioso para manter o tab "ativo"
    const startSilentAudio = () => {
      try {
        const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!Ctx) return;
        const ctx: AudioContext = audioCtxRef.current || new Ctx();
        audioCtxRef.current = ctx;
        if (ctx.state === "suspended") ctx.resume().catch(() => {});
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0.0001; // praticamente mudo
        osc.connect(gain).connect(ctx.destination);
        osc.start();
      } catch {
        /* ignore */
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible" && !wakeLockRef.current) {
        acquireWakeLock();
      }
    };

    acquireWakeLock();
    startSilentAudio();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      if (wakeLockRef.current) {
        try { wakeLockRef.current.release(); } catch { /* ignore */ }
        wakeLockRef.current = null;
      }
      if (audioCtxRef.current) {
        try { audioCtxRef.current.close(); } catch { /* ignore */ }
        audioCtxRef.current = null;
      }
    };
  }, [active]);
}
