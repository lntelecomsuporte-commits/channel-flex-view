import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type Channel = Tables<"channels">;
export type Category = Tables<"categories">;

export function useChannels() {
  return useQuery({
    queryKey: ["channels"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("channels")
        .select("*")
        .eq("is_active", true)
        .order("channel_number", { ascending: true });
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
