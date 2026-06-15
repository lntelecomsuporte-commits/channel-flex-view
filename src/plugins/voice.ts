import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

/**
 * Bridge pro plugin nativo de reconhecimento de voz (SpeechRecognizer pt-BR).
 * Implementação: android/app/src/main/java/tv/lntelecom/net/VoicePlugin.java
 *
 * Eventos:
 *  - "partial" → { text }       parcial enquanto fala
 *  - "result"  → { text }       transcrição final
 *  - "error"   → { message }
 */
export interface VoicePluginShape {
  isAvailable(): Promise<{ available: boolean } | boolean>;
  start(): Promise<void>;
  stop(): Promise<void>;
  addListener(
    eventName: "partial" | "result" | "error" | "start" | "end",
    listener: (data: { text?: string; message?: string }) => void,
  ): Promise<PluginListenerHandle>;
}

const Native = registerPlugin<VoicePluginShape>("VoicePlugin");

let wired = false;
function wireOnce() {
  if (wired) return;
  wired = true;
  Native.addListener("partial", (d) => {
    window.dispatchEvent(new CustomEvent("lntv:voice-ui", {
      detail: { kind: "listening", partial: d?.text || "" },
    }));
  }).catch(() => {});
  Native.addListener("start", () => {
    window.dispatchEvent(new CustomEvent("lntv:voice-ui", {
      detail: { kind: "listening" },
    }));
  }).catch(() => {});
  Native.addListener("result", (d) => {
    if (d?.text) {
      window.dispatchEvent(new CustomEvent("lntv:voice-transcript", {
        detail: { text: d.text },
      }));
    } else {
      window.dispatchEvent(new CustomEvent("lntv:voice-ui", {
        detail: { kind: "error", message: "Não entendi" },
      }));
      setTimeout(() => window.dispatchEvent(new CustomEvent("lntv:voice-ui", { detail: { kind: "idle" } })), 2000);
    }
  }).catch(() => {});
  Native.addListener("error", (d) => {
    window.dispatchEvent(new CustomEvent("lntv:voice-ui", {
      detail: { kind: "error", message: d?.message || "Erro de voz" },
    }));
    setTimeout(() => window.dispatchEvent(new CustomEvent("lntv:voice-ui", { detail: { kind: "idle" } })), 2000);
  }).catch(() => {});
  Native.addListener("end", () => {
    // Nada — o "result" ou "error" já encerram a UI.
  }).catch(() => {});
}

export const Voice = {
  async isAvailable(): Promise<boolean> {
    try {
      const cap = (window as any).Capacitor;
      if (!cap?.isNativePlatform?.()) return false;
      wireOnce();
      const r: any = await Native.isAvailable();
      return typeof r === "boolean" ? r : !!r?.available;
    } catch { return false; }
  },
  async start(): Promise<void> {
    wireOnce();
    await Native.start();
  },
  async stop(): Promise<void> {
    try { await Native.stop(); } catch { /* ignore */ }
  },
};
