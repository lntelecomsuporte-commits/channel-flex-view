import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

interface HeartbeatOptions {
  channelId?: string | null;
  channelName?: string | null;
  isWatching?: boolean;
}

const HEARTBEAT_INTERVAL_MS = 30_000;

// Detecta IPv4 e IPv6 do cliente em paralelo via ipify
const detectClientIps = async (): Promise<{ ipv4: string | null; ipv6: string | null }> => {
  const fetchIp = async (url: string): Promise<string | null> => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) return null;
      const j = await r.json();
      return typeof j.ip === "string" ? j.ip : null;
    } catch {
      return null;
    }
  };
  const [ipv4, ipv6] = await Promise.all([
    fetchIp("https://api.ipify.org?format=json"),
    fetchIp("https://api6.ipify.org?format=json"),
  ]);
  // Se v6 retornar igual ao v4 (sem IPv6 disponível), descarta
  return { ipv4, ipv6: ipv6 && ipv6 !== ipv4 ? ipv6 : null };
};

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
  const ipsRef = useRef<{ ipv4: string | null; ipv6: string | null }>({ ipv4: null, ipv6: null });

  useEffect(() => {
    channelInfoRef.current = { channelId, channelName, isWatching };
  }, [channelId, channelName, isWatching]);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    const userAgent = navigator.userAgent.slice(0, 500);

    const startSession = async () => {
      ipsRef.current = await detectClientIps();
      if (cancelled) return;

      const { data, error } = await supabase.functions.invoke("session-heartbeat", {
        body: {
          action: "start",
          sessionToken: tokenRef.current,
          userAgent,
          channelId: channelInfoRef.current.channelId ?? null,
          channelName: channelInfoRef.current.channelName ?? null,
          isWatching: channelInfoRef.current.isWatching,
          clientIpv4: ipsRef.current.ipv4,
          clientIpv6: ipsRef.current.ipv6,
        },
      });

      if (error || cancelled) return;
      sessionIdRef.current = data.id;

      intervalRef.current = setInterval(async () => {
        if (!sessionIdRef.current) return;
        // Re-detecta IPs periodicamente (rede pode ter mudado)
        ipsRef.current = await detectClientIps();
        await supabase.functions.invoke("session-heartbeat", {
          body: {
            action: "heartbeat",
            sessionId: sessionIdRef.current,
            channelId: channelInfoRef.current.channelId ?? null,
            channelName: channelInfoRef.current.channelName ?? null,
            isWatching: channelInfoRef.current.isWatching,
            clientIpv4: ipsRef.current.ipv4,
            clientIpv6: ipsRef.current.ipv6,
          },
        });
      }, HEARTBEAT_INTERVAL_MS);
    };

    startSession();

    const endSession = () => {
      if (sessionIdRef.current) {
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
