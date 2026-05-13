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

    // Run trial expiration sweep before evaluating this event
    try {
      await supabaseAdmin.rpc("expire_trial_access");
    } catch (err) {
      console.warn("expire_trial_access RPC failed (non-fatal):", err);
    }

    // Fetch categories linked to this config (normal + trial)
    const { data: configCategories } = await supabaseAdmin
      .from("hubsoft_config_categories")
      .select("category_id")
      .eq("hubsoft_config_id", config.id);

    const { data: trialConfigCategories } = await supabaseAdmin
      .from("hubsoft_config_trial_categories")
      .select("category_id")
      .eq("hubsoft_config_id", config.id);

    const linkedCategoryIds = configCategories?.map((cc: any) => cc.category_id) || [];
    const trialCategoryIds = trialConfigCategories?.map((cc: any) => cc.category_id) || [];
    const trialEnabled = !!config.trial_enabled && trialCategoryIds.length > 0;
    const trialDays = Math.max(1, Number(config.trial_days) || 30);
    console.log("Config:", config.name, "Linked:", linkedCategoryIds.length, "Trial:", trialEnabled ? `${trialCategoryIds.length}cats/${trialDays}d` : "off");

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

    // Helper: grant category access for a user (applies trial if configured and user is new to this integration)
    async function grantCategoryAccess(userId: string) {
      // Decide whether this user qualifies for trial:
      // qualifies = trial enabled AND user has no prior access record (active or expired) for this config
      let useTrial = false;
      if (trialEnabled) {
        const { data: prior } = await supabaseAdmin
          .from("user_category_access")
          .select("id")
          .eq("user_id", userId)
          .eq("hubsoft_config_id", config.id)
          .limit(1);
        useTrial = !prior || prior.length === 0;
      }

      if (useTrial) {
        const expiresAt = new Date(Date.now() + trialDays * 86400_000).toISOString();
        for (const categoryId of trialCategoryIds) {
          await supabaseAdmin.from("user_category_access").upsert(
            {
              user_id: userId,
              category_id: categoryId,
              hubsoft_config_id: config.id,
              is_active: true,
              is_trial: true,
              trial_expires_at: expiresAt,
            },
            { onConflict: "user_id,category_id" },
          );
        }
        console.log(`Granted TRIAL (${trialCategoryIds.length} cats, ${trialDays}d) to user ${userId}`);
        return;
      }

      if (linkedCategoryIds.length === 0) return;
      for (const categoryId of linkedCategoryIds) {
        await supabaseAdmin.from("user_category_access").upsert(
          {
            user_id: userId,
            category_id: categoryId,
            hubsoft_config_id: config.id,
            is_active: true,
            is_trial: false,
            trial_expires_at: null,
          },
          { onConflict: "user_id,category_id" },
        );
      }
    }

    // Helper: revoke category access for a user (from this config only — both normal and trial)
    async function revokeCategoryAccess(userId: string) {
      await supabaseAdmin.from("user_category_access")
        .delete()
        .eq("user_id", userId)
        .eq("hubsoft_config_id", config.id);
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
          console.log("createUser said 'already exists'. Reconciling auth.users + profile…");

          // 1) Find the auth user by email (paginated)
          let authUserId: string | null = null;
          let page = 1;
          while (page <= 20 && !authUserId) {
            const { data: list, error: listErr } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
            if (listErr) { console.error("listUsers error:", listErr); break; }
            const found = list?.users?.find((u: any) => (u.email || "").toLowerCase() === userEmail.toLowerCase());
            if (found) { authUserId = found.id; break; }
            if (!list?.users || list.users.length < 200) break;
            page++;
          }

          // 2) Try to find an existing profile (by hubsoft_client_id OR username)
          let profileUserId: string | null = null;
          if (idCliente) {
            const { data: p1 } = await supabaseAdmin.from("profiles").select("user_id").eq("hubsoft_client_id", idCliente).maybeSingle();
            if (p1) profileUserId = p1.user_id;
          }
          if (!profileUserId) {
            const { data: p2 } = await supabaseAdmin.from("profiles").select("user_id").eq("username", userEmail).maybeSingle();
            if (p2) profileUserId = p2.user_id;
          }

          // 3) ORPHAN CASES — reconcile
          // 3a) auth exists but profile missing → create profile
          if (authUserId && !profileUserId) {
            console.log("Orphan auth.user without profile — creating profile");
            await supabaseAdmin.from("profiles").insert({
              user_id: authUserId,
              username: userEmail,
              display_name: nome || userEmail,
              hubsoft_client_id: idCliente,
              is_blocked: false,
              is_active: true,
            });
            profileUserId = authUserId;
          }
          // 3b) profile exists but auth missing → delete orphan profile and CREATE the auth user
          if (!authUserId && profileUserId) {
            console.log("Orphan profile without auth.user — deleting orphan and recreating");
            await supabaseAdmin.from("user_category_access").delete().eq("user_id", profileUserId);
            await supabaseAdmin.from("user_roles").delete().eq("user_id", profileUserId);
            await supabaseAdmin.from("user_favorites").delete().eq("user_id", profileUserId);
            await supabaseAdmin.from("user_sessions").delete().eq("user_id", profileUserId);
            await supabaseAdmin.from("profiles").delete().eq("user_id", profileUserId);
            profileUserId = null;

            const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
              email: userEmail, password: userPassword, email_confirm: true,
              user_metadata: { display_name: nome || userEmail },
            });
            if (createErr || !created?.user) {
              console.error("Recreate failed:", createErr);
              return new Response(JSON.stringify({ error: `recreate failed: ${createErr?.message}` }), {
                status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }
            authUserId = created.user.id;
            // Ensure profile (handle_new_user trigger should create it; upsert hubsoft data anyway)
            await supabaseAdmin.from("profiles").upsert({
              user_id: authUserId,
              username: userEmail,
              display_name: nome || userEmail,
              hubsoft_client_id: idCliente,
              is_blocked: false,
              is_active: true,
            }, { onConflict: "user_id" });
            profileUserId = authUserId;
          }

          // 4) Both exist → reset password (in case ERP CPF changed) + reactivate
          if (authUserId && profileUserId) {
            await supabaseAdmin.auth.admin.updateUserById(authUserId, { password: userPassword });
            const profileUpdate: Record<string, unknown> = { is_blocked: false, is_active: true };
            if (idCliente) profileUpdate.hubsoft_client_id = idCliente;
            if (nome) profileUpdate.display_name = nome;
            await supabaseAdmin.from("profiles").update(profileUpdate).eq("user_id", profileUserId);
            await grantCategoryAccess(profileUserId);
            return new Response(JSON.stringify({ success: true, message: "User reactivated", login: userEmail, senha: userPassword }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // 5) Neither exists yet — fall through and try createUser again (rare race)
          console.warn("Reconcile reached fallthrough without authUserId — returning error");
          return new Response(JSON.stringify({ error: "Could not reconcile user state", login: userEmail }), {
            status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
          await supabaseAdmin.from("profiles")
            .update({ is_blocked: true, force_signout_at: new Date().toISOString() })
            .eq("user_id", profile.user_id);
          blocked.push(profile.user_id);
        } else {
          // Mesmo mantendo acesso por outra config, força re-checagem da sessão
          await supabaseAdmin.from("profiles")
            .update({ force_signout_at: new Date().toISOString() })
            .eq("user_id", profile.user_id);
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
          // Força signout da sessão ativa antes de deletar
          await supabaseAdmin.from("profiles")
            .update({ force_signout_at: new Date().toISOString() })
            .eq("user_id", profile.user_id);

          // Limpa todas as tabelas públicas relacionadas (não há FK cascade)
          for (const table of ["user_category_access", "user_roles", "user_sessions", "user_favorites", "profiles"]) {
            const { error: cleanupErr } = await supabaseAdmin.from(table).delete().eq("user_id", profile.user_id);
            if (cleanupErr) console.error(`cleanup ${table} failed:`, cleanupErr);
          }

          const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(profile.user_id);
          if (delErr && !String(delErr.message || "").toLowerCase().includes("not found")) {
            console.error("deleteUser error:", profile.user_id, delErr);
            errors.push({ user_id: profile.user_id, error: delErr.message });
          } else {
            console.log("User fully deleted:", profile.user_id);
            deleted.push(profile.user_id);
          }
        } else {
          // Mantido em outra config — força re-login mesmo assim
          await supabaseAdmin.from("profiles")
            .update({ force_signout_at: new Date().toISOString() })
            .eq("user_id", profile.user_id);
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
