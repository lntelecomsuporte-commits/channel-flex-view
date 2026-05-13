CREATE OR REPLACE VIEW public.user_access_stats
WITH (security_invoker = true) AS
SELECT
  p.user_id,
  p.username,
  p.display_name,
  p.is_blocked,
  p.is_active,
  p.created_at,
  (SELECT max(s.last_heartbeat_at) FROM public.user_sessions s WHERE s.user_id = p.user_id) AS last_login_at,
  (SELECT count(*) FROM public.user_sessions s WHERE s.user_id = p.user_id) AS total_logins,
  (SELECT count(*) FROM public.user_sessions s WHERE s.user_id = p.user_id AND s.started_at > now() - interval '30 days') AS logins_last_30d
FROM public.profiles p;

GRANT SELECT ON public.user_access_stats TO authenticated, anon;