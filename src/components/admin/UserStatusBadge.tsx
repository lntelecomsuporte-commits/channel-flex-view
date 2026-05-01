import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabaseLocal";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tv2, Clock, Globe, Search, X } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

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
  client_ipv4: string | null;
  client_ipv6: string | null;
};

const ACTIVE_WINDOW_MS = 90_000;

export const UserStatusBadge = ({ userId }: UserStatusProps) => {
  const [open, setOpen] = useState(false);
  const [searchAt, setSearchAt] = useState<string>("");
  const [windowMin, setWindowMin] = useState<number>(15);
  const [activeQuery, setActiveQuery] = useState<{ at: string; window: number } | null>(null);

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

  const { data: nearbyPlayback, isFetching: isSearching } = useQuery({
    queryKey: ["user-playback-near", userId, activeQuery?.at, activeQuery?.window],
    enabled: !!activeQuery,
    queryFn: async () => {
      if (!activeQuery) return [];
      const center = new Date(activeQuery.at).getTime();
      const ms = activeQuery.window * 60_000;
      const from = new Date(center - ms).toISOString();
      const to = new Date(center + ms).toISOString();

      const [proxyRes, sessRes] = await Promise.all([
        supabase
          .from("proxy_access_log")
          .select("channel_name, bucket_minute, request_count, bytes_transferred")
          .eq("user_id", userId)
          .gte("bucket_minute", from)
          .lte("bucket_minute", to)
          .order("bucket_minute", { ascending: true }),
        supabase
          .from("user_sessions")
          .select("current_channel_name, last_heartbeat_at, is_watching")
          .eq("user_id", userId)
          .gte("last_heartbeat_at", from)
          .lte("last_heartbeat_at", to)
          .order("last_heartbeat_at", { ascending: true }),
      ]);

      type Item = { time: string; channel: string; source: "proxy" | "session"; meta?: string };
      const items: Item[] = [];
      (proxyRes.data ?? []).forEach((r: any) => {
        if (!r.channel_name) return;
        const mb = (Number(r.bytes_transferred ?? 0) / 1024 / 1024).toFixed(1);
        items.push({
          time: r.bucket_minute,
          channel: r.channel_name,
          source: "proxy",
          meta: `${r.request_count} req · ${mb} MB`,
        });
      });
      (sessRes.data ?? []).forEach((r: any) => {
        if (!r.current_channel_name || !r.is_watching) return;
        items.push({
          time: r.last_heartbeat_at,
          channel: r.current_channel_name,
          source: "session",
        });
      });

      return items.sort(
        (a, b) => Math.abs(new Date(a.time).getTime() - center) - Math.abs(new Date(b.time).getTime() - center)
      );
    },
  });

  const handleSearch = () => {
    if (!searchAt) return;
    setActiveQuery({ at: new Date(searchAt).toISOString(), window: windowMin });
  };

  const clearSearch = () => {
    setActiveQuery(null);
    setSearchAt("");
  };

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
      <PopoverContent className="w-96 p-3" align="end">
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

          <div className="border-t border-border pt-2 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">Buscar reprodução por data/hora</p>
            <div className="flex gap-2 items-end">
              <div className="flex-1 space-y-1">
                <Label className="text-[10px] text-muted-foreground">Data e hora</Label>
                <Input
                  type="datetime-local"
                  value={searchAt}
                  onChange={(e) => setSearchAt(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div className="w-20 space-y-1">
                <Label className="text-[10px] text-muted-foreground">± min</Label>
                <Input
                  type="number"
                  min={1}
                  max={240}
                  value={windowMin}
                  onChange={(e) => setWindowMin(Math.max(1, Number(e.target.value) || 15))}
                  className="h-8 text-xs"
                />
              </div>
              <Button size="sm" className="h-8" onClick={handleSearch} disabled={!searchAt}>
                <Search className="h-3 w-3" />
              </Button>
              {activeQuery && (
                <Button size="sm" variant="ghost" className="h-8 px-2" onClick={clearSearch}>
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
            {activeQuery && (
              <div className="max-h-44 overflow-y-auto space-y-1.5 mt-2">
                {isSearching ? (
                  <p className="text-xs text-muted-foreground italic">Buscando...</p>
                ) : !nearbyPlayback?.length ? (
                  <p className="text-xs text-muted-foreground italic">
                    Nada reproduzido em ±{activeQuery.window} min de{" "}
                    {format(new Date(activeQuery.at), "dd/MM HH:mm", { locale: ptBR })}.
                  </p>
                ) : (
                  nearbyPlayback.map((it, idx) => (
                    <div key={idx} className="text-xs p-2 rounded bg-secondary">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-foreground flex items-center gap-1">
                          <Tv2 className="h-3 w-3 text-primary" /> {it.channel}
                        </span>
                        <span className="text-[10px] uppercase text-muted-foreground">{it.source}</span>
                      </div>
                      <div className="flex items-center justify-between mt-0.5 ml-4 text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {format(new Date(it.time), "dd/MM HH:mm", { locale: ptBR })}
                        </span>
                        {it.meta && <span>{it.meta}</span>}
                      </div>
                    </div>
                  ))
                )}
              </div>
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
                      {(s.client_ipv4 || s.client_ipv6 || s.ip_address) && (
                        <p className="text-muted-foreground mt-0.5 ml-4 flex items-center gap-1 flex-wrap">
                          <Globe className="h-3 w-3" />
                          {s.client_ipv4 && <span>IPv4: {s.client_ipv4}</span>}
                          {s.client_ipv6 && <span>IPv6: {s.client_ipv6}</span>}
                          {!s.client_ipv4 && !s.client_ipv6 && s.ip_address && <span>{s.ip_address}</span>}
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
