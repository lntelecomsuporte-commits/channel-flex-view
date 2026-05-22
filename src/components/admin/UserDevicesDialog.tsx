import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseLocal";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Trash2, ShieldOff, ShieldCheck, Plus, Smartphone, Tv2, Pencil, Check, X, Wifi, MonitorSmartphone } from "lucide-react";

type Device = {
  id: string;
  user_id: string;
  device_id: string;
  platform: "android" | "roku";
  device_name: string | null;
  device_label: string | null;
  app_version: string | null;
  last_ip: string | null;
  first_login_at: string;
  last_seen_at: string;
  created_by: "self_register" | "admin_manual";
  is_active: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId: string;
  userLabel: string;
};

function fmt(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("pt-BR");
}

function maskDeviceId(id: string) {
  if (!id) return "";
  return id.length > 12 ? id.slice(0, 4) + "…" + id.slice(-6) : id;
}

type ActiveSession = {
  id: string;
  device_id: string | null;
  platform: string | null;
  user_agent: string | null;
  last_heartbeat_at: string;
  current_channel_name: string | null;
  client_ipv4: string | null;
  client_ipv6: string | null;
};

export function UserDevicesDialog({ open, onOpenChange, userId, userLabel }: Props) {
  const [loading, setLoading] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [limit, setLimit] = useState<number | null>(null);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState("");

  const [addOpen, setAddOpen] = useState(false);
  const [addPlatform, setAddPlatform] = useState<"android" | "roku">("android");
  const [addDeviceId, setAddDeviceId] = useState("");
  const [addLabel, setAddLabel] = useState("");
  const [adding, setAdding] = useState(false);

  const reload = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("user_devices")
      .select("*")
      .eq("user_id", userId)
      .order("last_seen_at", { ascending: false });
    if (error) toast.error("Erro: " + error.message);
    setDevices((data as Device[]) || []);
    const { data: lim } = await supabase.rpc("resolve_device_limit", { _user_id: userId });
    setLimit(typeof lim === "number" ? lim : null);
    setLoading(false);
  };

  useEffect(() => {
    if (open) void reload();
  }, [open, userId]);

  const toggleActive = async (d: Device) => {
    const { error } = await supabase
      .from("user_devices")
      .update({ is_active: !d.is_active })
      .eq("id", d.id);
    if (error) return toast.error("Erro: " + error.message);
    toast.success(d.is_active ? "Dispositivo bloqueado" : "Dispositivo desbloqueado");
    void reload();
  };

  const removeDevice = async (d: Device) => {
    if (!confirm(`Remover ${d.device_label || d.device_name || maskDeviceId(d.device_id)}? O cliente terá que logar novamente.`)) return;
    const { error } = await supabase.from("user_devices").delete().eq("id", d.id);
    if (error) return toast.error("Erro: " + error.message);
    toast.success("Dispositivo removido");
    void reload();
  };

  const saveLabel = async (d: Device) => {
    const newLabel = labelDraft.trim() || null;
    const { error } = await supabase
      .from("user_devices")
      .update({ device_label: newLabel })
      .eq("id", d.id);
    if (error) return toast.error("Erro: " + error.message);
    setEditingLabelId(null);
    void reload();
  };

  const addManual = async () => {
    const clean = addDeviceId.replace(/[^a-zA-Z0-9]/g, "");
    if (clean.length < 6) {
      toast.error("Código do dispositivo inválido");
      return;
    }
    setAdding(true);
    const { error } = await supabase.from("user_devices").insert({
      user_id: userId,
      device_id: clean,
      platform: addPlatform,
      device_label: addLabel.trim() || null,
      created_by: "admin_manual",
      is_active: true,
    });
    setAdding(false);
    if (error) return toast.error("Erro: " + error.message);
    toast.success("Dispositivo cadastrado");
    setAddDeviceId("");
    setAddLabel("");
    setAddOpen(false);
    void reload();
  };

  const activeCount = devices.filter((d) => d.is_active).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Dispositivos · {userLabel}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-sm text-muted-foreground">
              {activeCount} ativo(s)
              {limit !== null && ` / limite: ${limit === 0 ? "ilimitado" : limit}`}
            </p>
            <Button size="sm" onClick={() => setAddOpen((v) => !v)}>
              <Plus className="h-4 w-4 mr-1" /> Cadastrar manualmente
            </Button>
          </div>

          {addOpen && (
            <div className="rounded-md border border-border p-3 space-y-3 bg-secondary/30">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Plataforma</Label>
                  <Select value={addPlatform} onValueChange={(v) => setAddPlatform(v as any)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="android">Android (APK)</SelectItem>
                      <SelectItem value="roku">Roku</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Rótulo (opcional)</Label>
                  <Input
                    value={addLabel}
                    onChange={(e) => setAddLabel(e.target.value)}
                    placeholder="Ex: TV da sala"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Código do dispositivo</Label>
                <Input
                  value={addDeviceId}
                  onChange={(e) => setAddDeviceId(e.target.value)}
                  placeholder="Cole o código que o cliente enviou (ex: A1B2-C3D4-E5F6)"
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Aceita com ou sem hífens. Pode conter mais caracteres — é normalizado.
                </p>
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => setAddOpen(false)}>
                  Cancelar
                </Button>
                <Button size="sm" onClick={addManual} disabled={adding}>
                  {adding ? "Cadastrando..." : "Cadastrar"}
                </Button>
              </div>
            </div>
          )}

          {loading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : devices.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum dispositivo vinculado.</p>
          ) : (
            <div className="space-y-2 max-h-[55vh] overflow-y-auto">
              {devices.map((d) => (
                <div
                  key={d.id}
                  className={`rounded-md border p-3 flex items-start justify-between gap-3 ${
                    d.is_active ? "border-border bg-card" : "border-destructive/40 bg-destructive/5 opacity-70"
                  }`}
                >
                  <div className="flex items-start gap-2 min-w-0 flex-1">
                    {d.platform === "android" ? (
                      <Smartphone className="h-5 w-5 mt-0.5 text-primary shrink-0" />
                    ) : (
                      <Tv2 className="h-5 w-5 mt-0.5 text-primary shrink-0" />
                    )}
                    <div className="min-w-0 flex-1 space-y-0.5">
                      {editingLabelId === d.id ? (
                        <div className="flex items-center gap-1">
                          <Input
                            value={labelDraft}
                            onChange={(e) => setLabelDraft(e.target.value)}
                            className="h-7 text-sm"
                            placeholder="Rótulo"
                            autoFocus
                          />
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => saveLabel(d)}>
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingLabelId(null)}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="font-medium text-foreground">
                            {d.device_label || d.device_name || maskDeviceId(d.device_id)}
                          </span>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            onClick={() => {
                              setEditingLabelId(d.id);
                              setLabelDraft(d.device_label || "");
                            }}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          {d.created_by === "admin_manual" && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-400">
                              manual
                            </span>
                          )}
                          {!d.is_active && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/20 text-destructive">
                              bloqueado
                            </span>
                          )}
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground font-mono break-all">
                        {d.platform} · {maskDeviceId(d.device_id)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Último acesso: {fmt(d.last_seen_at)}
                        {d.last_ip && ` · IP ${d.last_ip}`}
                      </p>
                      {d.app_version && (
                        <p className="text-xs text-muted-foreground">App: {d.app_version}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => toggleActive(d)}
                      title={d.is_active ? "Bloquear" : "Desbloquear"}
                    >
                      {d.is_active ? (
                        <ShieldOff className="h-4 w-4 text-destructive" />
                      ) : (
                        <ShieldCheck className="h-4 w-4 text-primary" />
                      )}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => removeDevice(d)} title="Remover">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
