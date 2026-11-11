import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type AppCommand = "reload_channels" | "force_close";

/** Envia comando remoto; os apps executam no próximo heartbeat (até 30s). targetUserId null = todos. */
export async function sendAppCommand(command: AppCommand, targetUserId: string | null, label?: string) {
  const what = command === "reload_channels" ? "recarregar os canais" : "fechar o app";
  const who = targetUserId ? (label || "este cliente") : "TODOS os apps online";
  if (!window.confirm(`Deseja ${what} de ${who}?`)) return;
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase.from("app_commands").insert({
    command,
    target_user_id: targetUserId,
    created_by: auth.user?.id ?? null,
  });
  if (error) toast.error("Erro ao enviar comando: " + error.message);
  else toast.success(`Comando enviado — ${who} em até 30s`);
}
