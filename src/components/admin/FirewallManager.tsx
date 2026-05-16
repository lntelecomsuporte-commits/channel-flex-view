import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabaseLocal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield, ShieldOff, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

type Rule = {
  id: string;
  action: "deny" | "allow";
  target: string | null;
  port: string | null;
  proto: string | null;
  direction: string | null;
  note: string | null;
  is_active: boolean;
  applied_at: string | null;
  created_at: string;
  source: string | null;
};

const FirewallManager = () => {
  const qc = useQueryClient();
  const [action, setAction] = useState<"deny" | "allow">("deny");
  const [target, setTarget] = useState("");
  const [port, setPort] = useState("");
  const [proto, setProto] = useState<"" | "tcp" | "udp">("");
  const [note, setNote] = useState("");

  const { data: rules } = useQuery({
    queryKey: ["firewall-rules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("firewall_rules" as any)
        .select("*")
        .order("action", { ascending: true })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Rule[];
    },
    refetchInterval: 15_000,
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const t = target.trim();
      const p = port.trim();
      if (!t && !p) throw new Error("Informe IP/CIDR ou porta");
      const { error } = await supabase.from("firewall_rules" as any).insert({
        action,
        target: t || null,
        port: p || null,
        proto: proto || null,
        direction: "in",
        note: note.trim() || null,
        is_active: true,
        source: "panel",
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Regra adicionada — aplicada no servidor em até 1min");
      setTarget(""); setPort(""); setProto(""); setNote("");
      qc.invalidateQueries({ queryKey: ["firewall-rules"] });
    },
    onError: (e: any) => toast.error(e.message || "Erro ao adicionar"),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("firewall_rules" as any).update({ is_active } as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["firewall-rules"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("firewall_rules" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Regra removida — removida do servidor em até 1min");
      qc.invalidateQueries({ queryKey: ["firewall-rules"] });
    },
  });

  const denyRules = (rules ?? []).filter((r) => r.action === "deny");
  const allowRules = (rules ?? []).filter((r) => r.action === "allow");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" /> Firewall — UFW
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200 flex gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              Regras ficam no banco. <code className="text-amber-100">sync-firewall.sh</code> (cron a cada 1 min)
              espelha pro UFW. Tudo que você adicionar/remover aqui reflete no servidor automaticamente.
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-[120px_1fr_120px_100px_1fr_auto] gap-3 items-end">
            <div>
              <label className="text-xs text-muted-foreground">Ação</label>
              <Select value={action} onValueChange={(v) => setAction(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="deny">🚫 Bloquear</SelectItem>
                  <SelectItem value="allow">✅ Liberar</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 md:col-span-1">
              <label className="text-xs text-muted-foreground">IP / CIDR (origem)</label>
              <Input placeholder="187.49.143.68 ou 24.152.0.0/16 (vazio = any)"
                value={target} onChange={(e) => setTarget(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Porta</label>
              <Input placeholder="ex.: 22" value={port} onChange={(e) => setPort(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Protocolo</label>
              <Select value={proto || "any"} onValueChange={(v) => setProto(v === "any" ? "" : (v as any))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">qualquer</SelectItem>
                  <SelectItem value="tcp">tcp</SelectItem>
                  <SelectItem value="udp">udp</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 md:col-span-1">
              <label className="text-xs text-muted-foreground">Nota</label>
              <Input placeholder="Motivo (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <Button onClick={() => addMutation.mutate()} disabled={addMutation.isPending}>
              Adicionar
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldOff className="h-4 w-4 text-destructive" /> Bloqueios ({denyRules.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {denyRules.length === 0 && <p className="text-sm text-muted-foreground">Nenhum bloqueio.</p>}
            {denyRules.map((r) => (
              <RuleRow key={r.id} r={r}
                onToggle={(v) => toggleMutation.mutate({ id: r.id, is_active: v })}
                onDelete={() => deleteMutation.mutate(r.id)} />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4 text-emerald-400" /> Liberações ({allowRules.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {allowRules.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma liberação.</p>}
            {allowRules.map((r) => (
              <RuleRow key={r.id} r={r}
                onToggle={(v) => toggleMutation.mutate({ id: r.id, is_active: v })}
                onDelete={() => deleteMutation.mutate(r.id)} />
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

const describeRule = (r: Rule) => {
  const parts: string[] = [];
  if (r.port) parts.push(`porta ${r.port}${r.proto ? "/" + r.proto : ""}`);
  if (r.target) parts.push(`de ${r.target}`);
  else if (r.port) parts.push("de qualquer origem");
  return parts.join(" ") || r.target || "—";
};

const RuleRow = ({ r, onToggle, onDelete }: { r: Rule; onToggle: (v: boolean) => void; onDelete: () => void }) => (
  <div className="flex items-center justify-between p-2 rounded bg-secondary/50 gap-2">
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2 flex-wrap">
        <code className="font-mono text-sm text-foreground">{describeRule(r)}</code>
        {r.is_active ? (
          <Badge variant="default" className="text-[10px]">ativo</Badge>
        ) : (
          <Badge variant="outline" className="text-[10px]">pausado</Badge>
        )}
        {r.source === "imported" && <Badge variant="outline" className="text-[10px]">importada do ufw</Badge>}
        {r.applied_at && (
          <span className="text-[10px] text-muted-foreground">
            aplicado {formatDistanceToNow(new Date(r.applied_at), { addSuffix: true, locale: ptBR })}
          </span>
        )}
      </div>
      {r.note && <p className="text-xs text-muted-foreground truncate">{r.note}</p>}
    </div>
    <div className="flex gap-1 shrink-0">
      <Button size="sm" variant="ghost" onClick={() => onToggle(!r.is_active)}>
        {r.is_active ? "Pausar" : "Ativar"}
      </Button>
      <Button size="sm" variant="ghost" onClick={onDelete}>
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  </div>
);

export default FirewallManager;
