-- Adiciona credenciais de playlist M3U/HLS ao profile
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS playlist_token uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS playlist_password text NOT NULL DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 12);

-- Garante unicidade do token (URL pública)
CREATE UNIQUE INDEX IF NOT EXISTS profiles_playlist_token_key ON public.profiles(playlist_token);

-- Backfill: garante que linhas antigas tenham valores únicos (caso default não tenha rodado)
UPDATE public.profiles
   SET playlist_token = gen_random_uuid()
 WHERE playlist_token IS NULL;

UPDATE public.profiles
   SET playlist_password = substr(md5(random()::text || clock_timestamp()::text || id::text), 1, 12)
 WHERE playlist_password IS NULL OR playlist_password = '';
