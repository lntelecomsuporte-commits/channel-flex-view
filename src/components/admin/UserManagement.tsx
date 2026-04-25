import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Plus, Trash2, ShieldOff, ShieldCheck, Pencil } from "lucide-react";
import { useCategories } from "@/hooks/useChannels";
import { UserStatusBadge } from "./UserStatusBadge";

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
  const { data: categories } = useCategories();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ email: "", password: "", display_name: "" });
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [editingUser, setEditingUser] = useState<Profile | null>(null);
  const [editForm, setEditForm] = useState({ password: "", display_name: "" });
  const [editCategories, setEditCategories] = useState<string[]>([]);
  const [updating, setUpdating] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);

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

  const handleEdit = (profile: Profile) => {
    setEditingUser(profile);
    setEditForm({ password: "", display_name: profile.display_name || "" });
  };

  const handleUpdate = async () => {
    if (!editingUser) return;
    setUpdating(true);

    // Update user info if needed
    if (editForm.password || editForm.display_name) {
      const body: Record<string, string> = { action: "update", user_id: editingUser.user_id };
      if (editForm.password) body.password = editForm.password;
      if (editForm.display_name) body.display_name = editForm.display_name;
      const { data, error } = await supabase.functions.invoke("manage-users", { body });
      if (error || data?.error) {
        toast.error("Erro ao atualizar: " + (data?.error || error?.message));
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
    const { error } = await supabase
      .from("profiles")
      .update({ is_blocked: !currentBlocked })
      .eq("id", profileId);
    if (error) {
      toast.error("Erro: " + error.message);
      return;
    }
    toast.success(currentBlocked ? "Usuário desbloqueado" : "Usuário bloqueado");
    queryClient.invalidateQueries({ queryKey: ["profiles"] });
  };

  const handleDelete = async (profileId: string, userId: string) => {
    if (deletingUserId) return;
    setDeletingUserId(userId);
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
          <CardTitle>Usuários Cadastrados</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Carregando...</p>
          ) : !profiles?.length ? (
            <p className="text-muted-foreground">Nenhum usuário cadastrado</p>
          ) : (
            <div className="space-y-2">
              {profiles.map((p) => (
                <div key={p.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary">
                  <div>
                    <p className="font-medium text-foreground">{p.display_name || p.username}</p>
                    <p className="text-xs text-muted-foreground">{p.username}</p>
                    {p.hubsoft_client_id && (
                      <p className="text-xs text-muted-foreground">Hubsoft ID: {p.hubsoft_client_id}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <UserStatusBadge userId={p.user_id} />
                    <span className={`text-xs px-2 py-0.5 rounded ${p.is_blocked ? "bg-destructive/20 text-destructive" : p.is_active ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>
                      {p.is_blocked ? "Bloqueado" : p.is_active ? "Ativo" : "Inativo"}
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => handleEdit(p as Profile)} title="Editar">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleToggleBlock(p.id, p.is_blocked)} title={p.is_blocked ? "Desbloquear" : "Bloquear"}>
                      {p.is_blocked ? <ShieldCheck className="h-4 w-4 text-primary" /> : <ShieldOff className="h-4 w-4 text-destructive" />}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(p.id, p.user_id)} disabled={deletingUserId === p.user_id}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
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
