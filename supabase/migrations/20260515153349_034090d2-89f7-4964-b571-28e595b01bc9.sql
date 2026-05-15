ALTER TABLE public.channels
  ADD COLUMN IF NOT EXISTS logo_source_url text;

-- Backfill: para canais cujo logo_url ainda aponta pra URL externa
-- (não começa com /logos/), copia para logo_source_url.
UPDATE public.channels
SET logo_source_url = logo_url
WHERE logo_source_url IS NULL
  AND logo_url IS NOT NULL
  AND logo_url <> ''
  AND logo_url NOT LIKE '/logos/%';