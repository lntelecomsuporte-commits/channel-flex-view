import { Capacitor, registerPlugin } from "@capacitor/core";

interface PlaybackKeepAlivePlugin {
  start: () => Promise<{ started: boolean }>;
  stop: () => Promise<void>;
}

const KeepAlivePlugin = registerPlugin<PlaybackKeepAlivePlugin>("PlaybackKeepAlive");

let started = false;

/**
 * Inicia o foreground service nativo no Android pra impedir que o sistema
 * mate o app depois de horas ocioso assistindo TV.
 *
 * No-op em web/iOS — sem efeitos colaterais.
 */
export async function startPlaybackKeepAlive(): Promise<void> {
  if (started) return;
  if (!Capacitor.isNativePlatform()) return;
  if (Capacitor.getPlatform() !== "android") return;
  try {
    await KeepAlivePlugin.start();
    started = true;
    console.log("[KeepAlive] Foreground service iniciado");
  } catch (err) {
    console.warn("[KeepAlive] Falha ao iniciar foreground service:", err);
  }
}

export async function stopPlaybackKeepAlive(): Promise<void> {
  if (!started) return;
  if (!Capacitor.isNativePlatform()) return;
  try {
    await KeepAlivePlugin.stop();
    started = false;
  } catch (err) {
    console.warn("[KeepAlive] Falha ao parar foreground service:", err);
  }
}
