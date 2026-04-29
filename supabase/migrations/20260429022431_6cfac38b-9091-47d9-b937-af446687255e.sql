ALTER TABLE public.channels
ADD COLUMN backup_stream_urls text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.channels.backup_stream_urls IS 'Lista ordenada de URLs de fallback. Player tenta stream_url primeiro; em erro fatal, tenta cada URL desta lista em ordem.';