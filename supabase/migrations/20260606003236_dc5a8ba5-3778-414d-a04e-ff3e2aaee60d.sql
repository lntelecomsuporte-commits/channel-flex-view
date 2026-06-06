
-- Função que resolve acesso do usuário a uma categoria, incluindo
-- expansão recursiva de category_includes e expiração de trial.
CREATE OR REPLACE FUNCTION public.user_has_category_access(_user_id uuid, _category_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE direct AS (
    SELECT uca.category_id
    FROM public.user_category_access uca
    WHERE uca.user_id = _user_id
      AND uca.is_active = true
      AND (
        uca.is_trial = false
        OR uca.trial_expires_at IS NULL
        OR uca.trial_expires_at > now()
      )
  ),
  reach AS (
    SELECT category_id FROM direct
    UNION
    SELECT ci.included_category_id
    FROM public.category_includes ci
    JOIN reach r ON r.category_id = ci.category_id
  )
  SELECT EXISTS (SELECT 1 FROM reach WHERE category_id = _category_id);
$$;

GRANT EXECUTE ON FUNCTION public.user_has_category_access(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_category_access(uuid, uuid) TO anon;

-- Reforça a RLS de channels: usuário só vê canal cuja categoria ele tenha acesso.
DROP POLICY IF EXISTS "Anyone can view active channels" ON public.channels;

CREATE POLICY "Users view channels they have access to"
ON public.channels
FOR SELECT
TO authenticated
USING (
  is_active = true
  AND category_id IS NOT NULL
  AND public.user_has_category_access(auth.uid(), category_id)
);

-- Admin segue com policy FOR ALL já existente; nenhuma mudança lá.
