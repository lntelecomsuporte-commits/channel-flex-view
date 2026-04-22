ALTER TABLE public.user_sessions
ADD COLUMN IF NOT EXISTS client_ipv4 text,
ADD COLUMN IF NOT EXISTS client_ipv6 text;