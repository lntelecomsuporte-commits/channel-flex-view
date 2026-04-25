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
    const codigoCliente = cliente?.codigo_cliente ? String(cliente.codigo_cliente) : null;

    console.log("Client data:", { email, nome, cpf, idCliente, codigoCliente });

    // Robust profile lookup: try hubsoft_client_id (id_cliente OR codigo_cliente),
    // then username = email, then username = cpf@tvln.local
    async function findProfiles(): Promise<{ user_id: string }[]> {
      const seen = new Set<string>();
      const results: { user_id: string }[] = [];
      const push = (rows: { user_id: string }[] | null) => {
        if (!rows) return;
        for (const r of rows) {
          if (!seen.has(r.user_id)) {
            seen.add(r.user_id);
            results.push(r);
          }
        }
      };

      const candidates: string[] = [];
      if (idCliente) candidates.push(idCliente);
      if (codigoCliente && codigoCliente !== idCliente) candidates.push(codigoCliente);

      for (const candidate of candidates) {
        const { data } = await supabaseAdmin.from("profiles")
          .select("user_id")
          .eq("hubsoft_client_id", candidate);
        if (data?.length) console.log(`Profiles found by hubsoft_client_id=${candidate}: ${data.length}`);
        push(data);
      }
      if (email) {
        const { data } = await supabaseAdmin.from("profiles")
          .select("user_id")
          .eq("username", email);
        if (data?.length) console.log(`Profiles found by username=${email}: ${data.length}`);
        push(data);
      }
      if (cpf) {
        const fallbackEmail = `${cpf}@tvln.local`;
        const { data } = await supabaseAdmin.from("profiles")
          .select("user_id")
          .eq("username", fallbackEmail);
        if (data?.length) console.log(`Profiles found by username=${fallbackEmail}: ${data.length}`);
        push(data);
      }
      if (results.length === 0) {
        console.warn("No profile found for client", { idCliente, codigoCliente, cpf, email });
      }
      return results;
    }

    // Backward-compat helper (returns first match)
    async function findProfile(): Promise<{ user_id: string } | null> {
      const list = await findProfiles();
      return list[0] ?? null;
    }

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
      const profiles = await findProfiles();
      if (profiles.length === 0) {
        return new Response(JSON.stringify({ success: false, action: "blocked", message: "profile not found", idCliente, codigoCliente, cpf }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const blocked: string[] = [];
      for (const profile of profiles) {
        await revokeCategoryAccess(profile.user_id);
        const { data: remainingAccess } = await supabaseAdmin
          .from("user_category_access")
          .select("id")
          .eq("user_id", profile.user_id)
          .limit(1);
        if (!remainingAccess || remainingAccess.length === 0) {
          await supabaseAdmin.from("profiles").update({ is_blocked: true }).eq("user_id", profile.user_id);
          blocked.push(profile.user_id);
        }
      }

      return new Response(JSON.stringify({ success: true, action: "blocked", count: profiles.length, blocked }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle "habilitar" / "reativar"
    if (["habilitar", "habilitacao", "reativar", "adimplente", "desbloquear", "enable", "unblock", "liberar"].includes(normalizedTipo)) {
      const profiles = await findProfiles();
      if (profiles.length === 0) {
        return new Response(JSON.stringify({ success: false, action: "unblocked", message: "profile not found", idCliente, codigoCliente, cpf }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      for (const profile of profiles) {
        await supabaseAdmin.from("profiles").update({ is_blocked: false, is_active: true }).eq("user_id", profile.user_id);
        if (idCliente) {
          await supabaseAdmin.from("profiles").update({ hubsoft_client_id: idCliente }).eq("user_id", profile.user_id);
        }
        await grantCategoryAccess(profile.user_id);
      }

      return new Response(JSON.stringify({ success: true, action: "unblocked", count: profiles.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle "cancelar" / "excluir" / "remover"
    if (["cancelar", "excluir", "remover", "remocao", "delete", "cancel", "remove"].includes(normalizedTipo)) {
      const profiles = await findProfiles();
      if (profiles.length === 0) {
        return new Response(JSON.stringify({ success: false, action: "deleted", message: "profile not found", idCliente, codigoCliente, cpf }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const deleted: string[] = [];
      const kept: string[] = [];
      const errors: { user_id: string; error: string }[] = [];

      for (const profile of profiles) {
        await revokeCategoryAccess(profile.user_id);
        const { data: remainingAccess } = await supabaseAdmin
          .from("user_category_access")
          .select("id")
          .eq("user_id", profile.user_id)
          .limit(1);

        if (!remainingAccess || remainingAccess.length === 0) {
          const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(profile.user_id);
          if (delErr) {
            console.error("deleteUser error:", profile.user_id, delErr);
            errors.push({ user_id: profile.user_id, error: delErr.message });
          } else {
            console.log("User deleted:", profile.user_id);
            deleted.push(profile.user_id);
          }
        } else {
          console.log("User kept (still has access from other configs):", profile.user_id);
          kept.push(profile.user_id);
        }
      }

      return new Response(JSON.stringify({
        success: errors.length === 0,
        action: "deleted",
        count: profiles.length,
        deleted, kept, errors,
      }), {
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
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
