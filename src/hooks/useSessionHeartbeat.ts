import { useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/lib/supabaseLocal";
import { useAuth } from "./useAuth";

interface HeartbeatOptions {
  channelId?: string | null;
  channelName?: string | null;
  isWatching?: boolean;
}

const HEARTBEAT_INTERVAL_MS = 30_000;
const isNativeApp = Capacitor.isNativePlatform();

const isIPv4 = (ip: string) => /^(\d{1,3}\.){3}\d{1,3}$/.test(ip);
const isIPv6 = (ip: string) => ip.includes(":");

// Tenta múltiplos provedores em sequência até obter um IP válido
const fetchWithFallback = async (urls: { url: string; parse: (txt: string) => string | null }[]): Promise<string | null> => {
  for (const { url, parse } of urls) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3500);
      const r = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
      clearTimeout(t);
      if (!r.ok) continue;
      const txt = await r.text();
      const ip = parse(txt);
      if (ip) return ip.trim();
    } catch {
      // tenta o próximo
    }
  }
  return null;
};

const parseJsonIp = (txt: string) => {
  try { const j = JSON.parse(txt); return typeof j.ip === "string" ? j.ip : null; } catch { return null; }
};
const parsePlain = (txt: string) => txt.trim() || null;
const parseCfTrace = (txt: string) => {
  const m = txt.match(/^ip=(.+)$/m);
  return m ? m[1] : null;
};

const mergeDetectedIps = (
  previous: { ipv4: string | null; ipv6: string | null },
  detected: { ipv4: string | null; ipv6: string | null }
) => ({
  ipv4: detected.ipv4 ?? previous.ipv4,
  ipv6: detected.ipv6 ?? previous.ipv6,
});

// Detecta IPv4 e IPv6 do cliente com múltiplos provedores de fallback
const detectClientIps = async (): Promise<{ ipv4: string | null; ipv6: string | null }> => {
  const ipv4Providers = isNativeApp
    ? [
        { url: "https://api.ipify.org?format=json", parse: parseJsonIp },
        { url: "https://ipv4.icanhazip.com", parse: parsePlain },
        { url: "https://api.ipify.org", parse: parsePlain },
        { url: "https://1.1.1.1/cdn-cgi/trace", parse: parseCfTrace },
      ]
    : [
        { url: "https://1.1.1.1/cdn-cgi/trace", parse: parseCfTrace },
        { url: "https://api.ipify.org?format=json", parse: parseJsonIp },
        { url: "https://ipv4.icanhazip.com", parse: parsePlain },
        { url: "https://api.ipify.org", parse: parsePlain },
      ];

  const ipv6Providers = isNativeApp
    ? [
        { url: "https://api6.ipify.org?format=json", parse: parseJsonIp },
        { url: "https://api64.ipify.org?format=json", parse: parseJsonIp },
        { url: "https://ipv6.icanhazip.com", parse: parsePlain },
        { url: "https://[2606:4700:4700::1111]/cdn-cgi/trace", parse: parseCfTrace },
      ]
    : [
        { url: "https://[2606:4700:4700::1111]/cdn-cgi/trace", parse: parseCfTrace },
        { url: "https://api6.ipify.org?format=json", parse: parseJsonIp },
        { url: "https://ipv6.icanhazip.com", parse: parsePlain },
        { url: "https://api64.ipify.org?format=json", parse: parseJsonIp },
      ];

  const [v4, v6] = await Promise.all([
    fetchWithFallback(ipv4Providers),
    fetchWithFallback(ipv6Providers),
  ]);

  // Classifica corretamente: alguns endpoints "v6" podem retornar v4 se não houver IPv6
  let ipv4 = v4 && isIPv4(v4) ? v4 : null;
  let ipv6 = v6 && isIPv6(v6) ? v6 : null;

  // Se v6 endpoint devolveu v4 e ainda não temos v4, aproveita
  if (!ipv4 && v6 && isIPv4(v6)) ipv4 = v6;
  // Se v4 endpoint devolveu v6 (raro), aproveita
  if (!ipv6 && v4 && isIPv6(v4)) ipv6 = v4;

  return { ipv4, ipv6 };
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
    const refreshClientIps = async () => {
      const detected = await detectClientIps();
      ipsRef.current = mergeDetectedIps(ipsRef.current, detected);
      return ipsRef.current;
    };

    const handleForceSignout = async () => {
      console.warn("[useSessionHeartbeat] Force signout recebido do servidor — deslogando");
      try {
        await supabase.auth.signOut();
      } catch (e) {
        console.warn("[useSessionHeartbeat] signOut falhou", e);
      }
    };

    const startSession = async () => {
      await refreshClientIps();
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
      if (data?.forceSignout) {
        await handleForceSignout();
        return;
      }
      sessionIdRef.current = data.id;

      intervalRef.current = setInterval(async () => {
        if (!sessionIdRef.current) return;
        // Re-detecta IPs periodicamente (rede pode ter mudado)
        await refreshClientIps();
        const { data: hbData } = await supabase.functions.invoke("session-heartbeat", {
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
        if (hbData?.forceSignout) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          await handleForceSignout();
        }
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
