import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export interface Favorite {
  id: string;
  channel_id: string;
  position: number;
}

export function useFavorites() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["favorites", user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<Favorite[]> => {
      const { data, error } = await supabase
        .from("user_favorites")
        .select("id, channel_id, position")
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const toggle = useMutation({
    mutationFn: async (channelId: string) => {
      if (!user?.id) throw new Error("not authenticated");
      const existing = (query.data ?? []).find((f) => f.channel_id === channelId);
      if (existing) {
        const { error } = await supabase
          .from("user_favorites")
          .delete()
          .eq("id", existing.id);
        if (error) throw error;
        return { added: false };
      }
      const maxPos = (query.data ?? []).reduce((m, f) => Math.max(m, f.position), -1);
      const { error } = await supabase.from("user_favorites").insert({
        user_id: user.id,
        channel_id: channelId,
        position: maxPos + 1,
      });
      if (error) throw error;
      return { added: true };
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["favorites", user?.id] });
      toast.success(res.added ? "Adicionado aos favoritos" : "Removido dos favoritos");
    },
    onError: () => toast.error("Erro ao atualizar favorito"),
  });

  const isFavorite = (channelId: string) =>
    (query.data ?? []).some((f) => f.channel_id === channelId);

  return {
    favorites: query.data ?? [],
    isFavorite,
    toggleFavorite: (channelId: string) => toggle.mutate(channelId),
  };
}
