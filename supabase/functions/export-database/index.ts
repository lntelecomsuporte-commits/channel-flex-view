// Export database to SQL dump (admin only)
// Returns a downloadable .sql file with schema + data from public + auth.users
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function esc(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (typeof v === "object") {
    return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  }
  const s = String(v).replace(/'/g, "''");
  return `'${s}'`;
}

function toInsert(table: string, rows: any[], schema = "public"): string {
  if (!rows || rows.length === 0) return `-- ${schema}.${table}: 0 rows\n`;
  const cols = Object.keys(rows[0]);
  const colList = cols.map((c) => `"${c}"`).join(", ");
  const lines = rows.map(
    (r) => `(${cols.map((c) => esc(r[c])).join(", ")})`,
  );
  return `-- ${schema}.${table}: ${rows.length} rows\nINSERT INTO ${schema}.${table} (${colList}) VALUES\n${lines.join(",\n")}\nON CONFLICT DO NOTHING;\n\n`;
}

function omitColumns(rows: any[], columns: string[]): any[] {
  const blocked = new Set(columns);
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).filter(([key]) => !blocked.has(key)),
    ),
  );
}

function schemaSql(): string {
  return `-- ============================================
-- PUBLIC SCHEMA STRUCTURE
-- ============================================

CREATE SCHEMA IF NOT EXISTS public;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typname = 'app_role') THEN
    CREATE TYPE public.app_role AS ENUM ('admin', 'user');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.category_includes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL,
  included_category_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  channel_number integer NOT NULL,
  stream_url text NOT NULL,
  logo_url text,
  category_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  epg_url text,
  epg_type text,
  epg_channel_id text,
  epg_alt_text text,
  epg_grab_logo boolean NOT NULL DEFAULT false,
  epg_show_synopsis boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.hubsoft_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT 'Integração Principal',
  api_url text NOT NULL DEFAULT '',
  username text NOT NULL DEFAULT '',
  password text NOT NULL DEFAULT '',
  api_key text NOT NULL DEFAULT '',
  package_id text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.hubsoft_config_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hubsoft_config_id uuid NOT NULL,
  category_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  username text,
  display_name text,
  is_active boolean NOT NULL DEFAULT true,
  is_blocked boolean NOT NULL DEFAULT false,
  hubsoft_client_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.proxy_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address text NOT NULL,
  user_id uuid,
  channel_id uuid,
  channel_name text,
  stream_host text,
  request_count integer NOT NULL DEFAULT 1,
  bytes_transferred bigint NOT NULL DEFAULT 0,
  bucket_minute timestamptz NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);

CREATE TABLE IF NOT EXISTS public.user_category_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  category_id uuid NOT NULL,
  hubsoft_config_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  channel_id uuid NOT NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  session_token text NOT NULL,
  user_agent text,
  ip_address text,
  client_ipv4 text,
  client_ipv6 text,
  current_channel_id uuid,
  current_channel_name text,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  is_watching boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.cleanup_old_monitoring_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.user_sessions WHERE created_at < now() - interval '30 days';
  DELETE FROM public.proxy_access_log WHERE created_at < now() - interval '30 days';
  UPDATE public.user_sessions
  SET ended_at = last_heartbeat_at
  WHERE ended_at IS NULL AND last_heartbeat_at < now() - interval '5 minutes';
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_online_status(_user_id uuid)
RETURNS TABLE(is_logged_in boolean, is_watching boolean, current_channel_name text, last_seen timestamptz, session_started_at timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    EXISTS(SELECT 1 FROM public.user_sessions WHERE user_id = _user_id AND ended_at IS NULL AND last_heartbeat_at > now() - interval '90 seconds') AS is_logged_in,
    EXISTS(SELECT 1 FROM public.user_sessions WHERE user_id = _user_id AND ended_at IS NULL AND is_watching = true AND last_heartbeat_at > now() - interval '90 seconds') AS is_watching,
    (SELECT current_channel_name FROM public.user_sessions WHERE user_id = _user_id AND ended_at IS NULL ORDER BY last_heartbeat_at DESC LIMIT 1) AS current_channel_name,
    (SELECT last_heartbeat_at FROM public.user_sessions WHERE user_id = _user_id ORDER BY last_heartbeat_at DESC LIMIT 1) AS last_seen,
    (SELECT started_at FROM public.user_sessions WHERE user_id = _user_id AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1) AS session_started_at;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, username, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category_includes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hubsoft_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hubsoft_config_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proxy_access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_category_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage categories" ON public.categories;
CREATE POLICY "Admins can manage categories" ON public.categories FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
DROP POLICY IF EXISTS "Anyone can view categories" ON public.categories;
CREATE POLICY "Anyone can view categories" ON public.categories FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "Admins can manage category includes" ON public.category_includes;
CREATE POLICY "Admins can manage category includes" ON public.category_includes FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
DROP POLICY IF EXISTS "Anyone can view category includes" ON public.category_includes;
CREATE POLICY "Anyone can view category includes" ON public.category_includes FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "Admins can manage channels" ON public.channels;
CREATE POLICY "Admins can manage channels" ON public.channels FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
DROP POLICY IF EXISTS "Anyone can view active channels" ON public.channels;
CREATE POLICY "Anyone can view active channels" ON public.channels FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "Admins can manage hubsoft config" ON public.hubsoft_config;
CREATE POLICY "Admins can manage hubsoft config" ON public.hubsoft_config FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can manage hubsoft config categories" ON public.hubsoft_config_categories;
CREATE POLICY "Admins can manage hubsoft config categories" ON public.hubsoft_config_categories FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can manage profiles" ON public.profiles;
CREATE POLICY "Admins can manage profiles" ON public.profiles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view proxy log" ON public.proxy_access_log;
CREATE POLICY "Admins can view proxy log" ON public.proxy_access_log FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can view roles" ON public.user_roles;
CREATE POLICY "Admins can view roles" ON public.user_roles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can manage user category access" ON public.user_category_access;
CREATE POLICY "Admins can manage user category access" ON public.user_category_access FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
DROP POLICY IF EXISTS "Users can view own category access" ON public.user_category_access;
CREATE POLICY "Users can view own category access" ON public.user_category_access FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view all favorites" ON public.user_favorites;
CREATE POLICY "Admins can view all favorites" ON public.user_favorites FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));
DROP POLICY IF EXISTS "Users can view own favorites" ON public.user_favorites;
CREATE POLICY "Users can view own favorites" ON public.user_favorites FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own favorites" ON public.user_favorites;
CREATE POLICY "Users can insert own favorites" ON public.user_favorites FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own favorites" ON public.user_favorites;
CREATE POLICY "Users can update own favorites" ON public.user_favorites FOR UPDATE TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own favorites" ON public.user_favorites;
CREATE POLICY "Users can delete own favorites" ON public.user_favorites FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view all sessions" ON public.user_sessions;
CREATE POLICY "Admins can view all sessions" ON public.user_sessions FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));
DROP POLICY IF EXISTS "Users can view own sessions" ON public.user_sessions;
CREATE POLICY "Users can view own sessions" ON public.user_sessions FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own sessions" ON public.user_sessions;
CREATE POLICY "Users can insert own sessions" ON public.user_sessions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own sessions" ON public.user_sessions;
CREATE POLICY "Users can update own sessions" ON public.user_sessions FOR UPDATE TO authenticated USING (auth.uid() = user_id);

`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify caller is admin
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) {
      return new Response(JSON.stringify({ error: "Forbidden: admin only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Tables in dependency order (parents first)
    const publicTables = [
      "categories",
      "category_includes",
      "channels",
      "hubsoft_config",
      "hubsoft_config_categories",
      "profiles",
      "user_roles",
      "user_category_access",
      "user_favorites",
      // skipping high-volume ephemeral: proxy_access_log, user_sessions
    ];

    let sql = "";
    sql += `-- LN TV Database Export\n`;
    sql += `-- Generated: ${new Date().toISOString()}\n`;
    sql += `-- Source project: ${SUPABASE_URL}\n\n`;
    sql += `BEGIN;\n\n`;
    sql += schemaSql();
    sql += `SET session_replication_role = 'replica';\n\n`;

    // ---------- AUTH USERS ----------
    sql += `-- ============================================\n`;
    sql += `-- AUTH USERS (with password hashes)\n`;
    sql += `-- ============================================\n\n`;

    const { data: usersList, error: usersErr } =
      await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (usersErr) throw usersErr;

    const users = usersList.users;
    sql += `-- ${users.length} users found\n\n`;

    // Direct SQL insert using service role (read raw auth.users)
    // We need the encrypted_password — admin.listUsers() doesn't return it.
    // Use rpc or direct query via PostgREST is not possible for auth schema.
    // Workaround: query via a SECURITY DEFINER function we'll add inline.
    const { data: rawUsers, error: rawErr } = await admin.rpc(
      "export_auth_users" as any,
    );

    if (rawErr) {
      sql += `-- WARNING: could not export password hashes. Run this migration first:\n`;
      sql += `-- CREATE OR REPLACE FUNCTION public.export_auth_users() RETURNS SETOF auth.users LANGUAGE sql SECURITY DEFINER SET search_path = auth, public AS $$ SELECT * FROM auth.users $$;\n`;
      sql += `-- Falling back to user metadata only (passwords will need reset)\n\n`;
      for (const u of users) {
        sql += `-- User: ${u.email}\n`;
        sql += `INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at, aud, role)\n`;
        sql += `VALUES (${esc(u.id)}, ${esc(u.email)}, ${esc(u.email_confirmed_at)}, ${esc(u.user_metadata ?? {})}, ${esc(u.app_metadata ?? {})}, ${esc(u.created_at)}, ${esc(u.updated_at)}, 'authenticated', 'authenticated')\n`;
        sql += `ON CONFLICT (id) DO NOTHING;\n\n`;
      }
    } else {
      const rows = (rawUsers as any[]) ?? [];
      sql += `-- Full auth.users export (${rows.length} rows, with password hashes)\n`;
      sql += toInsert("users", omitColumns(rows, ["confirmed_at"]), "auth");
    }

    // identities
    const { data: identities } = await admin.rpc(
      "export_auth_identities" as any,
    );
    if (identities) {
      sql += toInsert(
        "identities",
        omitColumns(identities as any[], ["email"]),
        "auth",
      );
    }

    // ---------- PUBLIC SCHEMA ----------
    sql += `-- ============================================\n`;
    sql += `-- PUBLIC SCHEMA DATA\n`;
    sql += `-- ============================================\n\n`;

    for (const table of publicTables) {
      const { data, error } = await admin.from(table).select("*");
      if (error) {
        sql += `-- ERROR exporting ${table}: ${error.message}\n\n`;
        continue;
      }
      sql += toInsert(table, data ?? []);
    }

    sql += `\nSET session_replication_role = 'origin';\n`;
    sql += `COMMIT;\n`;
    sql += `\n-- End of dump\n`;

    return new Response(sql, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/sql; charset=utf-8",
        "Content-Disposition": `attachment; filename="lntv-dump-${new Date().toISOString().slice(0, 10)}.sql"`,
      },
    });
  } catch (e) {
    console.error("export-database error:", e);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
