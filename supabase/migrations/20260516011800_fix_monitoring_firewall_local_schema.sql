ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS requires_pin boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.firewall_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL CHECK (action IN ('deny','allow')),
  target text NOT NULL,
  note text,
  is_active boolean NOT NULL DEFAULT true,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (action, target)
);

ALTER TABLE public.firewall_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage firewall rules" ON public.firewall_rules;
CREATE POLICY "Admins can manage firewall rules"
  ON public.firewall_rules
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.get_monitoring_stats_30d()
RETURNS TABLE(unique_ips integer, unique_users integer, total_sessions integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH recent_sessions AS (
    SELECT user_id, client_ipv4, client_ipv6, ip_address
    FROM public.user_sessions
    WHERE last_heartbeat_at >= now() - interval '30 days'
      AND public.has_role(auth.uid(), 'admin'::app_role)
  ), routable_ips AS (
    SELECT NULLIF(client_ipv4, '') AS ip FROM recent_sessions
    UNION ALL SELECT NULLIF(client_ipv6, '') FROM recent_sessions
    UNION ALL SELECT NULLIF(ip_address, '') FROM recent_sessions
  )
  SELECT
    COUNT(DISTINCT ip) FILTER (
      WHERE ip IS NOT NULL
        AND ip NOT IN ('127.0.0.1', '::1')
        AND ip NOT LIKE '10.%'
        AND ip NOT LIKE '192.168.%'
        AND ip !~ '^172\\.(1[6-9]|2[0-9]|3[0-1])\\.'
        AND lower(ip) NOT LIKE 'fe80:%'
    )::int AS unique_ips,
    (SELECT COUNT(DISTINCT user_id)::int FROM recent_sessions) AS unique_users,
    (SELECT COUNT(*)::int FROM recent_sessions) AS total_sessions
  FROM routable_ips;
$$;

REVOKE ALL ON FUNCTION public.get_monitoring_stats_30d() FROM public;
GRANT EXECUTE ON FUNCTION public.get_monitoring_stats_30d() TO authenticated;

NOTIFY pgrst, 'reload schema';
