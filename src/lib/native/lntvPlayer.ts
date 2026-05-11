import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export interface LntvPlayerPlugin {
  load(opts: { url: string }): Promise<void>;
  prepareNext(opts: { url: string }): Promise<void>;
  swapToNext(): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  setMuted(opts: { muted: boolean }): Promise<void>;
  setVolume(opts: { volume: number }): Promise<void>;
  setRect(opts: { x: number; y: number; w: number; h: number }): Promise<void>;
  release(): Promise<void>;
  addListener(
    eventName: "playing" | "waiting" | "ended" | "error" | "firstFrame",
    listenerFn: (data: { code?: number; message?: string }) => void,
  ): Promise<PluginListenerHandle>;
}

export const LntvPlayer = registerPlugin<LntvPlayerPlugin>("LntvPlayer");

/**
 * true só quando rodando no APK Android com o plugin nativo disponível.
 * Em web, Smart TV browser e iOS retorna false → cai no hls.js.
 */
export const isNativePlayerAvailable = (): boolean => {
  try {
    return (
      Capacitor.isNativePlatform() &&
      Capacitor.getPlatform() === "android" &&
      Capacitor.isPluginAvailable("LntvPlayer")
    );
  } catch {
    return false;
  }
};
