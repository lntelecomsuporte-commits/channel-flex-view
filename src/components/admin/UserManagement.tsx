import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Plus, Trash2, ShieldOff, ShieldCheck } from "lucide-react";

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

const UserManagement = () => {
  const { data: profiles, isLoading } = useProfiles();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ email: "", password: "", display_name: "" });
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!form.email || !form.password) {
      toast.error("Preencha email e senha");
      return;
    }

    setSaving(true);

    // Create user via edge function
    const { data, error } = await supabase.functions.invoke("manage-users", {
      body: { action: "create", email: form.email, password: form.password, display_name: form.display_name || form.email },
    });

    setSaving(false);
    if (error || data?.error) {
      toast.error("Erro ao criar usuário: " + (data?.error || error?.message));
    } else {
      toast.success("Usuário criado!");
      setForm({ email: "", password: "", display_name: "" });
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
    }
  };

  const handleToggleBlock = async (profileId: string, currentBlocked: boolean) => {
    const { error } = await supabase
      .from("profiles")
      .update({ is_blocked: !currentBlocked })
      .eq("id", profileId);

    if (error) {
      toast.error("Erro: " + error.message);
    } else {
      toast.success(currentBlocked ? "Usuário desbloqueado" : "Usuário bloqueado");
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
    }
  };

  const handleDelete = async (profileId: string, userId: string) => {
    const { data, error } = await supabase.functions.invoke("manage-users", {
      body: { action: "delete", user_id: userId },
    });

    if (error || data?.error) {
      toast.error("Erro: " + (data?.error || error?.message));
    } else {
      toast.success("Usuário excluído");
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
    }
  };

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
                    <span className={`text-xs px-2 py-0.5 rounded ${p.is_blocked ? "bg-destructive/20 text-destructive" : p.is_active ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>
                      {p.is_blocked ? "Bloqueado" : p.is_active ? "Ativo" : "Inativo"}
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => handleToggleBlock(p.id, p.is_blocked)} title={p.is_blocked ? "Desbloquear" : "Bloquear"}>
                      {p.is_blocked ? <ShieldCheck className="h-4 w-4 text-primary" /> : <ShieldOff className="h-4 w-4 text-destructive" />}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(p.id, p.user_id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default UserManagement;
