import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

interface HeartbeatOptions {
  channelId?: string | null;
  channelName?: string | null;
  isWatching?: boolean;
}

const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Mantém uma user_session ativa no banco enquanto o hook está montado.
 * Atualiza last_heartbeat_at a cada 30s. Ao desmontar, encerra a sessão.
 */
export const useSessionHeartbeat = ({ channelId, channelName, isWatching = false }: HeartbeatOptions) => {
  const { user } = useAuth();
  const sessionIdRef = useRef<string | null>(null);
  const tokenRef = useRef<string>(crypto.randomUUID());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const channelInfoRef = useRef({ channelId, channelName, isWatching });

  // Mantém referência atualizada sem recriar a sessão
  useEffect(() => {
    channelInfoRef.current = { channelId, channelName, isWatching };
  }, [channelId, channelName, isWatching]);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    const userAgent = navigator.userAgent.slice(0, 500);

    const startSession = async () => {
      const { data, error } = await supabase.functions.invoke("session-heartbeat", {
        body: {
          action: "start",
          sessionToken: tokenRef.current,
          userAgent,
          channelId: channelInfoRef.current.channelId ?? null,
          channelName: channelInfoRef.current.channelName ?? null,
          isWatching: channelInfoRef.current.isWatching,
        },
      });

      if (error || cancelled) return;
      sessionIdRef.current = data.id;

      intervalRef.current = setInterval(async () => {
        if (!sessionIdRef.current) return;
        await supabase.functions.invoke("session-heartbeat", {
          body: {
            action: "heartbeat",
            sessionId: sessionIdRef.current,
            channelId: channelInfoRef.current.channelId ?? null,
            channelName: channelInfoRef.current.channelName ?? null,
            isWatching: channelInfoRef.current.isWatching,
          },
        });
      }, HEARTBEAT_INTERVAL_MS);
    };

    startSession();

    const endSession = () => {
      if (sessionIdRef.current) {
        // beacon-style: fire-and-forget
        supabase.functions
          .invoke("session-heartbeat", {
            body: {
              action: "end",
              sessionId: sessionIdRef.current,
            },
          })
          .then(() => {});
      }
    };

    window.addEventListener("beforeunload", endSession);
    window.addEventListener("pagehide", endSession);

    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
      window.removeEventListener("beforeunload", endSession);
      window.removeEventListener("pagehide", endSession);
      endSession();
    };
  }, [user]);
};
