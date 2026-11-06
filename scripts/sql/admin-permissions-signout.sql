-- Quem já tinha "Bloquear / deslogar" mantém também o novo "Deslogar"
UPDATE public.admin_permissions SET permissions = array_append(permissions, 'users.signout')
 WHERE 'users.block' = ANY(permissions) AND NOT 'users.signout' = ANY(permissions);
UPDATE public.permission_presets SET permissions = array_append(permissions, 'users.signout')
 WHERE 'users.block' = ANY(permissions) AND NOT 'users.signout' = ANY(permissions);
