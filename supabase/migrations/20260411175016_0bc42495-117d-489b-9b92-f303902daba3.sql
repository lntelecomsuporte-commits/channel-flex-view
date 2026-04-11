-- Add api_key column for webhook authentication
ALTER TABLE public.hubsoft_config ADD COLUMN IF NOT EXISTS api_key text NOT NULL DEFAULT '';

-- Remove unused columns
ALTER TABLE public.hubsoft_config DROP COLUMN IF EXISTS client_id;
ALTER TABLE public.hubsoft_config DROP COLUMN IF EXISTS client_secret;