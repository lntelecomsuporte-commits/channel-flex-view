import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, Globe, Tv2, User, Wifi, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useState } from "react";

type ProxyAccess = {
  id: string;
  user_id: string | null;
  ip_address: string;
  channel_id: string | null;
  channel_name: string | null;
  stream_host: string | null;
  request_count: number;
  bytes_transferred: number;
  bucket_minute: string;
  first_seen_at: string;
  last_seen_at: string;
};

const useProxyAccess = () =>
  useQuery({
    queryKey: ["proxy-access-log"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("proxy_access_log")
        .select("*")
        .gte("last_seen_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .order("last_seen_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as ProxyAccess[];
    },
    refetchInterval: 10_000,
  });

const useProfilesMap = () =>
  useQuery({
    queryKey: ["profiles-map"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("user_id, username, display_name");
      const map = new Map<string, { username: string | null; display_name: string | null }>();
      (data ?? []).forEach((p) => map.set(p.user_id, { username: p.username, display_name: p.display_name }));
      return map;
    },
  });

const formatBytes = (bytes: number) => {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(1)} ${units[i]}`;
};

const ProxyMonitoring = () => {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { data: logs, isLoading } = useProxyAccess();
  const { data: profiles } = useProfilesMap();

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["proxy-access-log"] }),
      queryClient.invalidateQueries({ queryKey: ["profiles-map"] }),
    ]);
    setIsRefreshing(false);
  };

  const now = Date.now();
  const ACTIVE_WINDOW_MS = 90_000;

  const active = (logs ?? []).filter((l) => now - new Date(l.last_seen_at).getTime() < ACTIVE_WINDOW_MS);

  // Agrupa "ativos agora" por IP+user+canal (o mais recente por chave)
  const activeMap = new Map<string, ProxyAccess>();
  active.forEach((l) => {
    const key = `${l.ip_address}|${l.user_id ?? "anon"}|${l.channel_id ?? "?"}`;
    const prev = activeMap.get(key);
    if (!prev || new Date(l.last_seen_at) > new Date(prev.last_seen_at)) activeMap.set(key, l);
  });
  const activeList = [...activeMap.values()];

  // Agrega histórico (24h) por IP+canal
  const since24h = now - 24 * 60 * 60 * 1000;
  const recent = (logs ?? []).filter((l) => new Date(l.last_seen_at).getTime() >= since24h);
  const aggMap = new Map<string, { ip: string; user_id: string | null; channel: string; requests: number; bytes: number; last: string }>();
  recent.forEach((l) => {
    const key = `${l.ip_address}|${l.user_id ?? "anon"}|${l.channel_name ?? l.stream_host ?? "?"}`;
    const prev = aggMap.get(key);
    const channel = l.channel_name ?? l.stream_host ?? "—";
    if (prev) {
      prev.requests += l.request_count;
      prev.bytes += Number(l.bytes_transferred);
      if (l.last_seen_at > prev.last) prev.last = l.last_seen_at;
    } else {
      aggMap.set(key, {
        ip: l.ip_address,
        user_id: l.user_id,
        channel,
        requests: l.request_count,
        bytes: Number(l.bytes_transferred),
        last: l.last_seen_at,
      });
    }
  });
  const history = [...aggMap.values()].sort((a, b) => (a.last < b.last ? 1 : -1)).slice(0, 100);

  const getUserLabel = (uid: string | null) => {
    if (!uid) return <span className="text-muted-foreground italic">não autenticado</span>;
    const p = profiles?.get(uid);
    return p?.display_name || p?.username || uid.slice(0, 8);
  };

  const totalBytes24h = recent.reduce((acc, l) => acc + Number(l.bytes_transferred), 0);
  const uniqueIps24h = new Set(recent.map((l) => l.ip_address)).size;

  return (
    <div className="space-y-6">
      {/* Métricas resumidas */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-md bg-primary/10 text-primary">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Ativos agora</p>
              <p className="text-2xl font-bold text-foreground">{activeList.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-md bg-primary/10 text-primary">
              <Globe className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">IPs únicos (24h)</p>
              <p className="text-2xl font-bold text-foreground">{uniqueIps24h}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-md bg-primary/10 text-primary">
              <Wifi className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Tráfego proxy (24h)</p>
              <p className="text-2xl font-bold text-foreground">{formatBytes(totalBytes24h)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sessões ativas */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" /> Ativos no proxy agora
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Carregando...</p>
          ) : !activeList.length ? (
            <p className="text-muted-foreground text-sm">Nenhum cliente usando o proxy no momento.</p>
          ) : (
            <div className="space-y-2">
              {activeList.map((l) => (
                <div key={l.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm">
                      <Tv2 className="h-3.5 w-3.5 text-primary" />
                      <span className="font-medium text-foreground">{l.channel_name ?? l.stream_host ?? "—"}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Globe className="h-3 w-3" /> {l.ip_address}</span>
                      <span className="flex items-center gap-1"><User className="h-3 w-3" /> {getUserLabel(l.user_id)}</span>
                    </div>
                  </div>
                  <Badge className="bg-primary/20 text-primary hover:bg-primary/30 border border-primary/40">
                    <span className="h-2 w-2 rounded-full bg-primary mr-1.5 animate-pulse" />
                    Ao vivo
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Histórico 24h */}
      <Card>
        <CardHeader>
          <CardTitle>Histórico (últimas 24h)</CardTitle>
        </CardHeader>
        <CardContent>
          {!history.length ? (
            <p className="text-muted-foreground text-sm">Sem registros nas últimas 24h.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b border-border">
                    <th className="py-2 pr-3">IP</th>
                    <th className="py-2 pr-3">Usuário</th>
                    <th className="py-2 pr-3">Canal</th>
                    <th className="py-2 pr-3 text-right">Requests</th>
                    <th className="py-2 pr-3 text-right">Tráfego</th>
                    <th className="py-2 pr-3">Última atividade</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row, i) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-secondary/50">
                      <td className="py-2 pr-3 font-mono text-xs">{row.ip}</td>
                      <td className="py-2 pr-3">{getUserLabel(row.user_id)}</td>
                      <td className="py-2 pr-3">{row.channel}</td>
                      <td className="py-2 pr-3 text-right">{row.requests}</td>
                      <td className="py-2 pr-3 text-right">{formatBytes(row.bytes)}</td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(row.last), { addSuffix: true, locale: ptBR })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ProxyMonitoring;
