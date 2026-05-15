// Gera playlist M3U pro cliente com URLs hls-proxy assinadas.
// Auth: ?token=<playlist_token>  OU  ?u=<email>&p=<playlist_password>
// Sempre retorna text/plain (M3U). O parâmetro ?type controla rotulagem (m3u/hls).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECRET = Deno.env.get("STREAM_TOKEN_SECRET") ?? "";

// TTL longo (30 dias) — apps M3U guardam o playlist e re-baixam só quando o usuário pede.
const TTL_SECONDS = 30 * 24 * 60 * 60;

// Origem pública pro hls-proxy (mesmo domínio do site, NUNCA *.supabase.co)
const PROXY_ORIGIN = Deno.env.get("LNTV_PUBLIC_ORIGIN") ?? "https://tv2.lntelecom.net";

const toBase64Url = (bytes: ArrayBuffer): string => {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

let signKeyPromise: Promise<CryptoKey> | null = null;
const getSignKey = (): Promise<CryptoKey> => {
  if (!signKeyPromise) {
    signKeyPromise = crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
  }
  return signKeyPromise;
};

const sign = async (payload: string): Promise<string> => {
  const key = await getSignKey();
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return toBase64Url(sig);
};

const escAttr = (s: string) => (s ?? "").replace(/"/g, "'").replace(/[\r\n,]/g, " ");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (!SECRET) {
    return new Response("Server misconfigured", { status: 500, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? url.searchParams.get("t");
  const u = url.searchParams.get("u") ?? url.searchParams.get("username");
  const p = url.searchParams.get("p") ?? url.searchParams.get("password");
  const type = (url.searchParams.get("type") ?? "m3u").toLowerCase();

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Lookup do profile por token OU user+senha
  let profileQuery = admin
    .from("profiles")
    .select("user_id, username, is_blocked, is_active, playlist_token, playlist_password");

  if (token) {
    profileQuery = profileQuery.eq("playlist_token", token);
  } else if (u && p) {
    profileQuery = profileQuery.eq("username", u).eq("playlist_password", p);
  } else {
    return new Response("Missing credentials. Use ?token=... or ?u=...&p=...", {
      status: 400,
      headers: corsHeaders,
    });
  }

  const { data: profiles, error: profErr } = await profileQuery.limit(1);
  if (profErr || !profiles || profiles.length === 0) {
    return new Response("Invalid credentials", { status: 401, headers: corsHeaders });
  }
  const profile = profiles[0];
  if (profile.is_blocked || !profile.is_active) {
    return new Response("Account blocked", { status: 403, headers: corsHeaders });
  }

  // Resolve categorias liberadas (acesso direto + inclusões hierárquicas, respeitando trial)
  const [accessRes, includesRes, channelsRes] = await Promise.all([
    admin
      .from("user_category_access")
      .select("category_id, is_trial, trial_expires_at")
      .eq("user_id", profile.user_id)
      .eq("is_active", true),
    admin.from("category_includes").select("category_id, included_category_id"),
    admin
      .from("channels")
      .select("id, name, channel_number, logo_url, category_id, is_adult, epg_channel_id")
      .eq("is_active", true)
      .order("channel_number", { ascending: true }),
  ]);

  if (accessRes.error || includesRes.error || channelsRes.error) {
    return new Response("Database error", { status: 500, headers: corsHeaders });
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const allowed = new Set<string>();
  for (const row of accessRes.data ?? []) {
    if (row.is_trial && row.trial_expires_at) {
      const exp = Math.floor(new Date(row.trial_expires_at).getTime() / 1000);
      if (exp < nowSec) continue;
    }
    allowed.add(row.category_id);
  }
  // Expansão recursiva
  let changed = true;
  while (changed) {
    changed = false;
    for (const rel of includesRes.data ?? []) {
      if (allowed.has(rel.category_id) && !allowed.has(rel.included_category_id)) {
        allowed.add(rel.included_category_id);
        changed = true;
      }
    }
  }

  // Categorias name lookup pra group-title
  const { data: cats } = await admin.from("categories").select("id, name");
  const catName = new Map<string, string>((cats ?? []).map((c: { id: string; name: string }) => [c.id, c.name]));

  // Token de stream comum: TTL longo, escopo por user + canal
  const exp = nowSec + TTL_SECONDS;

  const lines: string[] = ["#EXTM3U"];
  for (const ch of channelsRes.data ?? []) {
    if (!ch.category_id || !allowed.has(ch.category_id)) continue;
    const st = await sign(`${profile.user_id}.${ch.id}.${exp}`);
    const proxyUrl =
      `${PROXY_ORIGIN}/functions/v1/hls-proxy` +
      `?ch=${encodeURIComponent(ch.id)}` +
      `&uid=${encodeURIComponent(profile.user_id)}` +
      `&exp=${exp}` +
      `&st=${st}`;

    const tvgId = ch.epg_channel_id ? ` tvg-id="${escAttr(ch.epg_channel_id)}"` : "";
    const tvgLogo = ch.logo_url ? ` tvg-logo="${escAttr(ch.logo_url)}"` : "";
    const tvgChno = ch.channel_number != null ? ` tvg-chno="${ch.channel_number}"` : "";
    const grp = ch.category_id ? ` group-title="${escAttr(catName.get(ch.category_id) ?? "")}"` : "";
    lines.push(`#EXTINF:-1${tvgId}${tvgLogo}${tvgChno}${grp},${escAttr(ch.name)}`);
    lines.push(proxyUrl);
  }

  const filename = type === "hls" ? "lntv.hls.m3u" : "lntv.m3u";
  return new Response(lines.join("\n") + "\n", {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/x-mpegurl; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
});
