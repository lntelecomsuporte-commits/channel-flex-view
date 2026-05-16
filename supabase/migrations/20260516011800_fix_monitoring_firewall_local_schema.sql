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
  SELECT
    COUNT(DISTINCT COALESCE(
      NULLIF(client_ipv4, ''),
      NULLIF(client_ipv6, ''),
      NULLIF(CASE
        WHEN ip_address IN ('127.0.0.1', '::1') THEN NULL
        WHEN ip_address LIKE '10.%' THEN NULL
        WHEN ip_address LIKE '192.168.%' THEN NULL
        WHEN ip_address ~ '^172\\.(1[6-9]|2[0-9]|3[0-1])\\.' THEN NULL
        ELSE ip_address
      END, '')
    ))::int AS unique_ips,
    COUNT(DISTINCT user_id)::int AS unique_users,
    COUNT(*)::int AS total_sessions
  FROM public.user_sessions
  WHERE last_heartbeat_at >= now() - interval '30 days'
    AND public.has_role(auth.uid(), 'admin'::app_role);
$$;

REVOKE ALL ON FUNCTION public.get_monitoring_stats_30d() FROM public;
GRANT EXECUTE ON FUNCTION public.get_monitoring_stats_30d() TO authenticated;

NOTIFY pgrst, 'reload schema';
