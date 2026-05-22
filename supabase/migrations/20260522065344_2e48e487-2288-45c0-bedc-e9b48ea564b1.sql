
CREATE TABLE public.pending_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL,
  platform text NOT NULL,
  device_name text,
  app_version text,
  last_ip text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX pending_devices_device_platform_idx
  ON public.pending_devices (device_id, platform);

CREATE INDEX pending_devices_last_seen_idx
  ON public.pending_devices (last_seen_at DESC);

ALTER TABLE public.pending_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view pending devices"
  ON public.pending_devices FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete pending devices"
  ON public.pending_devices FOR DELETE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
