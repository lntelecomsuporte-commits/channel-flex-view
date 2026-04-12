import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type Channel = Tables<"channels">;
export type Category = Tables<"categories">;

export function useChannels() {
  return useQuery({
    queryKey: ["channels"],
    queryFn: async () => {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      
      let query = supabase
        .from("channels")
        .select("*")
        .eq("is_active", true)
        .order("channel_number", { ascending: true });

      // If user is logged in, check category access
      if (user) {
        const { data: access } = await supabase
          .from("user_category_access")
          .select("category_id")
          .eq("user_id", user.id)
          .eq("is_active", true);

        // If user has category restrictions, filter channels
        if (access && access.length > 0) {
          const categoryIds = access.map((a) => a.category_id);
          query = query.in("category_id", categoryIds);
        }
        // If no access records exist, show all channels (backwards compatible for manually created users)
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Channel[];
    },
  });
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
