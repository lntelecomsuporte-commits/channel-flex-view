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
  target: string | null;       // src ip/cidr
  src_port: string | null;
  dest_target: string | null;  // dest ip/cidr
  port: string | null;         // dest port
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
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [srcIp, setSrcIp] = useState("");
  const [srcPort, setSrcPort] = useState("");
  const [destIp, setDestIp] = useState("");
  const [destPort, setDestPort] = useState("");
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
      if (!srcIp.trim() && !srcPort.trim() && !destIp.trim() && !destPort.trim()) {
        throw new Error("Informe pelo menos um campo (IP ou porta)");
      }
      const { error } = await supabase.from("firewall_rules" as any).insert({
        action,
        direction,
        target: srcIp.trim() || null,
        src_port: srcPort.trim() || null,
        dest_target: destIp.trim() || null,
        port: destPort.trim() || null,
        proto: proto || null,
        note: note.trim() || null,
        is_active: true,
        source: "panel",
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Regra adicionada — aplicada no servidor em até 1min");
      setSrcIp(""); setSrcPort(""); setDestIp(""); setDestPort(""); setProto(""); setNote("");
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
              Regras ficam no banco. <code className="text-amber-100">sync-firewall.sh</code> (cron 1 min)
              espelha pro UFW. Campos vazios viram <code>any</code>.
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
              <label className="text-xs text-muted-foreground">Direção</label>
              <Select value={direction} onValueChange={(v) => setDirection(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="in">Entrada (in)</SelectItem>
                  <SelectItem value="out">Saída (out)</SelectItem>
                </SelectContent>
              </Select>
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
            <div>
              <label className="text-xs text-muted-foreground">Nota</label>
              <Input placeholder="Motivo (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-md border border-border p-3 space-y-2">
              <div className="text-xs font-semibold text-muted-foreground uppercase">Origem (from)</div>
              <div className="grid grid-cols-[1fr_120px] gap-2">
                <Input placeholder="IP / CIDR (ex: 187.49.0.0/16)" value={srcIp} onChange={(e) => setSrcIp(e.target.value)} />
                <Input placeholder="porta" value={srcPort} onChange={(e) => setSrcPort(e.target.value)} />
              </div>
            </div>
            <div className="rounded-md border border-border p-3 space-y-2">
              <div className="text-xs font-semibold text-muted-foreground uppercase">Destino (to)</div>
              <div className="grid grid-cols-[1fr_120px] gap-2">
                <Input placeholder="IP / CIDR (vazio = any)" value={destIp} onChange={(e) => setDestIp(e.target.value)} />
                <Input placeholder="porta (ex: 443)" value={destPort} onChange={(e) => setDestPort(e.target.value)} />
              </div>
            </div>
          </div>

          <Button onClick={() => addMutation.mutate()} disabled={addMutation.isPending} className="w-full md:w-auto">
            Adicionar regra
          </Button>
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
  const from = r.target || "any";
  const fromP = r.src_port ? `:${r.src_port}` : "";
  const to = r.dest_target || "any";
  const toP = r.port ? `:${r.port}` : "";
  const proto = r.proto ? ` ${r.proto}` : "";
  const dir = r.direction === "out" ? "→ saída" : "← entrada";
  return `${dir}${proto}  ${from}${fromP}  →  ${to}${toP}`;
};

const RuleRow = ({ r, onToggle, onDelete }: { r: Rule; onToggle: (v: boolean) => void; onDelete: () => void }) => (
  <div className="flex items-center justify-between p-2 rounded bg-secondary/50 gap-2">
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2 flex-wrap">
        <code className="font-mono text-xs text-foreground">{describeRule(r)}</code>
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
