CREATE TABLE public.admin_permissions (
  user_id uuid PRIMARY KEY,
  permissions text[] NOT NULL DEFAULT '{}',
  preset_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.permission_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  permissions text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_permissions TO authenticated;
GRANT ALL ON public.admin_permissions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.permission_presets TO authenticated;
GRANT ALL ON public.permission_presets TO service_role;
ALTER TABLE public.admin_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permission_presets ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_master_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT EXISTS (SELECT 1 FROM auth.users WHERE id = _user_id AND lower(email) = 'lucasiappe@yahoo.com.br')
$$;

-- Admin sem linha em admin_permissions = acesso total (compatível com admins existentes)
CREATE OR REPLACE FUNCTION public.has_admin_permission(_user_id uuid, _perm text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_master_admin(_user_id) OR (
    public.has_role(_user_id, 'admin') AND (
      NOT EXISTS (SELECT 1 FROM public.admin_permissions WHERE user_id = _user_id)
      OR EXISTS (SELECT 1 FROM public.admin_permissions WHERE user_id = _user_id AND _perm = ANY(permissions))
    )
  )
$$;

CREATE POLICY "Admins view permissions" ON public.admin_permissions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_admin_permission(auth.uid(), 'admins.manage'));
CREATE POLICY "Managers edit permissions" ON public.admin_permissions FOR ALL TO authenticated
  USING (public.has_admin_permission(auth.uid(), 'admins.manage') AND NOT public.is_master_admin(user_id) AND (user_id <> auth.uid() OR public.is_master_admin(auth.uid())))
  WITH CHECK (public.has_admin_permission(auth.uid(), 'admins.manage') AND NOT public.is_master_admin(user_id) AND (user_id <> auth.uid() OR public.is_master_admin(auth.uid())));

CREATE POLICY "Admins view presets" ON public.permission_presets FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Managers edit presets" ON public.permission_presets FOR ALL TO authenticated
  USING (public.has_admin_permission(auth.uid(), 'admins.manage'))
  WITH CHECK (public.has_admin_permission(auth.uid(), 'admins.manage'));

CREATE OR REPLACE FUNCTION public.list_admin_users()
RETURNS TABLE(user_id uuid, email text, display_name text, is_master boolean, permissions text[], has_custom boolean, preset_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT r.user_id, u.email::text, p.display_name, public.is_master_admin(r.user_id),
         ap.permissions, ap.user_id IS NOT NULL, ap.preset_id
  FROM public.user_roles r
  JOIN auth.users u ON u.id = r.user_id
  LEFT JOIN public.profiles p ON p.user_id = r.user_id
  LEFT JOIN public.admin_permissions ap ON ap.user_id = r.user_id
  WHERE r.role = 'admin' AND public.has_admin_permission(auth.uid(), 'admins.manage')
  ORDER BY public.is_master_admin(r.user_id) DESC, u.email
$$;

-- Bloqueia remoção de canais no banco para quem não tem permissão
CREATE POLICY "Only permitted admins delete channels" ON public.channels AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.has_admin_permission(auth.uid(), 'channels.delete'));