-- Tabela de sessões de usuário (heartbeat para detectar online)
CREATE TABLE public.user_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  session_token TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  current_channel_id UUID,
  current_channel_name TEXT,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_heartbeat_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  ended_at TIMESTAMP WITH TIME ZONE,
  is_watching BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_sessions_user_id ON public.user_sessions(user_id);
CREATE INDEX idx_user_sessions_heartbeat ON public.user_sessions(last_heartbeat_at DESC);
CREATE INDEX idx_user_sessions_token ON public.user_sessions(session_token);
CREATE INDEX idx_user_sessions_active ON public.user_sessions(user_id, ended_at) WHERE ended_at IS NULL;

ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all sessions"
ON public.user_sessions FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can view own sessions"
ON public.user_sessions FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sessions"
ON public.user_sessions FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sessions"
ON public.user_sessions FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

-- Tabela de log de uso do proxy (agregado por minuto)
CREATE TABLE public.proxy_access_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID,
  ip_address TEXT NOT NULL,
  channel_id UUID,
  channel_name TEXT,
  stream_host TEXT,
  request_count INTEGER NOT NULL DEFAULT 1,
  bytes_transferred BIGINT NOT NULL DEFAULT 0,
  bucket_minute TIMESTAMP WITH TIME ZONE NOT NULL,
  first_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_proxy_log_unique_bucket
  ON public.proxy_access_log(ip_address, COALESCE(user_id::text, ''), COALESCE(channel_id::text, ''), bucket_minute);
CREATE INDEX idx_proxy_log_last_seen ON public.proxy_access_log(last_seen_at DESC);
CREATE INDEX idx_proxy_log_user ON public.proxy_access_log(user_id, last_seen_at DESC);

ALTER TABLE public.proxy_access_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view proxy log"
ON public.proxy_access_log FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- (sem políticas de INSERT — apenas service_role da edge function escreve)

-- Função: limpa dados antigos (>30 dias)
CREATE OR REPLACE FUNCTION public.cleanup_old_monitoring_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.user_sessions
  WHERE created_at < now() - interval '30 days';

  DELETE FROM public.proxy_access_log
  WHERE created_at < now() - interval '30 days';

  -- Marca sessões "fantasma" (sem heartbeat há > 5 min) como encerradas
  UPDATE public.user_sessions
  SET ended_at = last_heartbeat_at
  WHERE ended_at IS NULL
    AND last_heartbeat_at < now() - interval '5 minutes';
END;
$$;

-- Função: status online de um usuário
CREATE OR REPLACE FUNCTION public.get_user_online_status(_user_id UUID)
RETURNS TABLE (
  is_logged_in BOOLEAN,
  is_watching BOOLEAN,
  current_channel_name TEXT,
  last_seen TIMESTAMP WITH TIME ZONE,
  session_started_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS(
      SELECT 1 FROM public.user_sessions
      WHERE user_id = _user_id
        AND ended_at IS NULL
        AND last_heartbeat_at > now() - interval '90 seconds'
    ) AS is_logged_in,
    EXISTS(
      SELECT 1 FROM public.user_sessions
      WHERE user_id = _user_id
        AND ended_at IS NULL
        AND is_watching = true
        AND last_heartbeat_at > now() - interval '90 seconds'
    ) AS is_watching,
    (SELECT current_channel_name FROM public.user_sessions
     WHERE user_id = _user_id AND ended_at IS NULL
     ORDER BY last_heartbeat_at DESC LIMIT 1) AS current_channel_name,
    (SELECT last_heartbeat_at FROM public.user_sessions
     WHERE user_id = _user_id
     ORDER BY last_heartbeat_at DESC LIMIT 1) AS last_seen,
    (SELECT started_at FROM public.user_sessions
     WHERE user_id = _user_id AND ended_at IS NULL
     ORDER BY started_at DESC LIMIT 1) AS session_started_at;
$$;