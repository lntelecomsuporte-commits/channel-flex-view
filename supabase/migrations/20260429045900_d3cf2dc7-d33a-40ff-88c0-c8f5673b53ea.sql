-- Bucket privado pra backup de credenciais críticas (keystore Android etc)
INSERT INTO storage.buckets (id, name, public)
VALUES ('credentials-backup', 'credentials-backup', false)
ON CONFLICT (id) DO NOTHING;

-- Apenas admins podem ver/gerenciar
CREATE POLICY "Admins can view credentials backup"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'credentials-backup' AND public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can upload credentials backup"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'credentials-backup' AND public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update credentials backup"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'credentials-backup' AND public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete credentials backup"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'credentials-backup' AND public.has_role(auth.uid(), 'admin'::app_role));