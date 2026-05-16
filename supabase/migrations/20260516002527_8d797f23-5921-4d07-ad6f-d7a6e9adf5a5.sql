CREATE OR REPLACE FUNCTION public.expire_trial_access()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  affected_pairs RECORD;
  total_users integer := 0;
BEGIN
  -- Snapshot de pares (user_id, hubsoft_config_id) com trial expirado
  CREATE TEMP TABLE _expired_pairs ON COMMIT DROP AS
  SELECT DISTINCT user_id, hubsoft_config_id
  FROM public.user_category_access
  WHERE is_trial = true
    AND trial_expires_at IS NOT NULL
    AND trial_expires_at < now()
    AND hubsoft_config_id IS NOT NULL;

  DELETE FROM public.user_category_access uca
  USING _expired_pairs ep
  WHERE uca.user_id = ep.user_id
    AND uca.hubsoft_config_id = ep.hubsoft_config_id
    AND uca.is_trial = true
    AND uca.trial_expires_at < now();

  -- Remove trials ÓRFÃOS: a config foi alterada e não oferece mais essa categoria como trial
  -- (ou trial_enabled foi desligado)
  DELETE FROM public.user_category_access uca
  WHERE uca.is_trial = true
    AND uca.hubsoft_config_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.hubsoft_config hc
      WHERE hc.id = uca.hubsoft_config_id
        AND hc.trial_enabled = true
        AND EXISTS (
          SELECT 1 FROM public.hubsoft_config_trial_categories hctc
          WHERE hctc.hubsoft_config_id = hc.id
            AND hctc.category_id = uca.category_id
        )
    );

  -- Restaura categorias fixas da integração para usuários que tiveram trial expirado
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
$function$;