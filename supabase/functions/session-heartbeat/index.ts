import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const isPrivateIp = (ip: string): boolean => {
  // Filtra loopback, link-local, docker/k8s/RFC1918 e IPv6 locais
  if (!ip) return true;
  if (ip === "::1" || ip === "127.0.0.1") return true;
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("192.168.")) return true;
  if (ip.startsWith("169.254.")) return true;
  if (ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80:")) return true;
  // 172.16.0.0/12
  const m = ip.match(/^172\.(\d+)\./);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 16 && n <= 31) return true;
  }
  return false;
};

const getClientIp = (request: Request): string | null => {
  const xff = request.headers.get("x-forwarded-for");
  const xr = request.headers.get("x-real-ip");
  const cf = request.headers.get("cf-connecting-ip");

  if (xff) {
    const chain = xff.split(",").map((s) => s.trim()).filter(Boolean);
    for (const ip of chain) {
      if (!isPrivateIp(ip)) return ip;
    }
    if (chain[0]) return chain[0];
  }
  if (cf && !isPrivateIp(cf)) return cf;
  if (xr && !isPrivateIp(xr)) return xr;
  return cf || xr || null;
};


const sanitizeIp = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || t.length > 45) return null;
  return t;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("Authorization");
    const uaHeader = req.headers.get("user-agent") ?? "";
    const looksLikeRoku = /roku/i.test(uaHeader);

    if (!authHeader) {
      if (looksLikeRoku) console.log("[hb][roku] 401 sem Authorization ua=", uaHeader);
      return json({ error: "Unauthorized" }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      if (looksLikeRoku) console.log("[hb][roku] 401 auth.getUser falhou err=", userError?.message, "ua=", uaHeader);
      return json({ error: "Unauthorized" }, 401);
    }

    const { action, sessionId, sessionToken, userAgent, channelId, channelName, isWatching, clientIpv4, clientIpv6, deviceId, platform, deviceName, appVersion } =
      await req.json();
    const ipAddress = getClientIp(req);
    const cIpv4 = sanitizeIp(clientIpv4);
    const cIpv6 = sanitizeIp(clientIpv6);
    const cleanDeviceId = typeof deviceId === "string" && deviceId.length >= 6 ? deviceId : null;
    const cleanPlatform = ["android", "roku", "web", "pwa"].includes(platform) ? platform : null;

    if (platform === "roku" || looksLikeRoku) {
      console.log("[hb][roku]", JSON.stringify({
        action, user_id: user.id, hasSessionId: !!sessionId,
        platform, cleanPlatform, deviceId: cleanDeviceId,
        userAgent: (userAgent || "").slice(0, 80), uaHeader: uaHeader.slice(0, 80),
        appVersion, ip: ipAddress,
      }));
    }


    // Helper: verifica se admin pediu signout remoto após o início da sessão
    const checkForceSignout = async (sessionStartedAt: string | null): Promise<boolean> => {
      const { data: profile } = await adminClient
        .from("profiles")
        .select("force_signout_at")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!profile?.force_signout_at) return false;
      if (!sessionStartedAt) return true;
      return new Date(profile.force_signout_at).getTime() > new Date(sessionStartedAt).getTime();
    };

    if (action === "start") {
      // Antes de criar sessão, checa se há force_signout pendente "no futuro" (qualquer valor)
      // Como ainda não há sessão, comparamos com "agora menos 5s" pra evitar criar sessão de quem foi deslogado.
      const justBefore = new Date(Date.now() - 5000).toISOString();
      const shouldKick = await checkForceSignout(justBefore);
      if (shouldKick) {
        return json({ forceSignout: true });
      }

      const { data, error } = await adminClient
        .from("user_sessions")
        .insert({
          user_id: user.id,
          session_token: sessionToken,
          user_agent: typeof userAgent === "string" ? userAgent.slice(0, 500) : null,
          current_channel_id: channelId ?? null,
          current_channel_name: channelName ?? null,
          is_watching: !!isWatching,
          ip_address: ipAddress,
          client_ipv4: cIpv4,
          client_ipv6: cIpv6,
          device_id: cleanDeviceId,
          platform: cleanPlatform,
        })
        .select("id, started_at")
        .single();

      if (error) return json({ error: error.message }, 400);

      // Auto-vincula dispositivo nativo (APK/Roku) ao usuário, se ainda não estiver
      // vinculado. Respeita limite — se exceder, deixa a sessão rolar mas não cadastra
      // (admin pode cadastrar manualmente pelo painel via "Dispositivos online").
      if (cleanDeviceId && (cleanPlatform === "android" || cleanPlatform === "roku")) {
        const { data: existing } = await adminClient
          .from("user_devices")
          .select("id, user_id, is_active")
          .eq("device_id", cleanDeviceId)
          .eq("platform", cleanPlatform)
          .maybeSingle();

        if (existing) {
          // Atualiza last_seen se for do mesmo user
          if (existing.user_id === user.id) {
            await adminClient
              .from("user_devices")
              .update({
                last_seen_at: new Date().toISOString(),
                last_ip: ipAddress,
                app_version: typeof appVersion === "string" ? appVersion : undefined,
                device_name: typeof deviceName === "string" ? deviceName : undefined,
              })
              .eq("id", existing.id);
          }
        } else {
          // Checa limite antes de inserir
          const { data: activeDevs } = await adminClient
            .from("user_devices")
            .select("id")
            .eq("user_id", user.id)
            .eq("is_active", true);
          const { data: limitData } = await adminClient
            .rpc("resolve_device_limit", { _user_id: user.id });
          const limit = typeof limitData === "number" ? limitData : 3;
          const activeCount = Array.isArray(activeDevs) ? activeDevs.length : 0;
          if (limit === 0 || activeCount < limit) {
            await adminClient.from("user_devices").insert({
              user_id: user.id,
              device_id: cleanDeviceId,
              platform: cleanPlatform,
              device_name: typeof deviceName === "string" ? deviceName : null,
              app_version: typeof appVersion === "string" ? appVersion : null,
              last_ip: ipAddress,
              created_by: "self_register",
              is_active: true,
            });
          }
        }
      }

      return json({ id: data.id });
    }

    if (action === "check") {
      // Endpoint leve para o boot do app conferir se foi deslogado pelo admin
      const justBefore = new Date(Date.now() - 5000).toISOString();
      const shouldKick = await checkForceSignout(justBefore);
      return json({ forceSignout: shouldKick });
    }

    if (!sessionId) return json({ error: "sessionId é obrigatório" }, 400);

    const { data: session, error: sessionError } = await adminClient
      .from("user_sessions")
      .select("id, started_at")
      .eq("id", sessionId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (sessionError) return json({ error: sessionError.message }, 400);
    if (!session) return json({ error: "Sessão não encontrada" }, 404);

    if (action === "heartbeat") {
      const shouldKick = await checkForceSignout(session.started_at);
      if (shouldKick) {
        await adminClient
          .from("user_sessions")
          .update({ ended_at: new Date().toISOString() })
          .eq("id", sessionId);
        return json({ forceSignout: true });
      }

      const { error } = await adminClient
        .from("user_sessions")
        .update({
          last_heartbeat_at: new Date().toISOString(),
          current_channel_id: channelId ?? null,
          current_channel_name: channelName ?? null,
          is_watching: !!isWatching,
          ip_address: ipAddress,
          client_ipv4: cIpv4,
          client_ipv6: cIpv6,
          ...(cleanDeviceId ? { device_id: cleanDeviceId } : {}),
          ...(cleanPlatform ? { platform: cleanPlatform } : {}),
        })
        .eq("id", sessionId)
        .eq("user_id", user.id);

      if (error) return json({ error: error.message }, 400);
      return json({ success: true });
    }

    if (action === "end") {
      const { error } = await adminClient
        .from("user_sessions")
        .update({
          ended_at: new Date().toISOString(),
          ip_address: ipAddress,
        })
        .eq("id", sessionId)
        .eq("user_id", user.id);

      if (error) return json({ error: error.message }, 400);
      return json({ success: true });
    }

    return json({ error: "Ação inválida" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro interno";
    return json({ error: message }, 500);
  }
});
