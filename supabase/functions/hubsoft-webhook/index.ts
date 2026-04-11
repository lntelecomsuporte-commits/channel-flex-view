import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();

    // Log the full payload for debugging
    console.log("=== HUBSOFT WEBHOOK PAYLOAD ===");
    console.log(JSON.stringify(body, null, 2));
    console.log("=== END PAYLOAD ===");

    // Validate authentication using api_key, login, senha
    const { api_key, login, senha } = body;

    if (!api_key) {
      console.error("Missing api_key in request");
      return new Response(JSON.stringify({ error: "api_key is required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch config to validate credentials
    const { data: config, error: configError } = await supabaseAdmin
      .from("hubsoft_config")
      .select("*")
      .limit(1)
      .single();

    if (configError || !config) {
      console.error("Failed to fetch hubsoft config:", configError);
      return new Response(JSON.stringify({ error: "Integration not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!config.is_active) {
      return new Response(JSON.stringify({ error: "Integration is disabled" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate credentials
    if (config.api_key && config.api_key !== api_key) {
      console.error("Invalid api_key");
      return new Response(JSON.stringify({ error: "Invalid api_key" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (config.username && login && config.username !== login) {
      console.error("Invalid login");
      return new Response(JSON.stringify({ error: "Invalid credentials" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (config.password && senha && config.password !== senha) {
      console.error("Invalid senha");
      return new Response(JSON.stringify({ error: "Invalid credentials" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Try to determine the action from the payload
    // The Hubsoft may send: action, acao, tipo, status, evento, or other fields
    const action = body.action || body.acao || body.tipo || body.evento || body.status || null;

    // Extract client data - try common field names
    const email = body.email || body.cliente_email || body.usuario_email || body.login_email || null;
    const password = body.password || body.senha_cliente || body.cliente_senha || body.usuario_senha || null;
    const displayName = body.display_name || body.nome || body.cliente_nome || body.usuario_nome || null;
    const clientId = body.hubsoft_client_id || body.cliente_id || body.client_id || body.id_cliente || body.codigo || null;

    console.log("Parsed fields:", { action, email, displayName, clientId, hasPassword: !!password });

    // If we can't determine the action, log and return success (discovery mode)
    if (!action) {
      console.log("NO ACTION DETECTED - Full payload logged above for analysis");
      return new Response(
        JSON.stringify({
          success: true,
          message: "Payload received and logged. No action field detected. Check logs for payload structure.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const normalizedAction = String(action).toLowerCase().trim();

    // Handle create / activate / habilitar
    if (["create", "criar", "ativar", "habilitar", "activate", "enable"].includes(normalizedAction)) {
      if (!email) {
        return new Response(JSON.stringify({ error: "email is required for create action" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const userPassword = password || email; // fallback to email as password

      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: userPassword,
        email_confirm: true,
        user_metadata: { display_name: displayName || email },
      });

      if (error) {
        // If user already exists, try to unblock them
        if (error.message?.includes("already") || error.message?.includes("exists")) {
          console.log("User already exists, attempting to unblock");
          const updateQuery = clientId
            ? supabaseAdmin.from("profiles").update({ is_blocked: false, is_active: true }).eq("hubsoft_client_id", clientId)
            : supabaseAdmin.from("profiles").update({ is_blocked: false, is_active: true }).eq("username", email);
          await updateQuery;
          return new Response(JSON.stringify({ success: true, message: "User reactivated" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        console.error("Error creating user:", error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Update profile with hubsoft_client_id
      if (clientId && data.user) {
        await supabaseAdmin.from("profiles").update({ hubsoft_client_id: clientId }).eq("user_id", data.user.id);
      }

      return new Response(JSON.stringify({ success: true, user_id: data.user.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle block / suspend / bloquear / suspender / inadimplente
    if (["block", "bloquear", "suspender", "suspend", "inadimplente", "desabilitar", "disable"].includes(normalizedAction)) {
      const identifier = clientId || email;
      if (!identifier) {
        return new Response(JSON.stringify({ error: "client identifier is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const query = clientId
        ? supabaseAdmin.from("profiles").update({ is_blocked: true }).eq("hubsoft_client_id", clientId)
        : supabaseAdmin.from("profiles").update({ is_blocked: true }).eq("username", email);

      const { error } = await query;
      if (error) {
        console.error("Error blocking user:", error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: true, action: "blocked" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle unblock / reactivate / desbloquear / adimplente
    if (["unblock", "desbloquear", "reativar", "reactivate", "adimplente", "enable", "liberar"].includes(normalizedAction)) {
      const identifier = clientId || email;
      if (!identifier) {
        return new Response(JSON.stringify({ error: "client identifier is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const query = clientId
        ? supabaseAdmin.from("profiles").update({ is_blocked: false, is_active: true }).eq("hubsoft_client_id", clientId)
        : supabaseAdmin.from("profiles").update({ is_blocked: false, is_active: true }).eq("username", email);

      const { error } = await query;
      if (error) {
        console.error("Error unblocking user:", error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: true, action: "unblocked" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle delete / excluir / cancelar / remover
    if (["delete", "excluir", "cancelar", "remover", "remove", "cancel"].includes(normalizedAction)) {
      const identifier = clientId || email;
      if (!identifier) {
        return new Response(JSON.stringify({ error: "client identifier is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const profileQuery = clientId
        ? supabaseAdmin.from("profiles").select("user_id").eq("hubsoft_client_id", clientId)
        : supabaseAdmin.from("profiles").select("user_id").eq("username", email);

      const { data: profile } = await profileQuery.single();
      if (profile) {
        await supabaseAdmin.auth.admin.deleteUser(profile.user_id);
      }

      return new Response(JSON.stringify({ success: true, action: "deleted" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Unknown action - log it
    console.log("UNKNOWN ACTION:", normalizedAction, "- Full payload logged above");
    return new Response(
      JSON.stringify({
        success: true,
        message: `Unknown action '${normalizedAction}'. Payload logged for analysis.`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Webhook error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
