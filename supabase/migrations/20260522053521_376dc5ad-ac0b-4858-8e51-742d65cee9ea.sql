ALTER TABLE public.user_sessions
  ADD COLUMN IF NOT EXISTS device_id text,
  ADD COLUMN IF NOT EXISTS platform text;

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_active_device
  ON public.user_sessions (user_id, ended_at, last_heartbeat_at)
  WHERE ended_at IS NULL;