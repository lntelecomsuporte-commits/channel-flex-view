-- Helper functions to export auth schema for backup/migration purposes
-- Only callable by service_role (admin)

CREATE OR REPLACE FUNCTION public.export_auth_users()
RETURNS SETOF auth.users
LANGUAGE sql
SECURITY DEFINER
SET search_path = auth, public
AS $$
  SELECT * FROM auth.users;
$$;

CREATE OR REPLACE FUNCTION public.export_auth_identities()
RETURNS SETOF auth.identities
LANGUAGE sql
SECURITY DEFINER
SET search_path = auth, public
AS $$
  SELECT * FROM auth.identities;
$$;

-- Revoke from public, only service_role can execute
REVOKE EXECUTE ON FUNCTION public.export_auth_users() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.export_auth_identities() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.export_auth_users() TO service_role;
GRANT EXECUTE ON FUNCTION public.export_auth_identities() TO service_role;