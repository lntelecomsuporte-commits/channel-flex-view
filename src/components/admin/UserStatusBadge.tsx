import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tv2, Clock, Globe } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface UserStatusProps {
  userId: string;
}

type Session = {
  id: string;
  started_at: string;
  last_heartbeat_at: string;
  ended_at: string | null;
  current_channel_name: string | null;
  is_watching: boolean;
  ip_address: string | null;
};

const ACTIVE_WINDOW_MS = 90_000;

export const UserStatusBadge = ({ userId }: UserStatusProps) => {
  const [open, setOpen] = useState(false);

  const { data: sessions } = useQuery({
    queryKey: ["user-sessions", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_sessions")
        .select("*")
        .eq("user_id", userId)
        .order("started_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as Session[];
    },
    refetchInterval: 15_000,
  });

  const now = Date.now();
  const latest = sessions?.[0];
  const isLoggedIn =
    !!latest &&
    !latest.ended_at &&
    now - new Date(latest.last_heartbeat_at).getTime() < ACTIVE_WINDOW_MS;
  const isWatching = isLoggedIn && latest?.is_watching;

  const status: "watching" | "online" | "offline" = isWatching
    ? "watching"
    : isLoggedIn
    ? "online"
    : "offline";

  const styles = {
    watching: "bg-green-600/20 text-green-500 border border-green-600/40 hover:bg-green-600/30",
    online: "bg-yellow-500/20 text-yellow-400 border border-yellow-500/40 hover:bg-yellow-500/30",
    offline: "bg-muted text-muted-foreground hover:bg-muted/80",
  }[status];

  const label = {
    watching: "Assistindo",
    online: "Online",
    offline: "Offline",
  }[status];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`text-xs px-2 py-0.5 rounded inline-flex items-center gap-1.5 transition-colors ${styles}`}
          title="Ver histórico de sessões"
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              status === "watching" ? "bg-green-500 animate-pulse" : status === "online" ? "bg-yellow-400" : "bg-muted-foreground"
            }`}
          />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3" align="end">
        <div className="space-y-3">
          <div>
            <p className="text-sm font-semibold text-foreground">
              {status === "watching" && "Assistindo agora"}
              {status === "online" && "Logado, sem player ativo"}
              {status === "offline" && "Offline"}
            </p>
            {isLoggedIn && latest && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Sessão iniciada há{" "}
                {formatDistanceToNow(new Date(latest.started_at), { locale: ptBR })}
              </p>
            )}
            {!isLoggedIn && latest && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Última atividade{" "}
                {formatDistanceToNow(new Date(latest.last_heartbeat_at), { addSuffix: true, locale: ptBR })}
              </p>
            )}
            {isWatching && latest?.current_channel_name && (
              <p className="text-xs text-foreground mt-1 flex items-center gap-1">
                <Tv2 className="h-3 w-3 text-primary" /> {latest.current_channel_name}
              </p>
            )}
          </div>

          <div className="border-t border-border pt-2">
            <p className="text-xs font-semibold text-muted-foreground mb-2">Histórico recente</p>
            {!sessions?.length ? (
              <p className="text-xs text-muted-foreground italic">Sem sessões registradas.</p>
            ) : (
              <div className="max-h-60 overflow-y-auto space-y-1.5">
                {sessions.map((s) => {
                  const ended = s.ended_at ?? s.last_heartbeat_at;
                  const durMs = new Date(ended).getTime() - new Date(s.started_at).getTime();
                  const mins = Math.max(1, Math.round(durMs / 60000));
                  return (
                    <div key={s.id} className="text-xs p-2 rounded bg-secondary">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {format(new Date(s.started_at), "dd/MM HH:mm", { locale: ptBR })}
                        </span>
                        <span className="text-muted-foreground">{mins} min</span>
                      </div>
                      {s.current_channel_name && (
                        <p className="text-muted-foreground mt-0.5 ml-4">
                          📺 {s.current_channel_name}
                        </p>
                      )}
                      {s.ip_address && (
                        <p className="text-muted-foreground mt-0.5 ml-4 flex items-center gap-1">
                          <Globe className="h-3 w-3" /> {s.ip_address}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};
