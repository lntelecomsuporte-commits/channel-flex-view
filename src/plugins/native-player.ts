import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

/**
 * Bridge para o plugin nativo Android (ExoPlayer/Media3).
 * Apenas Android — no iOS/Web os métodos no-op (a UI deve checar a plataforma
 * antes de chamar).
 *
 * Implementação nativa: android/app/src/main/java/tv/lntelecom/net/NativePlayerPlugin.java
 */
export type NativeStreamType = "hls" | "mp4";

export interface NativePlayerLoadOptions {
  url: string;
  type?: NativeStreamType;
  headers?: Record<string, string>;
}

export type NativePlayerEvent = "playing" | "buffering" | "ended" | "error";

export interface NativePlayerPlugin {
  load(options: NativePlayerLoadOptions): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  destroy(): Promise<void>;
  addListener(
    eventName: NativePlayerEvent,
    listener: (data: { state?: number; code?: number; message?: string }) => void,
  ): Promise<PluginListenerHandle>;
}

export const NativePlayer = registerPlugin<NativePlayerPlugin>("NativePlayer");
