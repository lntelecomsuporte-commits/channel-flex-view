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

async function restFetch(
  supabaseUrl: string,
  serviceRoleKey: string,
  path: string,
  method: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(extraHeaders || {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

async function rpcFetch(supabaseUrl: string, serviceRoleKey: string, fn: string, args: unknown) {
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

async function getClientIp(req: Request): Promise<string> {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const { email, password, device_id, platform, device_name, app_version } = body || {};
  if (!email || !password) return json({ error: "Email e senha obrigatórios" }, 400);
  if (!device_id || typeof device_id !== "string" || device_id.length < 6) {
    return json({ error: "device_id inválido" }, 400);
  }
  if (platform !== "android" && platform !== "roku") {
    return json({ error: "platform deve ser android ou roku" }, 400);
  }

  // 1) Login via Auth API (não criamos sessão ainda no client; só depois que device passar)
  const authRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email: String(email).trim().toLowerCase(), password }),
  });
  const authData = await authRes.json().catch(() => ({}));
  if (!authRes.ok || !authData?.access_token || !authData?.user?.id) {
    return json(
      { error: authData?.error_description || authData?.msg || "Credenciais inválidas" },
      401,
    );
  }
  const userId: string = authData.user.id;
  const accessToken: string = authData.access_token;
  const refreshToken: string = authData.refresh_token;
  const clientIp = await getClientIp(req);

  // 2) Verifica se o profile está bloqueado/inativo
  const profRes = await restFetch(
    supabaseUrl,
    serviceRoleKey,
    `profiles?user_id=eq.${userId}&select=is_blocked,is_active&limit=1`,
    "GET",
  );
  const prof = Array.isArray(profRes.data) ? profRes.data[0] : null;
  if (prof?.is_blocked) return json({ error: "Acesso bloqueado. Contate o suporte." }, 403);
  if (prof && !prof.is_active) return json({ error: "Conta inativa." }, 403);

  // 3) Verifica se device_id+platform já existe
  const existRes = await restFetch(
    supabaseUrl,
    serviceRoleKey,
    `user_devices?device_id=eq.${encodeURIComponent(device_id)}&platform=eq.${platform}&select=*&limit=1`,
    "GET",
  );
  const existing = Array.isArray(existRes.data) ? existRes.data[0] : null;

  if (existing) {
    if (existing.user_id !== userId) {
      return json(
        { error: "Este dispositivo está vinculado a outra conta. Contate o suporte." },
        409,
      );
    }
    if (!existing.is_active) {
      return json({ error: "Dispositivo bloqueado pelo administrador." }, 403);
    }
    // Update last_seen
    await restFetch(
      supabaseUrl,
      serviceRoleKey,
      `user_devices?id=eq.${existing.id}`,
      "PATCH",
      {
        last_seen_at: new Date().toISOString(),
        last_ip: clientIp || existing.last_ip,
        app_version: app_version || existing.app_version,
        device_name: device_name || existing.device_name,
      },
    );

    return json({
      success: true,
      access_token: accessToken,
      refresh_token: refreshToken,
      user: authData.user,
      device: { ...existing, last_seen_at: new Date().toISOString() },
    });
  }

  // 4) Device novo — checa limite
  const countRes = await restFetch(
    supabaseUrl,
    serviceRoleKey,
    `user_devices?user_id=eq.${userId}&is_active=eq.true&select=id,device_id,platform,device_label,device_name,last_seen_at`,
    "GET",
  );
  const active: any[] = Array.isArray(countRes.data) ? countRes.data : [];

  const limitRes = await rpcFetch(supabaseUrl, serviceRoleKey, "resolve_device_limit", {
    _user_id: userId,
  });
  const limit: number = typeof limitRes.data === "number" ? limitRes.data : 3;

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
  const insRes = await restFetch(supabaseUrl, serviceRoleKey, "user_devices", "POST", {
    user_id: userId,
    device_id,
    platform,
    device_name: device_name || null,
    app_version: app_version || null,
    last_ip: clientIp || null,
    created_by: "self_register",
    is_active: true,
  });
  if (!insRes.ok) {
    return json({ error: "Erro ao registrar dispositivo", detail: insRes.data }, 500);
  }
  const inserted = Array.isArray(insRes.data) ? insRes.data[0] : insRes.data;

  return json({
    success: true,
    access_token: accessToken,
    refresh_token: refreshToken,
    user: authData.user,
    device: inserted,
  });
});
