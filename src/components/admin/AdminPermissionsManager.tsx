import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabaseLocal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Crown, Save, Trash2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { PERMISSION_GROUPS, LEGACY_ADMIN_PERMISSIONS, ALL_PERMISSIONS } from "@/lib/adminPermissions";

type AdminRow = {
  user_id: string; email: string; display_name: string | null; is_master: boolean;
  permissions: string[] | null; has_custom: boolean; preset_id: string | null;
};
type Preset = { id: string; name: string; permissions: string[] };

const db = supabase as any;

function PermissionChecklist({ value, onChange, disabled }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const toggle = (k: string) => onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k]);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {PERMISSION_GROUPS.map((g) => (
        <div key={g.group} className="rounded-md border border-border p-3 space-y-2">
          <p className="text-sm font-semibold text-foreground">{g.group}</p>
          {g.items.map((i) => (
            <label key={i.key} className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={value.includes(i.key)} onCheckedChange={() => toggle(i.key)} disabled={disabled} />
              {i.label}
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function AdminPermissionsManager({ currentUserId, isMaster }: { currentUserId: string; isMaster: boolean }) {
  const qc = useQueryClient();
  const admins = useQuery({
    queryKey: ["admin-users-perms"],
    queryFn: async () => {
      const { data, error } = await db.rpc("list_admin_users");
      if (error) throw error;
      return data as AdminRow[];
    },
  });
  const presets = useQuery({
    queryKey: ["permission-presets"],
    queryFn: async () => {
      const { data, error } = await db.from("permission_presets").select("*").order("name");
      if (error) throw error;
      return data as Preset[];
    },
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [perms, setPerms] = useState<string[]>([]);
  const [presetId, setPresetId] = useState<string | null>(null);
  const selected = admins.data?.find((a) => a.user_id === selectedId) ?? null;
  const locked = !!selected && (selected.is_master || (selected.user_id === currentUserId && !isMaster));

  useEffect(() => {
    if (!selected) return;
    setPerms(selected.is_master ? ALL_PERMISSIONS : selected.permissions ?? LEGACY_ADMIN_PERMISSIONS);
    setPresetId(selected.preset_id);
  }, [selectedId, admins.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveUser = async () => {
    if (!selected || locked) return;
    const { error } = await db.from("admin_permissions").upsert({
      user_id: selected.user_id, permissions: perms, preset_id: presetId, updated_at: new Date().toISOString(),
    });
    if (error) return toast.error("Erro ao salvar: " + error.message);
    toast.success("Permissões salvas");
    qc.invalidateQueries({ queryKey: ["admin-users-perms"] });
    qc.invalidateQueries({ queryKey: ["my-admin-permissions"] });
  };

  // Presets
  const [editingPreset, setEditingPreset] = useState<Preset | null>(null);
  const [presetName, setPresetName] = useState("");
  const [presetPerms, setPresetPerms] = useState<string[]>([]);
  const startPreset = (p: Preset | null) => {
    setEditingPreset(p ?? { id: "", name: "", permissions: [] });
    setPresetName(p?.name ?? "");
    setPresetPerms(p?.permissions ?? []);
  };
  const savePreset = async () => {
    if (!presetName.trim()) return toast.error("Informe um nome");
    const row = { name: presetName.trim(), permissions: presetPerms, updated_at: new Date().toISOString() };
    const { error } = editingPreset?.id
      ? await db.from("permission_presets").update(row).eq("id", editingPreset.id)
      : await db.from("permission_presets").insert(row);
    if (error) return toast.error("Erro: " + error.message);
    toast.success("Modelo salvo");
    setEditingPreset(null);
    qc.invalidateQueries({ queryKey: ["permission-presets"] });
  };
  const deletePreset = async (id: string) => {
    if (!confirm("Remover este modelo de permissões?")) return;
    const { error } = await db.from("permission_presets").delete().eq("id", id);
    if (error) return toast.error("Erro: " + error.message);
    qc.invalidateQueries({ queryKey: ["permission-presets"] });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" /> Administradores</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">Para adicionar um administrador, edite o usuário e marque "Administrador do painel". Depois ajuste as permissões aqui.</p>
          <div className="flex flex-wrap gap-2">
            {admins.data?.map((a) => (
              <Button key={a.user_id} size="sm" variant={selectedId === a.user_id ? "default" : "outline"} onClick={() => setSelectedId(a.user_id)}>
                {a.is_master && <Crown className="h-4 w-4 mr-1" />}
                {a.display_name || a.email}
              </Button>
            ))}
            {admins.isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}
          </div>

          {selected && (
            <div className="space-y-4 border-t border-border pt-4">
              <div>
                <p className="font-semibold text-foreground">{selected.display_name || selected.email}</p>
                <p className="text-xs text-muted-foreground">{selected.email}</p>
                {selected.is_master && <p className="text-sm text-primary mt-1">Usuário master — acesso total, não pode ser alterado.</p>}
                {!selected.is_master && locked && <p className="text-sm text-muted-foreground mt-1">Você não pode alterar suas próprias permissões.</p>}
                {!selected.is_master && !selected.has_custom && <p className="text-xs text-muted-foreground mt-1">Sem permissões personalizadas: acesso total, exceto remover canais e gerenciar administradores.</p>}
              </div>
              {!locked && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm">Aplicar modelo:</span>
                  {presets.data?.map((p) => (
                    <Button key={p.id} size="sm" variant={presetId === p.id ? "default" : "secondary"} onClick={() => { setPerms(p.permissions); setPresetId(p.id); }}>
                      {p.name}
                    </Button>
                  ))}
                  {!presets.data?.length && <span className="text-xs text-muted-foreground">Nenhum modelo criado</span>}
                </div>
              )}
              <PermissionChecklist value={perms} onChange={(v) => { setPerms(v); setPresetId(null); }} disabled={locked} />
              {!locked && <Button onClick={saveUser}><Save className="h-4 w-4 mr-1" /> Salvar permissões</Button>}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Modelos de permissões</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {presets.data?.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-md border border-border p-2">
                <span className="text-sm">{p.name} <span className="text-xs text-muted-foreground">({p.permissions.length} permissões)</span></span>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => startPreset(p)}>Editar</Button>
                  <Button size="sm" variant="ghost" onClick={() => deletePreset(p.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              </div>
            ))}
          </div>
          {editingPreset ? (
            <div className="space-y-3 border-t border-border pt-4">
              <Input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Nome do modelo (ex.: Suporte, Técnico)" />
              <PermissionChecklist value={presetPerms} onChange={setPresetPerms} />
              <div className="flex gap-2">
                <Button onClick={savePreset}><Save className="h-4 w-4 mr-1" /> Salvar modelo</Button>
                <Button variant="outline" onClick={() => setEditingPreset(null)}>Cancelar</Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" onClick={() => startPreset(null)}>Novo modelo</Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
