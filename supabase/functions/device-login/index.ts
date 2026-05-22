import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Edge function: device-login
// Login com password + registro/validação do dispositivo (APK Android, Roku).
// PWA/web NÃO usa essa função — login direto via supabase.auth.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function getClientIp(req: Request): Promise<string> {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let body: any;
    body = await req.json();
    
    const { email, password, device_id: rawDeviceId, platform, device_name, app_version } = body || {};
    if (!email || !password) return json({ error: "Email e senha obrigatórios" }, 400);
    const device_id = typeof rawDeviceId === "string" ? rawDeviceId.replace(/[^a-zA-Z0-9]/g, "").toUpperCase() : "";
    if (!device_id || device_id.length < 6) {
      return json({ error: "device_id inválido" }, 400);
    }
    if (platform !== "android" && platform !== "roku") {
      return json({ error: "platform deve ser android ou roku" }, 400);
    }

    // 1) Login via SDK Auth para evitar erro upstream no ambiente self-hosted.
    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: authData, error: authError } = await authClient.auth.signInWithPassword({
      email: String(email).trim().toLowerCase(),
      password,
    });
    if (authError || !authData?.session?.access_token || !authData?.user?.id) {
      return json({ error: authError?.message || "Credenciais inválidas" }, 401);
    }
    const userId: string = authData.user.id;
    const accessToken: string = authData.session.access_token;
    const refreshToken: string = authData.session.refresh_token;
    const clientIp = await getClientIp(req);

    // 2) Verifica se o profile está bloqueado/inativo
    const { data: prof } = await adminClient
      .from("profiles")
      .select("is_blocked,is_active")
      .eq("user_id", userId)
      .maybeSingle();
    if (prof?.is_blocked) return json({ error: "Acesso bloqueado. Contate o suporte." }, 403);
    if (prof && !prof.is_active) return json({ error: "Conta inativa." }, 403);

    // 3) Verifica se device_id+platform já existe
    const { data: existing } = await adminClient
      .from("user_devices")
      .select("*")
      .eq("device_id", device_id)
      .eq("platform", platform)
      .maybeSingle();

    if (existing) {
      if (existing.user_id !== userId) {
        return json({ error: "Este dispositivo está vinculado a outra conta. Contate o suporte." }, 409);
      }
      if (!existing.is_active) {
        return json({ error: "Dispositivo bloqueado pelo administrador." }, 403);
      }

      const lastSeenAt = new Date().toISOString();
      await adminClient
        .from("user_devices")
        .update({
          last_seen_at: lastSeenAt,
          last_ip: clientIp || existing.last_ip,
          app_version: app_version || existing.app_version,
          device_name: device_name || existing.device_name,
        })
        .eq("id", existing.id);

      return json({
        success: true,
        access_token: accessToken,
        refresh_token: refreshToken,
        user: authData.user,
        device: { ...existing, last_seen_at: lastSeenAt },
      });
    }

    // 4) Device novo — checa limite
    const { data: activeDevices } = await adminClient
      .from("user_devices")
      .select("id,device_id,platform,device_label,device_name,last_seen_at")
      .eq("user_id", userId)
      .eq("is_active", true);
    const active = Array.isArray(activeDevices) ? activeDevices : [];

    const { data: limitData } = await adminClient.rpc("resolve_device_limit", { _user_id: userId });
    const limit = typeof limitData === "number" ? limitData : 3;

    if (limit > 0 && active.length >= limit) {
      return json(
        {
          error: "Limite de dispositivos atingido. Remova um aparelho ou contate o suporte.",
          limit,
          active_devices: active,
        },
        403,
      );
    }

    // 5) Insere device
    const { data: inserted, error: insertError } = await adminClient
      .from("user_devices")
      .insert({
        user_id: userId,
        device_id,
        platform,
        device_name: device_name || null,
        app_version: app_version || null,
        last_ip: clientIp || null,
        created_by: "self_register",
        is_active: true,
      })
      .select("*")
      .single();
    if (insertError) {
      return json({ error: "Erro ao registrar dispositivo", detail: insertError.message }, 500);
    }

    return json({
      success: true,
      access_token: accessToken,
      refresh_token: refreshToken,
      user: authData.user,
      device: inserted,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro interno";
    console.error("device-login error:", message);
    return json({ error: message }, 500);
  }
});
