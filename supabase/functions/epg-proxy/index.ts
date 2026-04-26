import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const emptyXml = '<?xml version="1.0" encoding="UTF-8"?><tv></tv>';

// Cache em memória do XML bruto por URL (sobrevive entre invocações enquanto a
// instância da edge function estiver quente). Reduz drasticamente downloads
// repetidos de arquivos EPG grandes (dezenas de MB).
const RAW_TTL_MS = 10 * 60 * 1000; // 10 min
const rawCache = new Map<string, { text: string; fetchedAt: number }>();

// Cache de respostas já filtradas (URL + conjunto de canais ordenado)
const FILTERED_TTL_MS = 10 * 60 * 1000;
const filteredCache = new Map<string, { xml: string; fetchedAt: number }>();

function looksLikeXmltv(text: string): boolean {
  if (!text || text.length < 20) return false;
  // Sample only the first KB — XMLTV files podem ter dezenas de MB
  const head = text.slice(0, 2048).toLowerCase();
  // Tem que ter <tv ou <channel ou <programme. Rejeita HTML de erro
  // (<!doctype html>, <span ...>You reached the download limit..., etc).
  if (head.includes("<!doctype html") || head.includes("<html")) return false;
  if (/^\s*<span/i.test(text)) return false;
  return head.includes("<tv") || head.includes("<channel") || head.includes("<programme");
}

async function getRawXml(url: string): Promise<{ text: string; status: number } | null> {
  const cached = rawCache.get(url);
  if (cached && Date.now() - cached.fetchedAt < RAW_TTL_MS) {
    return { text: cached.text, status: 200 };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LNTV-EPG/1.0)",
        Accept: "application/xml, text/xml, */*",
      },
      redirect: "follow",
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.error(`EPG fetch failed: ${res.status} ${res.statusText} for ${url}`);
      // Se temos um cache antigo válido, devolve mesmo expirado em vez de erro
      if (cached) return { text: cached.text, status: 200 };
      return null;
    }
    const text = await res.text();

    // Recusa cachear respostas que não são XMLTV (ex.: HTML de "limite atingido"
    // do open-epg.com). Sem isso, ficamos com lixo cacheado por 10 min e o
    // filtro devolve <tv></tv> vazio para todos os canais daquela URL.
    if (!looksLikeXmltv(text)) {
      console.error(`EPG response is not XMLTV for ${url} — not caching. First 200 chars: ${text.slice(0, 200)}`);
      if (cached) return { text: cached.text, status: 200 };
      return null;
    }

    rawCache.set(url, { text, fetchedAt: Date.now() });
    return { text, status: 200 };
  } catch (e) {
    clearTimeout(timeout);
    console.error("EPG fetch error:", e);
    if (cached) return { text: cached.text, status: 200 };
    return null;
  }
}

/**
 * Filtra XML XMLTV mantendo apenas <channel id=...> e <programme channel=...>
 * cujos IDs estejam em `wanted`. Usa scan por regex (mais leve que DOM em Deno
 * para arquivos grandes) e preserva o XML original dos elementos selecionados.
 */
function filterXmltv(text: string, wanted: Set<string>): string {
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', "<tv>"];

  // <channel id="..."> ... </channel>
  const channelRe = /<channel\b[^>]*\bid\s*=\s*"([^"]+)"[^>]*>[\s\S]*?<\/channel>/g;
  let m: RegExpExecArray | null;
  while ((m = channelRe.exec(text)) !== null) {
    if (wanted.has(m[1])) out.push(m[0]);
  }

  // <programme ... channel="..." ...> ... </programme>
  // Também aceita <programme channel="..." .../> (raro). Cobrimos o caso comum.
  const progRe = /<programme\b[^>]*\bchannel\s*=\s*"([^"]+)"[^>]*>[\s\S]*?<\/programme>/g;
  while ((m = progRe.exec(text)) !== null) {
    if (wanted.has(m[1])) out.push(m[0]);
  }

  out.push("</tv>");
  return out.join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const xmlUrl = url.searchParams.get("url");
  const channelsParam = url.searchParams.get("channels"); // "id1,id2,id3"

  if (!xmlUrl) {
    return new Response(JSON.stringify({ error: "Missing url parameter" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Modo filtrado — cache por (URL, conjunto ordenado de canais)
    if (channelsParam) {
      const ids = channelsParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (ids.length === 0) {
        return new Response(emptyXml, {
          headers: { ...corsHeaders, "Content-Type": "application/xml" },
        });
      }
      const sortedIds = [...ids].sort();
      const cacheKey = `${xmlUrl}::${sortedIds.join(",")}`;
      const hit = filteredCache.get(cacheKey);
      if (hit && Date.now() - hit.fetchedAt < FILTERED_TTL_MS) {
        return new Response(hit.xml, {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/xml",
            "X-EPG-Cache": "hit",
          },
        });
      }

      const raw = await getRawXml(xmlUrl);
      if (!raw) {
        return new Response(emptyXml, {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/xml", "X-EPG-Error": "fetch_failed" },
        });
      }
      const filtered = filterXmltv(raw.text, new Set(sortedIds));
      filteredCache.set(cacheKey, { xml: filtered, fetchedAt: Date.now() });
      return new Response(filtered, {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/xml",
          "X-EPG-Cache": "miss",
          "X-EPG-Filtered": String(sortedIds.length),
        },
      });
    }

    // Modo legado — devolve XML completo (mantém compatibilidade)
    const raw = await getRawXml(xmlUrl);
    if (!raw) {
      return new Response(emptyXml, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/xml", "X-EPG-Error": "fetch_failed" },
      });
    }
    return new Response(raw.text, {
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
