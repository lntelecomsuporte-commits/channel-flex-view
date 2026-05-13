import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseLocal";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Plus, Trash2, ShieldOff, ShieldCheck, Pencil, LogOut, Download } from "lucide-react";
import { useCategories } from "@/hooks/useChannels";
import { UserStatusBadge } from "./UserStatusBadge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type AccessStats = {
  user_id: string;
  last_login_at: string | null;
  total_logins: number;
  logins_last_30d: number;
};

function useProfiles() {
  return useQuery({
    queryKey: ["profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

function useAccessStats() {
  return useQuery({
    queryKey: ["user_access_stats"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("user_access_stats")
        .select("user_id,last_login_at,total_logins,logins_last_30d");
      if (error) throw error;
      return (data || []) as AccessStats[];
    },
    refetchInterval: 60000,
  });
}

type SortMode = "recent" | "last_login_desc" | "last_login_asc" | "email_asc" | "name_asc" | "logins_30d_desc";

type Profile = {
  id: string;
  user_id: string;
  username: string | null;
  display_name: string | null;
  is_blocked: boolean;
  is_active: boolean;
  hubsoft_client_id: string | null;
};

const UserManagement = () => {
  const { data: profiles, isLoading } = useProfiles();
  const { data: accessStats } = useAccessStats();
  const { data: categories } = useCategories();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ email: "", password: "", display_name: "" });
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [editingUser, setEditingUser] = useState<Profile | null>(null);
  const [editForm, setEditForm] = useState({ password: "", display_name: "", adult_pin: "" });
  const [editCategories, setEditCategories] = useState<string[]>([]);
  const [editIsAdmin, setEditIsAdmin] = useState(false);
  const [editWasAdmin, setEditWasAdmin] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [searchTerm, setSearchTerm] = useState("");

  const statsByUser = new Map<string, AccessStats>();
  (accessStats || []).forEach((s) => statsByUser.set(s.user_id, s));

  const fmtDate = (iso: string | null) => {
    if (!iso) return "Nunca";
    return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  };

  const sortedProfiles = (() => {
    if (!profiles) return [];
    const term = searchTerm.trim().toLowerCase();
    const list = profiles.filter((p: any) => {
      if (!term) return true;
      return (
        (p.username || "").toLowerCase().includes(term) ||
        (p.display_name || "").toLowerCase().includes(term)
      );
    });
    const ts = (p: any) => {
      const t = statsByUser.get(p.user_id)?.last_login_at;
      return t ? new Date(t).getTime() : 0;
    };
    const cmp: Record<SortMode, (a: any, b: any) => number> = {
      recent: (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      last_login_desc: (a, b) => ts(b) - ts(a),
      last_login_asc: (a, b) => {
        const ta = ts(a), tb = ts(b);
        if (ta === 0 && tb === 0) return 0;
        if (ta === 0) return 1;
        if (tb === 0) return -1;
        return ta - tb;
      },
      email_asc: (a, b) => (a.username || "").localeCompare(b.username || ""),
      name_asc: (a, b) => (a.display_name || a.username || "").localeCompare(b.display_name || b.username || ""),
      logins_30d_desc: (a, b) =>
        (statsByUser.get(b.user_id)?.logins_last_30d || 0) -
        (statsByUser.get(a.user_id)?.logins_last_30d || 0),
    };
    return [...list].sort(cmp[sortMode]);
  })();

  const neverAccessed = (profiles || []).filter(
    (p: any) => (statsByUser.get(p.user_id)?.total_logins || 0) === 0
  );

  const downloadCsv = (filename: string, rows: string[][]) => {
    const csv = rows
      .map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportNeverAccessed = () => {
    const rows = [["Email", "Nome", "Criado em"]];
    neverAccessed.forEach((p: any) =>
      rows.push([p.username || "", p.display_name || "", fmtDate(p.created_at)])
    );
    downloadCsv(`usuarios-nunca-acessaram-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    toast.success(`${neverAccessed.length} usuários exportados`);
  };

  const exportAccess30d = () => {
    const rows = [["Email", "Nome", "Acessos 30d", "Total acessos", "Último acesso"]];
    (profiles || [])
      .map((p: any) => ({ p, s: statsByUser.get(p.user_id) }))
      .sort((a, b) => (b.s?.logins_last_30d || 0) - (a.s?.logins_last_30d || 0))
      .forEach(({ p, s }) =>
        rows.push([
          p.username || "",
          p.display_name || "",
          String(s?.logins_last_30d || 0),
          String(s?.total_logins || 0),
          fmtDate(s?.last_login_at || null),
        ])
      );
    downloadCsv(`relatorio-acessos-30d-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    toast.success("Relatório exportado");
  };

  // Load user categories when editing
  useEffect(() => {
    if (!editingUser) return;
    supabase
      .from("user_category_access")
      .select("category_id")
      .eq("user_id", editingUser.user_id)
      .eq("is_active", true)
      .then(({ data }) => {
        setEditCategories(data?.map((d) => d.category_id) || []);
      });
  }, [editingUser]);

  const toggleCategory = (id: string, list: string[], setList: (v: string[]) => void) => {
    setList(list.includes(id) ? list.filter((c) => c !== id) : [...list, id]);
  };

  const saveCategoryAccess = async (userId: string, categoryIds: string[]) => {
    // Remove existing manual access (no hubsoft_config_id)
    await supabase
      .from("user_category_access")
      .delete()
      .eq("user_id", userId)
      .is("hubsoft_config_id", null);

    if (categoryIds.length > 0) {
      const rows = categoryIds.map((category_id) => ({
        user_id: userId,
        category_id,
        is_active: true,
      }));
      await supabase.from("user_category_access").insert(rows);
    }
  };

  const handleCreate = async () => {
    if (saving) return;
    if (!form.email || !form.password) {
      toast.error("Preencha email e senha");
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.functions.invoke("manage-users", {
      body: { action: "create", email: form.email, password: form.password, display_name: form.display_name || form.email },
    });
    setSaving(false);
    if (error || data?.error) {
      toast.error("Erro ao criar usuário: " + (data?.error || error?.message));
    } else {
      // Save category access for the new user
      if (data?.user_id && selectedCategories.length > 0) {
        await saveCategoryAccess(data.user_id, selectedCategories);
      }
      toast.success("Usuário criado!");
      setForm({ email: "", password: "", display_name: "" });
      setSelectedCategories([]);
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
    }
  };

  const handleEdit = async (profile: Profile) => {
    setEditingUser(profile);
    const { data } = await supabase
      .from("profiles")
      .select("adult_pin")
      .eq("user_id", profile.user_id)
      .maybeSingle();
    setEditForm({ password: "", display_name: profile.display_name || "", adult_pin: (data as any)?.adult_pin || "" });
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("id")
      .eq("user_id", profile.user_id)
      .eq("role", "admin")
      .maybeSingle();
    const isAdmin = !!roleRow;
    setEditIsAdmin(isAdmin);
    setEditWasAdmin(isAdmin);
  };

  const handleUpdate = async () => {
    if (!editingUser) return;
    setUpdating(true);

    // Só chama o edge function se senha mudou OU display_name foi alterado de fato
    const displayNameChanged =
      editForm.display_name.trim() !== (editingUser.display_name || "").trim();
    const passwordChanged = editForm.password.length > 0;

    if (passwordChanged || displayNameChanged) {
      const body: Record<string, string> = { action: "update", user_id: editingUser.user_id };
      if (passwordChanged) body.password = editForm.password;
      if (displayNameChanged) body.display_name = editForm.display_name;
      const { data, error } = await supabase.functions.invoke("manage-users", { body });
      if (error || data?.error) {
        toast.error("Erro ao atualizar: " + (data?.error || error?.message));
        setUpdating(false);
        return;
      }
    }

    // Update adult_pin if provided
    if (editForm.adult_pin) {
      if (!/^\d{4,8}$/.test(editForm.adult_pin)) {
        toast.error("PIN parental deve ter 4 a 8 dígitos numéricos");
        setUpdating(false);
        return;
      }
      const { error: pinErr } = await supabase
        .from("profiles")
        .update({ adult_pin: editForm.adult_pin })
        .eq("user_id", editingUser.user_id);
      if (pinErr) {
        toast.error("Erro ao atualizar PIN: " + pinErr.message);
        setUpdating(false);
        return;
      }
    }

    // Always save category access
    await saveCategoryAccess(editingUser.user_id, editCategories);

    setUpdating(false);
    toast.success("Usuário atualizado!");
    setEditingUser(null);
    queryClient.invalidateQueries({ queryKey: ["profiles"] });
  };

  const handleToggleBlock = async (profileId: string, currentBlocked: boolean) => {
    // Ao bloquear, também força logout remoto imediato
    const updates: { is_blocked: boolean; force_signout_at?: string } = { is_blocked: !currentBlocked };
    if (!currentBlocked) updates.force_signout_at = new Date().toISOString();
    const { error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", profileId);
    if (error) {
      toast.error("Erro: " + error.message);
      return;
    }
    toast.success(currentBlocked ? "Usuário desbloqueado" : "Usuário bloqueado e deslogado");
    queryClient.invalidateQueries({ queryKey: ["profiles"] });
  };

  const handleDelete = async (profileId: string, userId: string) => {
    if (deletingUserId) return;
    setDeletingUserId(userId);
    // Força signout antes de deletar — garante que sessão ativa seja encerrada
    await supabase
      .from("profiles")
      .update({ force_signout_at: new Date().toISOString() })
      .eq("id", profileId);
    const { data, error } = await supabase.functions.invoke("manage-users", {
      body: { action: "delete", user_id: userId },
    });
    setDeletingUserId(null);
    if (error || data?.error) {
      toast.error("Erro: " + (data?.error || error?.message));
    } else {
      toast.success("Usuário excluído");
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
    }
  };

  const handleForceSignout = async (profileId: string, displayName: string | null) => {
    const { error } = await supabase
      .from("profiles")
      .update({ force_signout_at: new Date().toISOString() })
      .eq("id", profileId);
    if (error) {
      toast.error("Erro ao deslogar: " + error.message);
      return;
    }
    toast.success(`${displayName || "Usuário"} será deslogado em até 30s`);
    queryClient.invalidateQueries({ queryKey: ["profiles"] });
  };

  const CategoryCheckboxes = ({ selected, onToggle }: { selected: string[]; onToggle: (id: string) => void }) => (
    <div className="space-y-2">
      <Label>Categorias de Acesso</Label>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-40 overflow-y-auto border rounded-md p-2">
        {categories?.length ? categories.map((cat) => (
          <label key={cat.id} className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={selected.includes(cat.id)}
              onCheckedChange={() => onToggle(cat.id)}
            />
            {cat.name}
          </label>
        )) : (
          <p className="text-xs text-muted-foreground col-span-full">Nenhuma categoria cadastrada</p>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Novo Usuário</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Email <span className="text-destructive">*</span></Label>
              <Input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="usuario@email.com" />
            </div>
            <div className="space-y-2">
              <Label>Senha <span className="text-destructive">*</span></Label>
              <Input type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder="Senha" />
            </div>
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={form.display_name} onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))} placeholder="Nome de exibição" />
            </div>
          </div>
          <CategoryCheckboxes
            selected={selectedCategories}
            onToggle={(id) => toggleCategory(id, selectedCategories, setSelectedCategories)}
          />
          <Button onClick={handleCreate} disabled={saving}>
            <Plus className="h-4 w-4 mr-1" /> {saving ? "Criando..." : "Criar Usuário"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Relatórios de Acesso</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="p-3 rounded-lg bg-secondary">
              <p className="text-xs text-muted-foreground">Total de usuários</p>
              <p className="text-2xl font-bold">{profiles?.length || 0}</p>
            </div>
            <div className="p-3 rounded-lg bg-secondary">
              <p className="text-xs text-muted-foreground">Nunca acessaram</p>
              <p className="text-2xl font-bold text-destructive">{neverAccessed.length}</p>
            </div>
            <div className="p-3 rounded-lg bg-secondary">
              <p className="text-xs text-muted-foreground">Ativos (30d)</p>
              <p className="text-2xl font-bold text-primary">
                {(accessStats || []).filter((s) => (s.logins_last_30d || 0) > 0).length}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-secondary">
              <p className="text-xs text-muted-foreground">Acessos nos últimos 30d</p>
              <p className="text-2xl font-bold">
                {(accessStats || []).reduce((acc, s) => acc + (s.logins_last_30d || 0), 0)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={exportNeverAccessed} disabled={!neverAccessed.length}>
              <Download className="h-4 w-4 mr-1" /> Exportar nunca acessaram ({neverAccessed.length})
            </Button>
            <Button variant="outline" size="sm" onClick={exportAccess30d}>
              <Download className="h-4 w-4 mr-1" /> Exportar acessos 30 dias
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Usuários Cadastrados</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row gap-2 mb-4">
            <Input
              placeholder="Buscar por nome ou email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="md:max-w-xs"
            />
            <Select value={sortMode} onValueChange={(v) => setSortMode(v as SortMode)}>
              <SelectTrigger className="md:w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">Mais recentes (cadastro)</SelectItem>
                <SelectItem value="last_login_desc">Último online (mais recente)</SelectItem>
                <SelectItem value="last_login_asc">Último online (mais antigo)</SelectItem>
                <SelectItem value="email_asc">E-mail (A → Z)</SelectItem>
                <SelectItem value="name_asc">Nome (A → Z)</SelectItem>
                <SelectItem value="logins_30d_desc">Mais acessos (30d)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {isLoading ? (
            <p className="text-muted-foreground">Carregando...</p>
          ) : !sortedProfiles.length ? (
            <p className="text-muted-foreground">Nenhum usuário encontrado</p>
          ) : (
            <div className="space-y-2">
              {sortedProfiles.map((p: any) => {
                const s = statsByUser.get(p.user_id);
                return (
                <div key={p.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground truncate">{p.display_name || p.username}</p>
                    <p className="text-xs text-muted-foreground truncate">{p.username}</p>
                    <p className="text-xs text-muted-foreground">
                      Último online: {fmtDate(s?.last_login_at || null)}
                      {" · "}
                      {s?.logins_last_30d || 0} acessos (30d)
                      {" · "}
                      total {s?.total_logins || 0}
                    </p>
                    {p.hubsoft_client_id && (
                      <p className="text-xs text-muted-foreground">Hubsoft ID: {p.hubsoft_client_id}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <UserStatusBadge userId={p.user_id} />
                    <span className={`text-xs px-2 py-0.5 rounded ${p.is_blocked ? "bg-destructive/20 text-destructive" : p.is_active ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>
                      {p.is_blocked ? "Bloqueado" : p.is_active ? "Ativo" : "Inativo"}
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => handleEdit(p as Profile)} title="Editar">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleForceSignout(p.id, p.display_name)} title="Deslogar usuário (forçar logout remoto)">
                      <LogOut className="h-4 w-4 text-amber-500" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleToggleBlock(p.id, p.is_blocked)} title={p.is_blocked ? "Desbloquear" : "Bloquear"}>
                      {p.is_blocked ? <ShieldCheck className="h-4 w-4 text-primary" /> : <ShieldOff className="h-4 w-4 text-destructive" />}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(p.id, p.user_id)} disabled={deletingUserId === p.user_id}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Usuário</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{editingUser?.username}</p>
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={editForm.display_name} onChange={(e) => setEditForm((f) => ({ ...f, display_name: e.target.value }))} placeholder="Nome de exibição" />
            </div>
            <div className="space-y-2">
              <Label>Nova Senha</Label>
              <Input type="password" value={editForm.password} onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))} placeholder="Deixe vazio para manter a atual" />
            </div>
            <div className="space-y-2">
              <Label>PIN Parental (Conteúdo Adulto / Censurado)</Label>
              <Input
                type="text"
                inputMode="numeric"
                maxLength={8}
                value={editForm.adult_pin}
                onChange={(e) => setEditForm((f) => ({ ...f, adult_pin: e.target.value.replace(/\D/g, "") }))}
                placeholder="4 a 8 dígitos (padrão: 1234)"
              />
              <p className="text-xs text-muted-foreground">Senha pedida ao abrir canais marcados como adulto.</p>
            </div>
            <CategoryCheckboxes
              selected={editCategories}
              onToggle={(id) => toggleCategory(id, editCategories, setEditCategories)}
            />
            <Button onClick={handleUpdate} disabled={updating} className="w-full">
              {updating ? "Salvando..." : "Salvar Alterações"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UserManagement;
