// Edge function para sincronizar logo URLs após o servidor local baixar/salvar a imagem.
// Recebe uma lista de { channel_number, version } e atualiza logo_url -> /logos/<n>.png?v=<version>
// Autenticação via header X-Sync-Secret (definido via secret SYNC_LOGOS_SECRET).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-secret",
};

interface UpdateItem {
  channel_number: number;
  version: number; // epoch ms
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SYNC_SECRET = Deno.env.get("SYNC_LOGOS_SECRET");
    if (!SYNC_SECRET) {
      return new Response(JSON.stringify({ error: "SYNC_LOGOS_SECRET not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const provided = req.headers.get("x-sync-secret");
    if (provided !== SYNC_SECRET) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    if (req.method === "GET") {
      // Lista canais ativos pro script local saber o que baixar
      const { data, error } = await supabase
        .from("channels")
        .select("id, channel_number, name, logo_url, updated_at")
        .eq("is_active", true)
        .order("channel_number", { ascending: true });

      if (error) throw error;
      return new Response(JSON.stringify({ channels: data ?? [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const updates: UpdateItem[] = Array.isArray(body?.updates) ? body.updates : [];
      if (updates.length === 0) {
        return new Response(JSON.stringify({ updated: 0 }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let updated = 0;
      const errors: string[] = [];
      for (const u of updates) {
        if (typeof u.channel_number !== "number" || typeof u.version !== "number") continue;
        const newUrl = `/logos/${u.channel_number}.png?v=${u.version}`;
        const { error } = await supabase
          .from("channels")
          .update({ logo_url: newUrl })
          .eq("channel_number", u.channel_number);
        if (error) errors.push(`#${u.channel_number}: ${error.message}`);
        else updated++;
      }

      return new Response(JSON.stringify({ updated, errors }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
