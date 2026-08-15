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

function loginCandidates(login: string): string[] {
  const raw = String(login || "").trim().toLowerCase();
  const out = new Set<string>();
  const digits = raw.replace(/\D/g, "");
  if (!raw.includes("@") && (digits.length === 11 || digits.length === 14)) {
    out.add(`${digits}@tvln.local`);
  }
  if (raw) out.add(raw);
  return [...out];
}

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

    // 1) Login via SDK Auth; se falhar, aceita também credencial de playlist
    // (profiles.username + profiles.playlist_password), que é o "usuário/senha"
    // mostrado no painel para clientes Hubsoft/IPTV.
    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let userId = "";
    let accessToken = "";
    let refreshToken = "";
    let authUser: unknown = null;
    let lastAuthError = "Credenciais inválidas";

    const candidates = loginCandidates(email);
    for (const candidate of candidates) {
      const { data, error } = await authClient.auth.signInWithPassword({ email: candidate, password });
      if (data?.session?.access_token && data?.user?.id) {
        userId = data.user.id;
        accessToken = data.session.access_token;
        refreshToken = data.session.refresh_token;
        authUser = data.user;
        break;
      }
      if (error?.message) lastAuthError = error.message;
    }

    if (!accessToken) {
      const loginValues = candidates.length ? candidates : [String(email).trim().toLowerCase()];
      const { data: profileLogin } = await adminClient
        .from("profiles")
        .select("user_id,username,is_blocked,is_active")
        .in("username", loginValues)
        .eq("playlist_password", password)
        .maybeSingle();

      if (profileLogin?.user_id) {
        const { data: userData, error: userErr } = await adminClient.auth.admin.getUserById(profileLogin.user_id);
        if (userErr || !userData?.user?.email) {
          return json({ error: "Usuário não encontrado" }, 404);
        }
        const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
          type: "magiclink",
          email: userData.user.email,
        });
        if (linkErr || !linkData?.properties?.hashed_token) {
          return json({ error: "Falha ao gerar sessão: " + (linkErr?.message || "no token") }, 500);
        }
        const { data: otpData, error: otpErr } = await authClient.auth.verifyOtp({
          token_hash: linkData.properties.hashed_token,
          type: "magiclink",
        });
        const session = otpData?.session;
        const user = otpData?.user ?? session?.user;
        if (otpErr || !session?.access_token || !user?.id) {
          return json({ error: "Falha ao validar sessão: " + (otpErr?.message || "no session") }, 500);
        }
        userId = user.id;
        accessToken = session.access_token;
        refreshToken = session.refresh_token;
        authUser = user;
      }
    }

    if (!accessToken || !userId) {
      return json({ error: lastAuthError }, 401);
    }

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
    const { data: existingRow } = await adminClient
      .from("user_devices")
      .select("*")
      .eq("device_id", device_id)
      .eq("platform", platform)
      .maybeSingle();
    let existing = existingRow;

    if (existing && existing.user_id !== userId) {
      // O dono anterior ainda existe? Se o profile sumiu (cliente removido /
      // troca de titularidade), o registro é órfão — libera o aparelho.
      const { data: owner } = await adminClient
        .from("profiles")
        .select("user_id")
        .eq("user_id", existing.user_id)
        .maybeSingle();
      if (owner) {
        return json({ error: "Este dispositivo está vinculado a outra conta. Contate o suporte." }, 409);
      }
      console.log("Removendo vínculo órfão do device:", existing.device_id, existing.user_id);
      await adminClient.from("user_devices").delete().eq("id", existing.id);
      existing = null;
    }

    if (existing) {


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
        user: authUser,
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
      user: authUser,
      device: inserted,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro interno";
    console.error("device-login error:", message);
    return json({ error: message }, 500);
  }
});
