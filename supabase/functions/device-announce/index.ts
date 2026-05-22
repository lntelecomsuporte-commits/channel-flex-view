import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// device-announce: APK envia "beacon" enquanto está na tela de login.
// Registra/atualiza o aparelho em pending_devices para o admin vincular.
// Se já estiver cadastrado em user_devices, retorna registered=true para o
// APK parar o beacon e tentar device-auto-login.

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

function getClientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json().catch(() => ({}));
    const { device_id: rawDeviceId, platform, device_name, app_version } = body || {};

    const device_id =
      typeof rawDeviceId === "string"
        ? rawDeviceId.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()
        : "";
    if (!device_id || device_id.length < 6) {
      return json({ error: "device_id inválido" }, 400);
    }
    if (platform !== "android" && platform !== "roku") {
      return json({ error: "platform inválida" }, 400);
    }

    // Se já estiver cadastrado, limpa pending e avisa pro APK
    const { data: bound } = await admin
      .from("user_devices")
      .select("id, is_active")
      .eq("device_id", device_id)
      .eq("platform", platform)
      .maybeSingle();

    if (bound) {
      await admin
        .from("pending_devices")
        .delete()
        .eq("device_id", device_id)
        .eq("platform", platform);
      return json({ ok: true, registered: true, is_active: bound.is_active });
    }

    const ip = getClientIp(req) || null;
    const now = new Date().toISOString();

    await admin.from("pending_devices").upsert(
      {
        device_id,
        platform,
        device_name: device_name || null,
        app_version: app_version || null,
        last_ip: ip,
        last_seen_at: now,
      },
      { onConflict: "device_id,platform" },
    );

    return json({ ok: true, registered: false });
  } catch (e: any) {
    console.error("device-announce error:", e?.message || e);
    return json({ error: e?.message || String(e) }, 500);
  }
});
