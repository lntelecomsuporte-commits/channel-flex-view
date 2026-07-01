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
  /** Quando true, o ExoPlayer prefere decoders de software H.264
   *  (OMX.google.* / c2.android.*). Contorna bugs de decoder HW que
   *  causam vídeo verde/faixas em alguns canais. Custo: mais CPU. */
  preferSoftwareDecoder?: boolean;
}

export type NativePlayerEvent = "playing" | "buffering" | "ended" | "error";

export interface NativePlayerStats {
  width?: number;
  height?: number;
  frameRate?: number;
  bitrate?: number;
  codec?: string;
  mimeType?: string;
  bandwidthEstimateBps?: number;
  totalBytesTransferred?: number;
  bufferedMs?: number;
  droppedFrames?: number;
  playbackState?: number;
}

export interface NativeTrackCycleResult {
  /** Rótulo amigável da faixa selecionada (ou "Desligado" / "Indisponível"). */
  label: string;
  /** Total de faixas disponíveis (0 = nenhuma; 1 = só uma, sem ciclo útil). */
  count: number;
  /** Índice atual após ciclar (-1 = desligado). */
  index: number;
}

export interface NativePlayerPlugin {
  load(options: NativePlayerLoadOptions): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  destroy(): Promise<void>;
  getStats(): Promise<NativePlayerStats>;
  /** Cicla legenda: Desligado → faixa 1 → ... → Desligado. */
  cycleSubtitle(): Promise<NativeTrackCycleResult>;
  /** Cicla faixa de áudio. */
  cycleAudio(): Promise<NativeTrackCycleResult>;
  addListener(
    eventName: NativePlayerEvent,
    listener: (data: { state?: number; code?: number; codeName?: string; message?: string; cause?: string }) => void,
  ): Promise<PluginListenerHandle>;
}

export const NativePlayer = registerPlugin<NativePlayerPlugin>("NativePlayer");
