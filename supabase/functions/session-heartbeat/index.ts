import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

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

const getClientIp = (request: Request): string | null => {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    null
  );
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
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const { action, sessionId, sessionToken, userAgent, channelId, channelName, isWatching, clientIpv4, clientIpv6 } =
      await req.json();
    const ipAddress = getClientIp(req);
    const cIpv4 = sanitizeIp(clientIpv4);
    const cIpv6 = sanitizeIp(clientIpv6);

    if (action === "start") {
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
        })
        .select("id")
        .single();

      if (error) return json({ error: error.message }, 400);
      return json({ id: data.id });
    }

    if (!sessionId) return json({ error: "sessionId é obrigatório" }, 400);

    const { data: session, error: sessionError } = await adminClient
      .from("user_sessions")
      .select("id")
      .eq("id", sessionId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (sessionError) return json({ error: sessionError.message }, 400);
    if (!session) return json({ error: "Sessão não encontrada" }, 404);

    if (action === "heartbeat") {
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
