CREATE OR REPLACE FUNCTION public.get_monitoring_stats_30d()
RETURNS TABLE(unique_ips integer, unique_users integer, total_sessions integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COUNT(DISTINCT COALESCE(NULLIF(client_ipv4, ''), NULLIF(client_ipv6, ''), NULLIF(ip_address, '')))::int AS unique_ips,
    COUNT(DISTINCT user_id)::int AS unique_users,
    COUNT(*)::int AS total_sessions
  FROM public.user_sessions
  WHERE last_heartbeat_at >= now() - interval '30 days'
    AND has_role(auth.uid(), 'admin'::app_role);
$$;

REVOKE ALL ON FUNCTION public.get_monitoring_stats_30d() FROM public;
GRANT EXECUTE ON FUNCTION public.get_monitoring_stats_30d() TO authenticated;