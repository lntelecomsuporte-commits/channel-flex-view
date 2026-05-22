-- 1) hubsoft_config: limite de dispositivos por integração
ALTER TABLE public.hubsoft_config
  ADD COLUMN device_limit integer NOT NULL DEFAULT 3;

COMMENT ON COLUMN public.hubsoft_config.device_limit IS 'Quantidade máxima de dispositivos por usuário desta integração. 0 = ilimitado.';

-- 2) profiles: override individual de limite
ALTER TABLE public.profiles
  ADD COLUMN device_limit_override integer;

COMMENT ON COLUMN public.profiles.device_limit_override IS 'Se preenchido, sobrescreve o limite da integração. Use para usuários manuais ou exceções. 0 = ilimitado.';

-- 3) Tabela user_devices
CREATE TABLE public.user_devices (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  device_id text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('android', 'roku')),
  device_name text,
  device_label text,
  app_version text,
  last_ip text,
  first_login_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'self_register' CHECK (created_by IN ('self_register', 'admin_manual')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_devices_device_platform_unique UNIQUE (device_id, platform)
);

CREATE INDEX idx_user_devices_user_id ON public.user_devices(user_id);
CREATE INDEX idx_user_devices_device_id ON public.user_devices(device_id);

ALTER TABLE public.user_devices ENABLE ROW LEVEL SECURITY;

-- Users veem seus próprios devices
CREATE POLICY "Users can view own devices"
  ON public.user_devices FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users podem atualizar last_seen do próprio device (mas não is_active/label)
-- A edge function usa service_role, então essa policy é só fallback
CREATE POLICY "Users can update own device last_seen"
  ON public.user_devices FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Admins têm controle total
CREATE POLICY "Admins can manage all devices"
  ON public.user_devices FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_user_devices_updated_at
  BEFORE UPDATE ON public.user_devices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4) Função resolve_device_limit
CREATE OR REPLACE FUNCTION public.resolve_device_limit(_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_override integer;
  v_integration_limit integer;
BEGIN
  SELECT device_limit_override INTO v_override
  FROM public.profiles WHERE user_id = _user_id;

  IF v_override IS NOT NULL THEN
    RETURN v_override;
  END IF;

  -- Pega o limite da integração ativa que esse usuário usa (via user_category_access.hubsoft_config_id)
  SELECT hc.device_limit INTO v_integration_limit
  FROM public.user_category_access uca
  JOIN public.hubsoft_config hc ON hc.id = uca.hubsoft_config_id
  WHERE uca.user_id = _user_id
    AND uca.is_active = true
    AND hc.is_active = true
  ORDER BY hc.updated_at DESC
  LIMIT 1;

  IF v_integration_limit IS NOT NULL THEN
    RETURN v_integration_limit;
  END IF;

  RETURN 3; -- default global
END;
$$;