-- Trial period columns on hubsoft_config
ALTER TABLE public.hubsoft_config
  ADD COLUMN IF NOT EXISTS trial_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trial_days integer NOT NULL DEFAULT 30;

-- Trial categories per integration
CREATE TABLE IF NOT EXISTS public.hubsoft_config_trial_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hubsoft_config_id uuid NOT NULL,
  category_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hubsoft_config_id, category_id)
);

ALTER TABLE public.hubsoft_config_trial_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage hubsoft trial categories" ON public.hubsoft_config_trial_categories;
CREATE POLICY "Admins can manage hubsoft trial categories"
  ON public.hubsoft_config_trial_categories
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Trial markers on user_category_access
ALTER TABLE public.user_category_access
  ADD COLUMN IF NOT EXISTS is_trial boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trial_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_uca_trial_expires
  ON public.user_category_access (trial_expires_at)
  WHERE is_trial = true;

-- Function: expire trial access and restore normal categories
CREATE OR REPLACE FUNCTION public.expire_trial_access()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected_pairs RECORD;
  total_users integer := 0;
BEGIN
  -- Snapshot of (user_id, hubsoft_config_id) pairs that have expired trials
  CREATE TEMP TABLE _expired_pairs ON COMMIT DROP AS
  SELECT DISTINCT user_id, hubsoft_config_id
  FROM public.user_category_access
  WHERE is_trial = true
    AND trial_expires_at IS NOT NULL
    AND trial_expires_at < now()
    AND hubsoft_config_id IS NOT NULL;

  -- Delete expired trial rows
  DELETE FROM public.user_category_access uca
  USING _expired_pairs ep
  WHERE uca.user_id = ep.user_id
    AND uca.hubsoft_config_id = ep.hubsoft_config_id
    AND uca.is_trial = true
    AND uca.trial_expires_at < now();

  -- Restore normal categories from the integration
  FOR affected_pairs IN SELECT user_id, hubsoft_config_id FROM _expired_pairs LOOP
    INSERT INTO public.user_category_access (user_id, category_id, hubsoft_config_id, is_active, is_trial)
    SELECT affected_pairs.user_id, hcc.category_id, affected_pairs.hubsoft_config_id, true, false
    FROM public.hubsoft_config_categories hcc
    WHERE hcc.hubsoft_config_id = affected_pairs.hubsoft_config_id
      AND NOT EXISTS (
        SELECT 1 FROM public.user_category_access existing
        WHERE existing.user_id = affected_pairs.user_id
          AND existing.category_id = hcc.category_id
          AND existing.hubsoft_config_id = affected_pairs.hubsoft_config_id
          AND existing.is_trial = false
      );
    total_users := total_users + 1;
  END LOOP;

  RETURN total_users;
END;
$$;