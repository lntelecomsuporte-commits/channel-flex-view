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

    // Parse credentials from multiple sources because Hubsoft may forward
    // custom parameters in different ways depending on the integration mode.
    const url = new URL(req.url);
    const pathSegments = url.pathname.split("/").filter(Boolean);
    const hubsoftWebhookIndex = pathSegments.lastIndexOf("hubsoft-webhook");
    const apiKeyFromPath =
      hubsoftWebhookIndex >= 0 && pathSegments[hubsoftWebhookIndex + 1]
        ? pathSegments[hubsoftWebhookIndex + 1]
        : null;
    const apiKeyParam = url.searchParams.get("api_key");
    const loginParam = url.searchParams.get("login");
    const senhaParam = url.searchParams.get("senha");

    const body = await req.json();

    const apiKeyHeader =
      req.headers.get("api_key") ||
      req.headers.get("apikey") ||
      req.headers.get("x-api-key");
    const authorizationHeader = req.headers.get("authorization");
    const bearerApiKey = authorizationHeader?.toLowerCase().startsWith("bearer ")
      ? authorizationHeader.slice(7).trim()
      : null;
    const loginHeader =
      req.headers.get("login") ||
      req.headers.get("x-login");
    const senhaHeader =
      req.headers.get("senha") ||
      req.headers.get("x-senha");

    // Log the full payload for debugging
    console.log("=== HUBSOFT WEBHOOK ===");
    console.log("Request target:", { pathname: url.pathname, hasPathApiKey: Boolean(apiKeyFromPath) });
    console.log("Query params:", { api_key: apiKeyParam, login: loginParam, senha: senhaParam ? "***" : null });
    console.log("Credential headers present:", {
      api_key: Boolean(apiKeyHeader),
      authorization: Boolean(bearerApiKey),
      login: Boolean(loginHeader),
      senha: Boolean(senhaHeader),
    });
    console.log("Body:", JSON.stringify(body, null, 2));

    const api_key = apiKeyFromPath || apiKeyParam || apiKeyHeader || bearerApiKey || body.api_key || null;
    const login = loginParam || loginHeader || body.login || null;
    const senha = senhaParam || senhaHeader || body.senha || null;

    if (!api_key) {
      console.error("Missing api_key in request");
      return new Response(JSON.stringify({ error: "api_key is required in the callback URL path, query string, or headers" }), {
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

    // Parse the Hubsoft payload
    const tipo = body.tipo; // "cadastro", "suspender", "habilitar", "cancelar", etc.
    const status = body.status; // "aguardando_cadastro", etc.
    const pacote = body.pacote; // { id_pacote, descricao, ... }
    const clienteServico = body.cliente_servico; // { id_cliente_servico, cliente, servico_status, ... }
    const idClienteServicoPacote = body.id_cliente_servico_pacote;

    console.log("Parsed event:", { tipo, status, pacoteDesc: pacote?.descricao, idClienteServicoPacote });

    if (!tipo) {
      console.log("NO TIPO DETECTED - Full payload logged above");
      return new Response(
        JSON.stringify({ success: true, message: "Payload received. No 'tipo' field." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Optional: filter by package description (e.g., only process "TVLN")
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
    const idClienteServico = clienteServico?.id_cliente_servico ? String(clienteServico.id_cliente_servico) : null;

    console.log("Client data:", { email, nome, cpf, idCliente, idClienteServico });

    const normalizedTipo = String(tipo).toLowerCase().trim();

    // Handle "cadastro" (create/register)
    if (normalizedTipo === "cadastro") {
      // Generate email from CPF if no email provided
      const userEmail = email || (cpf ? `${cpf}@tvln.local` : null);
      if (!userEmail) {
        return new Response(JSON.stringify({ error: "No email or CPF to create user" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Use CPF as password if no specific password
      const userPassword = cpf || userEmail;

      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email: userEmail,
        password: userPassword,
        email_confirm: true,
        user_metadata: { display_name: nome || userEmail },
      });

      if (error) {
        if (error.message?.includes("already") || error.message?.includes("exists")) {
          console.log("User already exists, ensuring unblocked");
          // Find by hubsoft_client_id or username
          const updateQuery = idCliente
            ? supabaseAdmin.from("profiles").update({ is_blocked: false, is_active: true }).eq("hubsoft_client_id", idCliente)
            : supabaseAdmin.from("profiles").update({ is_blocked: false, is_active: true }).eq("username", userEmail);
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

      // Update profile with hubsoft data
      if (data.user) {
        const profileUpdate: Record<string, string> = {};
        if (idCliente) profileUpdate.hubsoft_client_id = idCliente;
        if (Object.keys(profileUpdate).length > 0) {
          await supabaseAdmin.from("profiles").update(profileUpdate).eq("user_id", data.user.id);
        }
      }

      return new Response(JSON.stringify({ success: true, user_id: data.user.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle "suspender" / "bloquear" / "inadimplente"
    if (["suspender", "bloquear", "inadimplente", "suspend", "block", "desabilitar", "disable"].includes(normalizedTipo)) {
      const identifier = idCliente;
      if (!identifier) {
        return new Response(JSON.stringify({ error: "client identifier is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error } = await supabaseAdmin.from("profiles").update({ is_blocked: true }).eq("hubsoft_client_id", identifier);
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

    // Handle "habilitar" / "reativar" / "adimplente"
    if (["habilitar", "reativar", "adimplente", "desbloquear", "enable", "unblock", "liberar"].includes(normalizedTipo)) {
      const identifier = idCliente;
      if (!identifier) {
        return new Response(JSON.stringify({ error: "client identifier is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error } = await supabaseAdmin.from("profiles").update({ is_blocked: false, is_active: true }).eq("hubsoft_client_id", identifier);
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

    // Handle "cancelar" / "excluir" / "remover"
    if (["cancelar", "excluir", "remover", "delete", "cancel", "remove"].includes(normalizedTipo)) {
      const identifier = idCliente;
      if (!identifier) {
        return new Response(JSON.stringify({ error: "client identifier is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("user_id")
        .eq("hubsoft_client_id", identifier)
        .single();

      if (profile) {
        await supabaseAdmin.auth.admin.deleteUser(profile.user_id);
      }

      return new Response(JSON.stringify({ success: true, action: "deleted" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Unknown tipo - log it
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
