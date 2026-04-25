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

async function serviceRestFetch(supabaseUrl: string, serviceRoleKey: string, path: string, method: string, body?: unknown) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${serviceRoleKey}`,
      "apikey": serviceRoleKey,
      "Content-Type": "application/json",
      "Prefer": "return=representation",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

async function cleanupPublicUserData(supabaseUrl: string, serviceRoleKey: string, userId: string) {
  const tables = ["user_category_access", "user_roles", "user_sessions", "user_favorites", "profiles"];
  for (const table of tables) {
    const res = await serviceRestFetch(supabaseUrl, serviceRoleKey, `${table}?user_id=eq.${encodeURIComponent(userId)}`, "DELETE");
    if (!res.ok) console.error(`cleanup ${table} failed:`, res.status, res.data);
  }
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
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

    if (action === "create") {
      if (!normalizedEmail || !password) return json({ error: "Email e senha são obrigatórios" }, 400);

      const existingProfile = await serviceRestFetch(
        supabaseUrl,
        serviceRoleKey,
        `profiles?username=eq.${encodeURIComponent(normalizedEmail)}&select=user_id&limit=1`,
        "GET",
      );
      if (existingProfile.ok && Array.isArray(existingProfile.data) && existingProfile.data.length > 0) {
        return json({ error: "Já existe um usuário cadastrado com este email" }, 409);
      }

      const { ok, data, status } = await adminAuthFetch(supabaseUrl, serviceRoleKey, "users", "POST", {
        email: normalizedEmail,
        password,
        email_confirm: true,
        user_metadata: { display_name: display_name || normalizedEmail },
      });

      if (!ok) {
        console.error("auth.admin.createUser failed:", status, data);
        return json({ error: data.msg || data.message || data.error_description || `Auth error ${status}` }, 400);
      }

      const newUserId = data.id;

      // Garante o profile (caso a trigger handle_new_user não exista no self-hosted)
      const profileRes = await fetch(`${supabaseUrl}/rest/v1/profiles`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${serviceRoleKey}`,
          "apikey": serviceRoleKey,
          "Content-Type": "application/json",
          "Prefer": "resolution=ignore-duplicates,return=minimal",
        },
        body: JSON.stringify({
          user_id: newUserId,
          username: normalizedEmail,
          display_name: display_name || normalizedEmail,
        }),
      });
      if (!profileRes.ok && profileRes.status !== 409) {
        const errText = await profileRes.text();
        console.error("profile insert failed:", profileRes.status, errText);
        // Não falha o request — usuário foi criado no auth
      }

      return json({ success: true, user_id: newUserId });
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

      await cleanupPublicUserData(supabaseUrl, serviceRoleKey, user_id);

      const { ok, data, status } = await adminAuthFetch(supabaseUrl, serviceRoleKey, `users/${user_id}`, "DELETE");
      if (!ok && status !== 404) {
        console.error("auth.admin.deleteUser failed:", status, data);
        return json({ error: data.msg || data.message || data.error_description || `Auth error ${status}` }, 400);
      }
      return json({ success: true, auth_deleted: ok, was_orphan: status === 404 });
    }

    return json({ error: "Ação inválida" }, 400);
  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
