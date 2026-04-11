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
    const { action, email, password, display_name, hubsoft_client_id } = body;

    console.log("Hubsoft webhook received:", { action, email, hubsoft_client_id });

    if (!action) {
      return new Response(JSON.stringify({ error: "action is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "create") {
      if (!email || !password) {
        return new Response(JSON.stringify({ error: "email and password are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: display_name || email },
      });

      if (error) {
        console.error("Error creating user:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Update profile with hubsoft_client_id
      if (hubsoft_client_id) {
        await supabaseAdmin.from("profiles").update({ hubsoft_client_id }).eq("user_id", data.user.id);
      }

      return new Response(JSON.stringify({ success: true, user_id: data.user.id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "block" || action === "unblock") {
      const identifier = hubsoft_client_id || email;
      if (!identifier) {
        return new Response(JSON.stringify({ error: "hubsoft_client_id or email is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      let query = supabaseAdmin.from("profiles").update({ is_blocked: action === "block" });
      if (hubsoft_client_id) {
        query = query.eq("hubsoft_client_id", hubsoft_client_id);
      } else {
        query = query.eq("username", email);
      }

      const { error } = await query;
      if (error) {
        console.error("Error updating profile:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "delete") {
      const identifier = hubsoft_client_id || email;
      if (!identifier) {
        return new Response(JSON.stringify({ error: "hubsoft_client_id or email is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Find profile
      let profileQuery = supabaseAdmin.from("profiles").select("user_id");
      if (hubsoft_client_id) {
        profileQuery = profileQuery.eq("hubsoft_client_id", hubsoft_client_id);
      } else {
        profileQuery = profileQuery.eq("username", email);
      }

      const { data: profile } = await profileQuery.single();
      if (profile) {
        await supabaseAdmin.auth.admin.deleteUser(profile.user_id);
      }

      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Webhook error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
