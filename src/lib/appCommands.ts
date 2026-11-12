import { supabase } from "@/lib/supabaseLocal";
import { toast } from "sonner";

export type AppCommand = "reload_channels" | "force_close";

/** Envia comando remoto; os apps executam no próximo heartbeat (até 30s). targetUserId null = todos. */
export async function sendAppCommand(
  command: AppCommand,
  targetUserId: string | null,
  label?: string,
  options: { confirm?: boolean } = {},
): Promise<boolean> {
  const what = command === "reload_channels" ? "recarregar os canais" : "fechar o app";
  const who = targetUserId ? (label || "este cliente") : "TODOS os apps online";
  if (options.confirm !== false && !window.confirm(`Deseja ${what} de ${who}?`)) return false;
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    toast.error("Sua sessão expirou. Entre novamente no painel para enviar o comando.");
    return false;
  }
  const { error } = await supabase.from("app_commands").insert({
    command,
    target_user_id: targetUserId,
    created_by: auth.user.id,
  });
  if (error) {
    toast.error("Erro ao enviar comando: " + error.message);
    return false;
  }
  toast.success(`Comando enviado — ${who} em até 30s`);
  return true;
}
