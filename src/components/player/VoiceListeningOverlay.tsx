import { useEffect, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import type { VoiceUiState } from "@/lib/voiceCommands";

/**
 * Overlay do reconhecimento de voz.
 * Escuta o evento global "lntv:voice-ui".
 */
export default function VoiceListeningOverlay() {
  const [state, setState] = useState<VoiceUiState>({ kind: "idle" });

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<VoiceUiState>).detail;
      if (detail) setState(detail);
    };
    window.addEventListener("lntv:voice-ui", handler as EventListener);
    return () => window.removeEventListener("lntv:voice-ui", handler as EventListener);
  }, []);

  if (state.kind === "idle") return null;

  const listening = state.kind === "listening";
  const error = state.kind === "error";

  return (
    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[60] pointer-events-none">
      <div className="flex flex-col items-center gap-4 px-8 py-6 rounded-2xl bg-black/85 backdrop-blur-md border border-white/10 shadow-2xl min-w-[280px]">
        <div
          className={`w-20 h-20 rounded-full flex items-center justify-center ${
            error ? "bg-destructive/20" : "bg-primary/20"
          } ${listening ? "animate-pulse" : ""}`}
        >
          {error ? (
            <MicOff className="w-10 h-10 text-destructive" />
          ) : (
            <Mic className={`w-10 h-10 ${listening ? "text-primary" : "text-white"}`} />
          )}
        </div>
        <div className="text-center min-h-[3rem]">
          {state.kind === "listening" && (
            <>
              <p className="text-sm text-white/70 mb-1">Ouvindo…</p>
              {state.partial ? (
                <p className="text-lg font-medium text-white max-w-md">{state.partial}</p>
              ) : (
                <p className="text-xs text-white/40">Diga o número ou nome do canal</p>
              )}
            </>
          )}
          {state.kind === "result" && (
            <p className="text-lg font-medium text-white max-w-md">{state.text}</p>
          )}
          {state.kind === "error" && (
            <p className="text-base text-destructive-foreground/90">{state.message}</p>
          )}
        </div>
      </div>
    </div>
  );
}
