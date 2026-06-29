// Resolve um slug curto e redireciona pra URL original (encurtador de M3U).
// GET /functions/v1/s?c=<slug>   OU   /functions/v1/s/<slug>

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const REST_BASES = [
  Deno.env.get("LNTV_SUPABASE_INTERNAL_URL")?.replace(/\/$/, ""),
  "http://kong:8000",
  SUPABASE_URL,
].filter((v, i, a): v is string => Boolean(v) && a.indexOf(v) === i);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
};

async function fetchTarget(slug: string): Promise<string | null> {
  for (const base of REST_BASES) {
    try {
      const url = new URL(`${base}/rest/v1/short_links`);
      url.searchParams.set("select", "target_url");
      url.searchParams.set("slug", `eq.${slug}`);
      url.searchParams.set("limit", "1");
      const res = await fetch(url, {
        headers: {
          apikey: SERVICE_ROLE_KEY,
          authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          accept: "application/json",
        },
      });
      if (!res.ok) continue;
      const rows = await res.json() as { target_url: string }[];
      if (rows.length > 0) return rows[0].target_url;
      return null;
    } catch (e) {
      console.error("[s] lookup failed", base, e);
    }
  }
  return null;
}

async function bumpHit(slug: string) {
  for (const base of REST_BASES) {
    try {
      const url = new URL(`${base}/rest/v1/rpc/short_link_hit`);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          apikey: SERVICE_ROLE_KEY,
          authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ _slug: slug }),
      });
      if (res.ok) return;
    } catch { /* ignore */ }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const url = new URL(req.url);
  let slug = url.searchParams.get("c") ?? url.searchParams.get("slug") ?? "";
  if (!slug) {
    const parts = url.pathname.split("/").filter(Boolean);
    slug = parts[parts.length - 1] ?? "";
    if (slug === "s") slug = "";
  }
  if (!slug || !/^[A-Za-z0-9_-]{3,32}$/.test(slug)) {
    return new Response("Link inválido", { status: 400, headers: corsHeaders });
  }
  const target = await fetchTarget(slug);
  if (!target) return new Response("Link não encontrado", { status: 404, headers: corsHeaders });
  // best-effort counter
  bumpHit(slug).catch(() => {});
  return new Response(null, {
    status: 302,
    headers: { ...corsHeaders, Location: target, "Cache-Control": "no-store" },
  });
});
