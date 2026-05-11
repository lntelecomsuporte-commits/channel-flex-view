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

/**
 * Renderização por ExoPlayer fica opt-in. Em FireTV o stream decodifica áudio,
 * mas a WebView pode cobrir a superfície nativa e esconder a imagem. O padrão
 * volta para o <video>/hls.js dentro da WebView, com SurfaceView nativa apenas
 * como desbloqueio de composição instalado pela MainActivity.
 */
export const shouldUseNativePlayer = (): boolean => {
  try {
    return isNativePlayerAvailable() && window.localStorage.getItem("lntv_native_renderer") === "1";
  } catch {
    return false;
  }
};
