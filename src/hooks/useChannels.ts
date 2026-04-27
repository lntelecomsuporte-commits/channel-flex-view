import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/lib/supabaseLocal";
import type { Tables } from "@/integrations/supabase/types";
import { primeLogoVersions } from "@/lib/logoCache";
import { resolveLogoUrl } from "@/lib/logoUrl";
import { channelsCache } from "@/lib/diskCache";

export type Channel = Tables<"channels">;
export type Category = Tables<"categories">;

export function useChannels() {
  const query = useQuery({
    queryKey: ["channels"],
    // Sempre revalida ao abrir o app / voltar foco — garante que mudanças
    // de logo/URL feitas no painel apareçam assim que o APK reabrir.
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();

      if (user) {
        // Check if user has category access records
        const { data: access } = await supabase
          .from("user_category_access")
          .select("category_id")
          .eq("user_id", user.id)
          .eq("is_active", true);

        if (access && access.length > 0) {
          const directCategoryIds = access.map((a) => a.category_id);

          // Resolve included categories (category_includes)
          const { data: includes } = await supabase
            .from("category_includes")
            .select("included_category_id")
            .in("category_id", directCategoryIds);

          const includedIds = includes?.map((i) => i.included_category_id) || [];
          const allCategoryIds = [...new Set([...directCategoryIds, ...includedIds])];

          const { data, error } = await supabase
            .from("channels")
            .select("*")
            .eq("is_active", true)
            .in("category_id", allCategoryIds)
            .order("channel_number", { ascending: true });
          if (error) throw error;
          return data as Channel[];
        }
        // No access records = no channels
        return [] as Channel[];
      }
      return [] as Channel[];
    },
  });

  // Sempre que a lista de canais carregar/mudar, sincroniza o cache de logos.
  // Versão = updated_at do canal: se o admin mexer no canal, a logo é re-baixada.
  useEffect(() => {
    if (!query.data) return;
    primeLogoVersions(
      query.data.map((c) => ({ url: resolveLogoUrl(c.logo_url), version: c.updated_at }))
    );
  }, [query.data]);

  return query;
}

export function useAllChannels() {
  return useQuery({
    queryKey: ["channels-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("channels")
        .select("*")
        .order("channel_number", { ascending: true });
      if (error) throw error;
      return data as Channel[];
    },
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("*")
        .order("position", { ascending: true });
      if (error) throw error;
      return data as Category[];
    },
  });
}
