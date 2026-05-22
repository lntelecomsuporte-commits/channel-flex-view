import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// device-auto-login: APK envia device_id+platform.
// Se o dispositivo já estiver pré-cadastrado (admin) e ativo,
// retorna access_token/refresh_token sem precisar de senha (igual Netflix activation).

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

    const body = await req.json().catch(() => ({}));
    const { device_id, platform, device_name, app_version } = body || {};

    if (!device_id || typeof device_id !== "string" || device_id.length < 6) {
      return json({ error: "device_id inválido" }, 400);
    }
    if (platform !== "android" && platform !== "roku") {
      return json({ error: "platform deve ser android ou roku" }, 400);
    }

    // 1) Procura o device pré-cadastrado
    const { data: device } = await adminClient
      .from("user_devices")
      .select("id, user_id, is_active")
      .eq("device_id", device_id)
      .eq("platform", platform)
      .maybeSingle();

    if (!device) {
      return json({ error: "Dispositivo não cadastrado", code: "not_registered" }, 404);
    }
    if (!device.is_active) {
      return json({ error: "Dispositivo bloqueado pelo administrador" }, 403);
    }

    // 2) Verifica profile
    const { data: prof } = await adminClient
      .from("profiles")
      .select("is_blocked, is_active")
      .eq("user_id", device.user_id)
      .maybeSingle();
    if (prof?.is_blocked) return json({ error: "Acesso bloqueado. Contate o suporte." }, 403);
    if (prof && !prof.is_active) return json({ error: "Conta inativa." }, 403);

    // 3) Pega email do usuário
    const { data: userData, error: userErr } = await adminClient.auth.admin.getUserById(device.user_id);
    if (userErr || !userData?.user?.email) {
      return json({ error: "Usuário não encontrado" }, 404);
    }
    const email = userData.user.email;

    // 4) Gera magiclink e troca por sessão via verifyOtp
    const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkErr || !linkData?.properties?.hashed_token) {
      return json({ error: "Falha ao gerar sessão: " + (linkErr?.message || "no token") }, 500);
    }

    const anonClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: otpData, error: otpErr } = await anonClient.auth.verifyOtp({
      token_hash: linkData.properties.hashed_token,
      type: "magiclink",
    });
    if (otpErr || !otpData?.session?.access_token) {
      return json({ error: "Falha ao validar sessão: " + (otpErr?.message || "no session") }, 500);
    }

    // 5) Atualiza last_seen
    const clientIp = await getClientIp(req);
    await adminClient
      .from("user_devices")
      .update({
        last_seen_at: new Date().toISOString(),
        last_ip: clientIp || null,
        app_version: app_version || null,
        device_name: device_name || null,
      })
      .eq("id", device.id);

    return json({
      success: true,
      access_token: otpData.session.access_token,
      refresh_token: otpData.session.refresh_token,
      user_id: device.user_id,
    });
  } catch (e: any) {
    const message = e?.message || String(e);
    console.error("device-auto-login error:", message);
    return json({ error: message }, 500);
  }
});
