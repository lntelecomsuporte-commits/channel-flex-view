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

async function fetchOnce(url: string, browserLike = false): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const headers: Record<string, string> = browserLike
      ? {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
          Accept: "*/*",
          "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        }
      : {
          "User-Agent": "Mozilla/5.0 (compatible; LNTV-EPG/1.0)",
          Accept: "application/xml, text/xml, */*",
        };
    const res = await fetch(url, { signal: controller.signal, headers, redirect: "follow" });
    clearTimeout(timeout);
    if (!res.ok) {
      console.error(`EPG fetch ${res.status} ${res.statusText} for ${url}`);
      return null;
    }
    return await res.text();
  } catch (e) {
    clearTimeout(timeout);
    console.error("EPG fetch error:", e);
    return null;
  }
}

async function getRawXml(url: string, fresh = false): Promise<{ text: string; status: number } | null> {
  const cached = rawCache.get(url);
  if (!fresh && cached && Date.now() - cached.fetchedAt < RAW_TTL_MS) {
    return { text: cached.text, status: 200 };
  }

  // 1ª tentativa — UA "bot"
  let text = await fetchOnce(url, false);

  // Se vier algo que não é XMLTV (open-epg às vezes devolve HTML de limite/anti-bot),
  // tenta novamente com UA de browser real após pequeno delay.
  if (!text || !looksLikeXmltv(text)) {
    if (text) console.error(`EPG resposta não-XMLTV (1ª) para ${url} — primeiros 200: ${text.slice(0, 200)}`);
    await new Promise((r) => setTimeout(r, 600));
    text = await fetchOnce(url, true);
  }

  if (!text || !looksLikeXmltv(text)) {
    if (text) console.error(`EPG resposta não-XMLTV (2ª) para ${url} — primeiros 200: ${text.slice(0, 200)}`);
    if (cached) return { text: cached.text, status: 200 };
    return null;
  }

  rawCache.set(url, { text, fetchedAt: Date.now() });
  return { text, status: 200 };
}

/**
 * Filtra XML XMLTV mantendo apenas <channel id=...> e <programme channel=...>
 * cujos IDs estejam em `wanted`. Usa scan por regex (mais leve que DOM em Deno
 * para arquivos grandes) e preserva o XML original dos elementos selecionados.
 */
function filterXmltv(text: string, wanted: Set<string>): string {
  // Normaliza para matching tolerante (lowercase). Mantemos também o set original
  // para match exato, que é mais rápido e cobre 99% dos casos.
  const wantedLower = new Set<string>();
  wanted.forEach((id) => wantedLower.add(id.toLowerCase()));

  const matches = (id: string) => {
    if (wanted.has(id)) return true;
    return wantedLower.has(id.toLowerCase());
  };

  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', "<tv>"];

  // <channel id="..."> ... </channel>
  const channelRe = /<channel\b[^>]*\bid\s*=\s*"([^"]+)"[^>]*>[\s\S]*?<\/channel>/g;
  let m: RegExpExecArray | null;
  while ((m = channelRe.exec(text)) !== null) {
    if (matches(m[1])) out.push(m[0]);
  }

  // <programme ... channel="..." ...> ... </programme>
  const progRe = /<programme\b[^>]*\bchannel\s*=\s*"([^"]+)"[^>]*>[\s\S]*?<\/programme>/g;
  while ((m = progRe.exec(text)) !== null) {
    if (matches(m[1])) out.push(m[0]);
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
  const fresh = url.searchParams.get("fresh") === "1";

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
