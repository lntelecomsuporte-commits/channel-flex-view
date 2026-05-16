import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabaseLocal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield, ShieldOff, Trash2, RefreshCw, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

type Rule = {
  id: string;
  action: "deny" | "allow";
  target: string;
  note: string | null;
  is_active: boolean;
  applied_at: string | null;
  created_at: string;
};

const isValidTarget = (t: string) => {
  const s = t.trim();
  // IPv4 simples ou CIDR
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
  // IPv6 (genérico)
  const ipv6 = /^[0-9a-fA-F:]+(\/\d{1,3})?$/;
  return ipv4.test(s) || (ipv6.test(s) && s.includes(":"));
};

const FirewallManager = () => {
  const qc = useQueryClient();
  const [action, setAction] = useState<"deny" | "allow">("deny");
  const [target, setTarget] = useState("");
  const [note, setNote] = useState("");

  const { data: rules, isLoading } = useQuery({
    queryKey: ["firewall-rules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("firewall_rules" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Rule[];
    },
    refetchInterval: 15_000,
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const t = target.trim();
      if (!isValidTarget(t)) throw new Error("IP ou CIDR inválido");
      const { error } = await supabase.from("firewall_rules" as any).insert({
        action,
        target: t,
        note: note.trim() || null,
        is_active: true,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Regra adicionada — será aplicada no próximo ciclo do firewall (≤1min)");
      setTarget("");
      setNote("");
      qc.invalidateQueries({ queryKey: ["firewall-rules"] });
    },
    onError: (e: any) => toast.error(e.message || "Erro ao adicionar regra"),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from("firewall_rules" as any)
        .update({ is_active } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["firewall-rules"] }),
    onError: (e: any) => toast.error(e.message || "Erro"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("firewall_rules" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Regra removida");
      qc.invalidateQueries({ queryKey: ["firewall-rules"] });
    },
    onError: (e: any) => toast.error(e.message || "Erro"),
  });

  const denyRules = (rules ?? []).filter((r) => r.action === "deny");
  const allowRules = (rules ?? []).filter((r) => r.action === "allow");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" /> Firewall — Bloqueio/Liberação de IPs
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200 flex gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              As regras ficam no banco. Um script no host (<code className="text-amber-100">sync-firewall.sh</code> via cron) aplica via <code>ufw</code> a cada minuto.
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[140px_1fr_1fr_auto] gap-3 items-end">
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
            <div>
              <label className="text-xs text-muted-foreground">IP ou CIDR</label>
              <Input
                placeholder="187.49.143.68 ou 24.152.0.0/16"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Nota (opcional)</label>
              <Input
                placeholder="Motivo / referência"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <Button onClick={() => addMutation.mutate()} disabled={!target.trim() || addMutation.isPending}>
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
              <RuleRow key={r.id} r={r} onToggle={(v) => toggleMutation.mutate({ id: r.id, is_active: v })} onDelete={() => deleteMutation.mutate(r.id)} />
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
            {allowRules.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma liberação explícita.</p>}
            {allowRules.map((r) => (
              <RuleRow key={r.id} r={r} onToggle={(v) => toggleMutation.mutate({ id: r.id, is_active: v })} onDelete={() => deleteMutation.mutate(r.id)} />
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

const RuleRow = ({ r, onToggle, onDelete }: { r: Rule; onToggle: (v: boolean) => void; onDelete: () => void }) => (
  <div className="flex items-center justify-between p-2 rounded bg-secondary/50">
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <code className="font-mono text-sm text-foreground">{r.target}</code>
        {r.is_active ? (
          <Badge variant="default" className="text-[10px]">ativo</Badge>
        ) : (
          <Badge variant="outline" className="text-[10px]">pausado</Badge>
        )}
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
