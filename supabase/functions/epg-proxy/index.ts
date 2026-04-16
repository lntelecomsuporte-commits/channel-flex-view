import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const xmlUrl = url.searchParams.get("url");

  if (!xmlUrl) {
    return new Response(JSON.stringify({ error: "Missing url parameter" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const emptyXml = '<?xml version="1.0" encoding="UTF-8"?><tv></tv>';

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    const res = await fetch(xmlUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LNTV-EPG/1.0)",
        Accept: "application/xml, text/xml, */*",
      },
      redirect: "follow",
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.error(`EPG fetch failed: ${res.status} ${res.statusText} for ${xmlUrl}`);
      return new Response(emptyXml, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/xml", "X-EPG-Error": String(res.status) },
      });
    }

    const text = await res.text();
    return new Response(text, {
      headers: { ...corsHeaders, "Content-Type": "application/xml" },
    });
  } catch (e) {
    console.error("EPG proxy error:", e);
    return new Response(emptyXml, {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/xml", "X-EPG-Error": "fetch_failed" },
    });
  }
});
