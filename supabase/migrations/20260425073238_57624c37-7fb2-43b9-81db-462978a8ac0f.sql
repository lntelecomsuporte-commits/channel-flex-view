-- 1. Limpa profiles órfãos (sem auth.users correspondente)
DELETE FROM public.profiles p
WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.user_id);

-- 2. Limpa duplicatas de hubsoft_client_id (mantém o mais recente)
DELETE FROM public.profiles p
USING public.profiles p2
WHERE p.hubsoft_client_id IS NOT NULL
  AND p.hubsoft_client_id = p2.hubsoft_client_id
  AND p.created_at < p2.created_at;

-- 3. FK com cascade: deletar auth.users limpa profile automaticamente
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_user_id_fkey;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- 4. UNIQUE em user_id (1 profile por usuário)
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_user_id_key;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_user_id_key UNIQUE (user_id);

-- 5. UNIQUE parcial em hubsoft_client_id (só quando preenchido)
DROP INDEX IF EXISTS profiles_hubsoft_client_id_unique;

CREATE UNIQUE INDEX profiles_hubsoft_client_id_unique
  ON public.profiles (hubsoft_client_id)
  WHERE hubsoft_client_id IS NOT NULL;