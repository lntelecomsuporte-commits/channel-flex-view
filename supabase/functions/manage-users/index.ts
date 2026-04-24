import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function adminAuthFetch(supabaseUrl: string, serviceRoleKey: string, path: string, method: string, body?: unknown) {
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${serviceRoleKey}`,
      "apikey": serviceRoleKey,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify caller is admin
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) return json({ error: "Unauthorized" }, 401);

      const { data: isAdmin } = await userClient.rpc("has_role", { _user_id: user.id, _role: "admin" });
      if (!isAdmin) return json({ error: "Forbidden" }, 403);
    }

    const { action, email, password, display_name, user_id } = await req.json();

    if (action === "create") {
      if (!email || !password) return json({ error: "Email e senha são obrigatórios" }, 400);

      const { ok, data } = await adminAuthFetch(supabaseUrl, serviceRoleKey, "users", "POST", {
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: display_name || email },
      });

      if (!ok) return json({ error: data.msg || data.message || "Erro ao criar usuário" }, 400);
      return json({ success: true, user_id: data.id });
    }

    if (action === "update") {
      if (!user_id) return json({ error: "user_id é obrigatório" }, 400);

      const updates: Record<string, unknown> = {};
      if (password) updates.password = password;
      if (email) updates.email = email;
      if (display_name !== undefined) updates.user_metadata = { display_name };

      const { ok, data } = await adminAuthFetch(supabaseUrl, serviceRoleKey, `users/${user_id}`, "PUT", updates);
      if (!ok) return json({ error: data.msg || data.message || "Erro ao atualizar" }, 400);

      // Update display_name in profiles if provided
      if (display_name !== undefined) {
        const adminClient = createClient(supabaseUrl, serviceRoleKey, {
          auth: { autoRefreshToken: false, persistSession: false },
          db: { schema: "public" },
        });
        // Use REST API directly for profile update to avoid JWT issues
        await fetch(`${supabaseUrl}/rest/v1/profiles?user_id=eq.${user_id}`, {
          method: "PATCH",
          headers: {
            "Authorization": `Bearer ${serviceRoleKey}`,
            "apikey": serviceRoleKey,
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
          },
          body: JSON.stringify({ display_name }),
        });
      }

      return json({ success: true });
    }

    if (action === "delete") {
      if (!user_id) return json({ error: "user_id é obrigatório" }, 400);

      const { ok, data } = await adminAuthFetch(supabaseUrl, serviceRoleKey, `users/${user_id}`, "DELETE");
      if (!ok) return json({ error: data.msg || data.message || "Erro ao excluir" }, 400);
      return json({ success: true });
    }

    return json({ error: "Ação inválida" }, 400);
  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
