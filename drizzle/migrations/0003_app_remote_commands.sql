CREATE TABLE public.app_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id uuid,
  command text NOT NULL CHECK (command IN ('reload_channels','force_close')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX app_commands_created_idx ON public.app_commands (created_at DESC);
GRANT SELECT, INSERT ON public.app_commands TO authenticated;
GRANT ALL ON public.app_commands TO service_role;
ALTER TABLE public.app_commands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read commands" ON public.app_commands FOR SELECT TO authenticated
  USING (public.has_admin_permission(auth.uid(), 'monitoring.view') OR public.has_admin_permission(auth.uid(), 'users.view'));
CREATE POLICY "admins insert commands" ON public.app_commands FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid() AND (
      (target_user_id IS NOT NULL AND command = 'reload_channels' AND public.has_admin_permission(auth.uid(), 'users.reload_channels'))
      OR (target_user_id IS NOT NULL AND command = 'force_close' AND public.has_admin_permission(auth.uid(), 'users.force_close'))
      OR (target_user_id IS NULL AND command = 'reload_channels' AND public.has_admin_permission(auth.uid(), 'channels.reload_all'))
      OR (target_user_id IS NULL AND command = 'force_close' AND public.has_admin_permission(auth.uid(), 'channels.close_all'))
    ));
ALTER TABLE public.user_sessions ADD COLUMN IF NOT EXISTS last_command_at timestamptz;