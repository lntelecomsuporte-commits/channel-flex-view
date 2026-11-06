CREATE POLICY "Master profile protected update" ON public.profiles AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.is_master_admin(user_id) OR auth.uid() = user_id);
CREATE POLICY "Master profile protected delete" ON public.profiles AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT public.is_master_admin(user_id) OR auth.uid() = user_id);