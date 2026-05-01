ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS force_signout_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS idx_profiles_force_signout_at
  ON public.profiles (user_id, force_signout_at);