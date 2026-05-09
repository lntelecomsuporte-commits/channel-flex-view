ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS is_adult boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS adult_pin text NOT NULL DEFAULT '1234';