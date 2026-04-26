import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabaseLocal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, Globe, Tv2, User, Wifi, RefreshCw, ChevronDown } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

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
        .limit(2000);
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

const useActiveSessions = () =>
  useQuery({
    queryKey: ["active-sessions-monitoring"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_sessions")
        .select("id, user_id, current_channel_id, current_channel_name, ip_address, client_ipv4, client_ipv6, user_agent, last_heartbeat_at, started_at, is_watching")
        .is("ended_at", null)
        .gte("last_heartbeat_at", new Date(Date.now() - 90_000).toISOString());
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 10_000,
  });

// Últimas sessões (30d) — usadas para enriquecer o histórico do proxy
// com o IPv4/IPv6/UA reais do cliente (o IP gravado no proxy_access_log
// é o do nginx interno, ex.: 172.18.0.1).
const useRecentSessionsByUser = () =>
  useQuery({
    queryKey: ["recent-sessions-by-user"],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_sessions")
        .select("user_id, client_ipv4, client_ipv6, user_agent, last_heartbeat_at")
        .gte("last_heartbeat_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .order("last_heartbeat_at", { ascending: false })
        .limit(5000);
      const map = new Map<string, { client_ipv4: string | null; client_ipv6: string | null; user_agent: string | null; last_heartbeat_at: string }>();
      (data ?? []).forEach((s: any) => {
        if (!s.user_id) return;
        const prev = map.get(s.user_id);
        if (!prev || new Date(s.last_heartbeat_at).getTime() > new Date(prev.last_heartbeat_at).getTime()) {
          map.set(s.user_id, {
            client_ipv4: s.client_ipv4,
            client_ipv6: s.client_ipv6,
            user_agent: s.user_agent,
            last_heartbeat_at: s.last_heartbeat_at,
          });
        }
      });
      return map;
    },
    refetchInterval: 30_000,
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
  const { data: sessions } = useActiveSessions();
  const { data: recentSessions } = useRecentSessionsByUser();

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["proxy-access-log"] }),
      queryClient.invalidateQueries({ queryKey: ["profiles-map"] }),
      queryClient.invalidateQueries({ queryKey: ["active-sessions-monitoring"] }),
      queryClient.invalidateQueries({ queryKey: ["recent-sessions-by-user"] }),
    ]);
    setIsRefreshing(false);
  };

  const now = Date.now();
  const ACTIVE_WINDOW_MS = 45_000;

  // Todos os usuários online (com heartbeat recente), assistindo ou não
  const onlineUsersMap = (sessions ?? [])
    .map((s) => ({
      id: (s as any).id as string,
      user_id: s.user_id,
      ip_address: s.ip_address ?? "—",
      client_ipv4: (s as any).client_ipv4 as string | null,
      client_ipv6: (s as any).client_ipv6 as string | null,
      user_agent: (s as any).user_agent as string | null,
      started_at: (s as any).started_at as string | null,
      channel_name: s.current_channel_name,
      is_watching: s.is_watching,
      last_seen_at: s.last_heartbeat_at,
    }))
    .reduce((acc, session) => {
      const key = `${session.user_id}|${session.channel_name ?? "sem-canal"}`;
      const previous = acc.get(key);
      if (!previous || new Date(session.last_seen_at).getTime() > new Date(previous.last_seen_at).getTime()) {
        acc.set(key, session);
      }
      return acc;
    }, new Map<string, {
      id: string;
      user_id: string;
      ip_address: string;
      client_ipv4: string | null;
      client_ipv6: string | null;
      user_agent: string | null;
      started_at: string | null;
      channel_name: string | null;
      is_watching: boolean;
      last_seen_at: string;
    }>());

  const onlineUsers = Array.from(onlineUsersMap.values())
    .sort((a, b) => new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime());

  // Ativos no proxy: qualquer usuário com hit recente no proxy_access_log.
  // Usamos só user_id (sem channel_name) para tolerar logs onde o
  // lookupChannel do edge function não conseguiu identificar o canal
  // (channel_name fica NULL e quebrava o cruzamento por "user_id|channel").
  const proxyRecentSince = now - ACTIVE_WINDOW_MS * 4; // ~3min
  const proxyActiveUserIds = new Set(
    (logs ?? [])
      .filter((l) => new Date(l.last_seen_at).getTime() >= proxyRecentSince)
      .map((l) => l.user_id)
      .filter((uid): uid is string => !!uid)
  );
  const activeList = onlineUsers
    .filter((s) => s.is_watching && s.channel_name)
    .filter((s) => proxyActiveUserIds.has(s.user_id));

  // Agrega histórico (30d) por usuário+canal
  const since30d = now - 30 * 24 * 60 * 60 * 1000;
  const recent = (logs ?? []).filter((l) => new Date(l.last_seen_at).getTime() >= since30d);
  const aggMap = new Map<string, {
    id: string;
    proxy_ip: string;
    user_id: string | null;
    channel: string;
    stream_host: string | null;
    requests: number;
    bytes: number;
    first: string;
    last: string;
  }>();
  recent.forEach((l) => {
    const key = `${l.user_id ?? "anon"}|${l.channel_name ?? l.stream_host ?? "?"}`;
    const prev = aggMap.get(key);
    const channel = l.channel_name ?? l.stream_host ?? "—";
    if (prev) {
      prev.requests += l.request_count;
      prev.bytes += Number(l.bytes_transferred);
      if (l.last_seen_at > prev.last) prev.last = l.last_seen_at;
      if (l.first_seen_at < prev.first) prev.first = l.first_seen_at;
    } else {
      aggMap.set(key, {
        id: key,
        proxy_ip: l.ip_address,
        user_id: l.user_id,
        channel,
        stream_host: l.stream_host,
        requests: l.request_count,
        bytes: Number(l.bytes_transferred),
        first: l.first_seen_at,
        last: l.last_seen_at,
      });
    }
  });
  const history = [...aggMap.values()].sort((a, b) => (a.last < b.last ? 1 : -1)).slice(0, 200);

  // IP real do cliente preferindo client_ipv4 das sessões (o IP do log
  // costuma ser o do nginx interno, ex.: 172.18.0.1).
  const realIpForUser = (uid: string | null, fallback: string) => {
    if (!uid) return fallback;
    const s = recentSessions?.get(uid);
    return s?.client_ipv4 || s?.client_ipv6 || fallback;
  };

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
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-md bg-primary/10 text-primary">
              <User className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Online agora</p>
              <p className="text-2xl font-bold text-foreground">{onlineUsers.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-md bg-primary/10 text-primary">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">No proxy agora</p>
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
              <p className="text-xs text-muted-foreground">IPs únicos (30d)</p>
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
              <p className="text-xs text-muted-foreground">Tráfego proxy (30d)</p>
              <p className="text-2xl font-bold text-foreground">{formatBytes(totalBytes24h)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Usuários online */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <User className="h-4 w-4 text-primary" /> Usuários online agora
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing || isLoading}
            >
              <RefreshCw className={`h-4 w-4 mr-1.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              Atualizar
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!onlineUsers.length ? (
            <p className="text-muted-foreground text-sm">Nenhum usuário online no momento.</p>
          ) : (
            <div className="space-y-2">
              {onlineUsers.map((s) => (
                <Collapsible key={s.id}>
                  <div className="rounded-lg bg-secondary">
                    <CollapsibleTrigger className="w-full flex items-center justify-between p-3 text-left hover:bg-secondary/70 transition-colors rounded-lg group">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-sm">
                          <Tv2 className="h-3.5 w-3.5 text-primary" />
                          <span className="font-medium text-foreground">
                            {s.channel_name ?? <span className="text-muted-foreground italic">sem canal</span>}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                          <span className="flex items-center gap-1"><Globe className="h-3 w-3" /> {s.client_ipv4 || s.client_ipv6 || s.ip_address}</span>
                          <span className="flex items-center gap-1"><User className="h-3 w-3" /> {getUserLabel(s.user_id)}</span>
                          <ChevronDown className="h-3 w-3 transition-transform group-data-[state=open]:rotate-180" />
                        </div>
                      </div>
                      {s.is_watching ? (
                        <Badge className="bg-primary/20 text-primary hover:bg-primary/30 border border-primary/40">
                          <span className="h-2 w-2 rounded-full bg-primary mr-1.5 animate-pulse" />
                          Assistindo
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          Online
                        </Badge>
                      )}
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="px-3 pb-3 pt-1 border-t border-border/50 space-y-1.5 text-xs">
                        <div className="grid grid-cols-[110px_1fr] gap-2">
                          <span className="text-muted-foreground">IPv4 cliente:</span>
                          <span className="font-mono text-foreground break-all">
                            {s.client_ipv4 ?? s.ip_address ?? <span className="text-muted-foreground italic">não detectado</span>}
                          </span>
                        </div>
                        <div className="grid grid-cols-[110px_1fr] gap-2">
                          <span className="text-muted-foreground">IPv6 cliente:</span>
                          <span className="font-mono text-foreground break-all">
                            {s.client_ipv6 ?? <span className="text-muted-foreground italic">sem IPv6</span>}
                          </span>
                        </div>
                        {s.started_at && (
                          <div className="grid grid-cols-[110px_1fr] gap-2">
                            <span className="text-muted-foreground">Sessão iniciada:</span>
                            <span className="text-foreground">
                              {formatDistanceToNow(new Date(s.started_at), { addSuffix: true, locale: ptBR })}
                            </span>
                          </div>
                        )}
                        {s.user_agent && (
                          <div className="grid grid-cols-[110px_1fr] gap-2">
                            <span className="text-muted-foreground">User agent:</span>
                            <span className="text-foreground break-all">{s.user_agent}</span>
                          </div>
                        )}
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sessões ativas no proxy */}
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
                <Collapsible key={l.id}>
                  <div className="rounded-lg bg-secondary">
                    <CollapsibleTrigger className="w-full flex items-center justify-between p-3 text-left hover:bg-secondary/70 transition-colors rounded-lg group">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-sm">
                          <Tv2 className="h-3.5 w-3.5 text-primary" />
                          <span className="font-medium text-foreground">{l.channel_name ?? "—"}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                          <span className="flex items-center gap-1"><Globe className="h-3 w-3" /> {l.client_ipv4 || l.client_ipv6 || l.ip_address}</span>
                          <span className="flex items-center gap-1"><User className="h-3 w-3" /> {getUserLabel(l.user_id)}</span>
                          <ChevronDown className="h-3 w-3 transition-transform group-data-[state=open]:rotate-180" />
                        </div>
                      </div>
                      <Badge className="bg-primary/20 text-primary hover:bg-primary/30 border border-primary/40">
                        <span className="h-2 w-2 rounded-full bg-primary mr-1.5 animate-pulse" />
                        Ao vivo
                      </Badge>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="px-3 pb-3 pt-1 border-t border-border/50 space-y-1.5 text-xs">
                        <div className="grid grid-cols-[110px_1fr] gap-2">
                          <span className="text-muted-foreground">IPv4 cliente:</span>
                          <span className="font-mono text-foreground break-all">
                            {l.client_ipv4 ?? <span className="text-muted-foreground italic">não detectado</span>}
                          </span>
                        </div>
                        <div className="grid grid-cols-[110px_1fr] gap-2">
                          <span className="text-muted-foreground">IPv6 cliente:</span>
                          <span className="font-mono text-foreground break-all">
                            {l.client_ipv6 ?? <span className="text-muted-foreground italic">sem IPv6</span>}
                          </span>
                        </div>
                        <div className="grid grid-cols-[110px_1fr] gap-2">
                          <span className="text-muted-foreground">IP visto no proxy:</span>
                          <span className="font-mono text-foreground break-all">{l.ip_address}</span>
                        </div>
                        {l.user_agent && (
                          <div className="grid grid-cols-[110px_1fr] gap-2">
                            <span className="text-muted-foreground">User agent:</span>
                            <span className="text-foreground break-all">{l.user_agent}</span>
                          </div>
                        )}
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Histórico 24h */}
      <Card>
        <CardHeader>
          <CardTitle>Histórico (últimos 30 dias)</CardTitle>
        </CardHeader>
        <CardContent>
          {!history.length ? (
            <p className="text-muted-foreground text-sm">Sem registros nos últimos 30 dias.</p>
          ) : (
            <div className="space-y-2">
              {history.map((row) => {
                const sess = row.user_id ? recentSessions?.get(row.user_id) : null;
                const realIp = realIpForUser(row.user_id, row.proxy_ip);
                return (
                  <Collapsible key={row.id}>
                    <div className="rounded-lg bg-secondary">
                      <CollapsibleTrigger className="w-full flex items-center justify-between p-3 text-left hover:bg-secondary/70 transition-colors rounded-lg group gap-3">
                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-sm">
                            <Tv2 className="h-3.5 w-3.5 text-primary" />
                            <span className="font-medium text-foreground truncate">{row.channel}</span>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                            <span className="flex items-center gap-1"><Globe className="h-3 w-3" /> {realIp}</span>
                            <span className="flex items-center gap-1"><User className="h-3 w-3" /> {getUserLabel(row.user_id)}</span>
                            <span>{row.requests} req</span>
                            <span>{formatBytes(row.bytes)}</span>
                            <ChevronDown className="h-3 w-3 transition-transform group-data-[state=open]:rotate-180" />
                          </div>
                        </div>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatDistanceToNow(new Date(row.last), { addSuffix: true, locale: ptBR })}
                        </span>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="px-3 pb-3 pt-1 border-t border-border/50 space-y-1.5 text-xs">
                          <div className="grid grid-cols-[140px_1fr] gap-2">
                            <span className="text-muted-foreground">IPv4 cliente:</span>
                            <span className="font-mono text-foreground break-all">
                              {sess?.client_ipv4 ?? <span className="text-muted-foreground italic">não detectado</span>}
                            </span>
                          </div>
                          <div className="grid grid-cols-[140px_1fr] gap-2">
                            <span className="text-muted-foreground">IPv6 cliente:</span>
                            <span className="font-mono text-foreground break-all">
                              {sess?.client_ipv6 ?? <span className="text-muted-foreground italic">sem IPv6</span>}
                            </span>
                          </div>
                          <div className="grid grid-cols-[140px_1fr] gap-2">
                            <span className="text-muted-foreground">IP visto no proxy:</span>
                            <span className="font-mono text-foreground break-all">{row.proxy_ip}</span>
                          </div>
                          {row.stream_host && (
                            <div className="grid grid-cols-[140px_1fr] gap-2">
                              <span className="text-muted-foreground">Origem do stream:</span>
                              <span className="font-mono text-foreground break-all">{row.stream_host}</span>
                            </div>
                          )}
                          <div className="grid grid-cols-[140px_1fr] gap-2">
                            <span className="text-muted-foreground">Requests:</span>
                            <span className="text-foreground">{row.requests}</span>
                          </div>
                          <div className="grid grid-cols-[140px_1fr] gap-2">
                            <span className="text-muted-foreground">Tráfego:</span>
                            <span className="text-foreground">{formatBytes(row.bytes)}</span>
                          </div>
                          <div className="grid grid-cols-[140px_1fr] gap-2">
                            <span className="text-muted-foreground">Primeiro acesso:</span>
                            <span className="text-foreground">
                              {formatDistanceToNow(new Date(row.first), { addSuffix: true, locale: ptBR })}
                            </span>
                          </div>
                          <div className="grid grid-cols-[140px_1fr] gap-2">
                            <span className="text-muted-foreground">Última atividade:</span>
                            <span className="text-foreground">
                              {formatDistanceToNow(new Date(row.last), { addSuffix: true, locale: ptBR })}
                            </span>
                          </div>
                          {sess?.user_agent && (
                            <div className="grid grid-cols-[140px_1fr] gap-2">
                              <span className="text-muted-foreground">User agent:</span>
                              <span className="text-foreground break-all">{sess.user_agent}</span>
                            </div>
                          )}
                        </div>
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ProxyMonitoring;
