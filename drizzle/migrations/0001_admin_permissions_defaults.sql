CREATE OR REPLACE FUNCTION public.has_admin_permission(_user_id uuid, _perm text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_master_admin(_user_id) OR (
    public.has_role(_user_id, 'admin') AND (
      (NOT EXISTS (SELECT 1 FROM public.admin_permissions WHERE user_id = _user_id)
        AND _perm NOT IN ('channels.delete', 'admins.manage'))
      OR EXISTS (SELECT 1 FROM public.admin_permissions WHERE user_id = _user_id AND _perm = ANY(permissions))
    )
  )
$$;