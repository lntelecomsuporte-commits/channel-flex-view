import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabaseLocal";
import { resolvePermissions, isMasterEmail } from "@/lib/adminPermissions";
import type { User } from "@supabase/supabase-js";

export function useAdminPermissions(user: User | null, isAdmin: boolean) {
  const q = useQuery({
    queryKey: ["my-admin-permissions", user?.id],
    enabled: !!user && isAdmin,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("admin_permissions")
        .select("permissions")
        .eq("user_id", user!.id)
        .maybeSingle();
      return (data?.permissions as string[] | undefined) ?? null;
    },
  });
  const perms = resolvePermissions({ email: user?.email, isAdmin, custom: q.data ?? null });
  return {
    can: (p: string) => perms.has(p),
    isMaster: isMasterEmail(user?.email),
    loading: q.isLoading,
  };
}
