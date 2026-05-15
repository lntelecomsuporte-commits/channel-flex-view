-- Fix existing data: where a category is BOTH fixed (linked to integration) AND marked as trial
-- for the same hubsoft_config_id, demote it to non-trial fixed access.
UPDATE public.user_category_access uca
SET is_trial = false,
    trial_expires_at = NULL
WHERE uca.is_trial = true
  AND uca.hubsoft_config_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.hubsoft_config_categories hcc
    WHERE hcc.hubsoft_config_id = uca.hubsoft_config_id
      AND hcc.category_id = uca.category_id
  );