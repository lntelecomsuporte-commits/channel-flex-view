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

    const url = new URL(req.url);
    const pathSegments = url.pathname.split("/").filter(Boolean);
    const hubsoftWebhookIndex = pathSegments.lastIndexOf("hubsoft-webhook");
    const apiKeyFromPath =
      hubsoftWebhookIndex >= 0 && pathSegments[hubsoftWebhookIndex + 1]
        ? pathSegments[hubsoftWebhookIndex + 1]
        : null;
    const apiKeyParam = url.searchParams.get("api_key");

    const body = await req.json();

    const apiKeyHeader =
      req.headers.get("api_key") ||
      req.headers.get("apikey") ||
      req.headers.get("x-api-key");
    const authorizationHeader = req.headers.get("authorization");
    const bearerApiKey = authorizationHeader?.toLowerCase().startsWith("bearer ")
      ? authorizationHeader.slice(7).trim()
      : null;

    console.log("=== HUBSOFT WEBHOOK ===");
    console.log("Body:", JSON.stringify(body, null, 2));

    const api_key = apiKeyFromPath || apiKeyParam || apiKeyHeader || bearerApiKey || body.api_key || null;

    if (!api_key) {
      console.error("Missing api_key in request");
      return new Response(JSON.stringify({ error: "api_key is required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Find config by api_key (supports multiple configs)
    const { data: config, error: configError } = await supabaseAdmin
      .from("hubsoft_config")
      .select("*")
      .eq("api_key", api_key)
      .limit(1)
      .single();

    if (configError || !config) {
      console.error("No config found for api_key");
      return new Response(JSON.stringify({ error: "Invalid api_key or integration not configured" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!config.is_active) {
      return new Response(JSON.stringify({ error: "Integration is disabled" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch categories linked to this config
    const { data: configCategories } = await supabaseAdmin
      .from("hubsoft_config_categories")
      .select("category_id")
      .eq("hubsoft_config_id", config.id);
    
    const linkedCategoryIds = configCategories?.map((cc: any) => cc.category_id) || [];
    console.log("Config:", config.name, "Linked categories:", linkedCategoryIds.length);

    // Parse the Hubsoft payload
    const tipo = body.tipo;
    const pacote = body.pacote;
    const clienteServico = body.cliente_servico;
    const idClienteServicoPacote = body.id_cliente_servico_pacote;

    console.log("Parsed event:", { tipo, pacoteDesc: pacote?.descricao, idClienteServicoPacote });

    if (!tipo) {
      return new Response(
        JSON.stringify({ success: true, message: "Payload received. No 'tipo' field." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Optional: filter by package ID
    if (config.package_id && pacote?.id_pacote && String(pacote.id_pacote) !== config.package_id) {
      console.log(`Ignoring package ${pacote.id_pacote} (configured: ${config.package_id})`);
      return new Response(
        JSON.stringify({ success: true, message: "Package ignored" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const cliente = clienteServico?.cliente;
    const email = cliente?.email_principal || null;
    const nome = cliente?.nome_razaosocial || null;
    const cpf = cliente?.cpf_cnpj || null;
    const idCliente = cliente?.id_cliente ? String(cliente.id_cliente) : null;

    console.log("Client data:", { email, nome, cpf, idCliente });

    const normalizedTipo = String(tipo).toLowerCase().trim();

    // Helper: grant category access for a user
    async function grantCategoryAccess(userId: string) {
      if (linkedCategoryIds.length === 0) return;
      for (const categoryId of linkedCategoryIds) {
        await supabaseAdmin.from("user_category_access").upsert(
          { user_id: userId, category_id: categoryId, hubsoft_config_id: config.id, is_active: true },
          { onConflict: "user_id,category_id" }
        );
      }
    }

    // Helper: revoke category access for a user (from this config only)
    async function revokeCategoryAccess(userId: string) {
      if (linkedCategoryIds.length === 0) return;
      for (const categoryId of linkedCategoryIds) {
        await supabaseAdmin.from("user_category_access")
          .delete()
          .eq("user_id", userId)
          .eq("category_id", categoryId)
          .eq("hubsoft_config_id", config.id);
      }
    }

    // Handle "cadastro" (create/register)
    if (normalizedTipo === "cadastro") {
      const userEmail = email || (cpf ? `${cpf}@tvln.local` : null);
      if (!userEmail) {
        return new Response(JSON.stringify({ error: "No email or CPF to create user" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const userPassword = cpf || userEmail;

      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email: userEmail,
        password: userPassword,
        email_confirm: true,
        user_metadata: { display_name: nome || userEmail },
      });

      if (error) {
        if (error.message?.includes("already") || error.message?.includes("exists")) {
          console.log("User already exists, ensuring unblocked and granting access");
          // Find user profile
          const { data: profile } = await supabaseAdmin.from("profiles")
            .select("user_id")
            .or(idCliente ? `hubsoft_client_id.eq.${idCliente}` : `username.eq.${userEmail}`)
            .single();
          
          if (profile) {
            await supabaseAdmin.from("profiles").update({ is_blocked: false, is_active: true }).eq("user_id", profile.user_id);
            await grantCategoryAccess(profile.user_id);
          }
          return new Response(JSON.stringify({ success: true, message: "User reactivated", login: userEmail, senha: userPassword }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        console.error("Error creating user:", error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Update profile with hubsoft data
      if (data.user) {
        const profileUpdate: Record<string, string> = {};
        if (idCliente) profileUpdate.hubsoft_client_id = idCliente;
        if (Object.keys(profileUpdate).length > 0) {
          await supabaseAdmin.from("profiles").update(profileUpdate).eq("user_id", data.user.id);
        }
        // Grant category access
        await grantCategoryAccess(data.user.id);
      }

      return new Response(JSON.stringify({ 
        success: true, 
        user_id: data.user.id,
        login: userEmail,
        senha: userPassword,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle "suspender" / "bloquear"
    if (["suspender", "suspensao", "bloquear", "inadimplente", "suspend", "block", "desabilitar", "disable"].includes(normalizedTipo)) {
      if (!idCliente) {
        return new Response(JSON.stringify({ error: "client identifier is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: profile } = await supabaseAdmin.from("profiles")
        .select("user_id")
        .eq("hubsoft_client_id", idCliente)
        .single();

      if (profile) {
        // Revoke category access from this config
        await revokeCategoryAccess(profile.user_id);

        // Check if user still has any active category access
        const { data: remainingAccess } = await supabaseAdmin
          .from("user_category_access")
          .select("id")
          .eq("user_id", profile.user_id)
          .limit(1);

        // If no more access, block the user
        if (!remainingAccess || remainingAccess.length === 0) {
          await supabaseAdmin.from("profiles").update({ is_blocked: true }).eq("hubsoft_client_id", idCliente);
        }
      }

      return new Response(JSON.stringify({ success: true, action: "blocked" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle "habilitar" / "reativar"
    if (["habilitar", "habilitacao", "reativar", "adimplente", "desbloquear", "enable", "unblock", "liberar"].includes(normalizedTipo)) {
      if (!idCliente) {
        return new Response(JSON.stringify({ error: "client identifier is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: profile } = await supabaseAdmin.from("profiles")
        .select("user_id")
        .eq("hubsoft_client_id", idCliente)
        .single();

      if (profile) {
        await supabaseAdmin.from("profiles").update({ is_blocked: false, is_active: true }).eq("hubsoft_client_id", idCliente);
        await grantCategoryAccess(profile.user_id);
      }

      return new Response(JSON.stringify({ success: true, action: "unblocked" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle "cancelar" / "excluir" / "remover"
    if (["cancelar", "excluir", "remover", "remocao", "delete", "cancel", "remove"].includes(normalizedTipo)) {
      if (!idCliente) {
        return new Response(JSON.stringify({ error: "client identifier is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("user_id")
        .eq("hubsoft_client_id", idCliente)
        .single();

      if (profile) {
        // Revoke this config's access
        await revokeCategoryAccess(profile.user_id);

        // Check remaining access
        const { data: remainingAccess } = await supabaseAdmin
          .from("user_category_access")
          .select("id")
          .eq("user_id", profile.user_id)
          .limit(1);

        // Only delete user if no remaining access from other integrations
        if (!remainingAccess || remainingAccess.length === 0) {
          await supabaseAdmin.auth.admin.deleteUser(profile.user_id);
        }
      }

      return new Response(JSON.stringify({ success: true, action: "deleted" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Unknown tipo
    console.log("UNKNOWN TIPO:", normalizedTipo);
    return new Response(
      JSON.stringify({ success: true, message: `Unknown tipo '${normalizedTipo}'. Logged.` }),
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
