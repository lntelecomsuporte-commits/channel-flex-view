import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useAllChannels, useCategories } from "@/hooks/useChannels";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2, LogOut, Tv, Layers, Users, Link } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import UserManagement from "@/components/admin/UserManagement";
import HubsoftIntegration from "@/components/admin/HubsoftIntegration";

const AdminPanel = () => {
  const { user, isAdmin, loading: authLoading, signOut } = useAuth();
  const { data: channels, isLoading: channelsLoading } = useAllChannels();
  const { data: categories, isLoading: categoriesLoading } = useCategories();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [channelForm, setChannelForm] = useState({
    name: "", channel_number: "", stream_url: "", logo_url: "", category_id: "", is_active: true,
  });
  const [categoryForm, setCategoryForm] = useState({ name: "", position: "", includedCategoryIds: [] as string[] });
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Fetch category includes
  const { data: categoryIncludes } = useQuery({
    queryKey: ["category-includes"],
    queryFn: async () => {
      const { data, error } = await supabase.from("category_includes").select("*");
      if (error) throw error;
      return data;
    },
  });

  // Fetch hubsoft config categories for display
  const { data: hubsoftConfigCategories } = useQuery({
    queryKey: ["hubsoft-config-categories"],
    queryFn: async () => {
      const { data, error } = await supabase.from("hubsoft_config_categories").select("*");
      if (error) throw error;
      return data;
    },
  });

  const { data: hubsoftConfigs } = useQuery({
    queryKey: ["hubsoft-configs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("hubsoft_config").select("*");
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!authLoading && !user) navigate("/admin/login");
  }, [authLoading, user, navigate]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) return null;

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-foreground text-lg font-semibold">Acesso negado</p>
            <p className="text-muted-foreground mt-2">Você não tem permissão de administrador.</p>
            <Button variant="outline" className="mt-4" onClick={signOut}>Sair</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleSaveChannel = async () => {
    if (!channelForm.name || !channelForm.stream_url || !channelForm.channel_number) {
      toast.error("Preencha nome, número e URL do stream");
      return;
    }
    setSaving(true);
    const payload = {
      name: channelForm.name, channel_number: parseInt(channelForm.channel_number),
      stream_url: channelForm.stream_url, logo_url: channelForm.logo_url || null,
      category_id: channelForm.category_id || null, is_active: channelForm.is_active,
    };
    let error;
    if (editingChannelId) {
      ({ error } = await supabase.from("channels").update(payload).eq("id", editingChannelId));
    } else {
      ({ error } = await supabase.from("channels").insert(payload));
    }
    setSaving(false);
    if (error) {
      toast.error("Erro ao salvar canal: " + error.message);
    } else {
      toast.success(editingChannelId ? "Canal atualizado!" : "Canal adicionado!");
      setChannelForm({ name: "", channel_number: "", stream_url: "", logo_url: "", category_id: "", is_active: true });
      setEditingChannelId(null);
      queryClient.invalidateQueries({ queryKey: ["channels-all"] });
      queryClient.invalidateQueries({ queryKey: ["channels"] });
    }
  };

  const handleDeleteChannel = async (id: string) => {
    const { error } = await supabase.from("channels").delete().eq("id", id);
    if (error) { toast.error("Erro ao excluir: " + error.message); }
    else { toast.success("Canal excluído"); queryClient.invalidateQueries({ queryKey: ["channels-all"] }); queryClient.invalidateQueries({ queryKey: ["channels"] }); }
  };

  const handleEditChannel = (ch: NonNullable<typeof channels>[0]) => {
    setEditingChannelId(ch.id);
    setChannelForm({ name: ch.name, channel_number: String(ch.channel_number), stream_url: ch.stream_url, logo_url: ch.logo_url ?? "", category_id: ch.category_id ?? "", is_active: ch.is_active });
  };

  const resetCategoryForm = () => setCategoryForm({ name: "", position: "", includedCategoryIds: [] });

  const handleSaveCategory = async () => {
    if (!categoryForm.name) { toast.error("Informe o nome da categoria"); return; }
    setSaving(true);
    let categoryId = editingCategoryId;

    if (editingCategoryId) {
      const { error } = await supabase.from("categories").update({ name: categoryForm.name, position: parseInt(categoryForm.position) || 0 }).eq("id", editingCategoryId);
      if (error) { toast.error("Erro: " + error.message); setSaving(false); return; }
    } else {
      const { data, error } = await supabase.from("categories").insert({ name: categoryForm.name, position: parseInt(categoryForm.position) || 0 }).select("id").single();
      if (error) { toast.error("Erro ao salvar categoria: " + error.message); setSaving(false); return; }
      categoryId = data.id;
    }

    // Sync category includes
    if (categoryId) {
      await supabase.from("category_includes").delete().eq("category_id", categoryId);
      if (categoryForm.includedCategoryIds.length > 0) {
        const rows = categoryForm.includedCategoryIds.map((incId) => ({
          category_id: categoryId!,
          included_category_id: incId,
        }));
        await supabase.from("category_includes").insert(rows);
      }
    }

    setSaving(false);
    toast.success(editingCategoryId ? "Categoria atualizada!" : "Categoria criada!");
    resetCategoryForm();
    setEditingCategoryId(null);
    queryClient.invalidateQueries({ queryKey: ["categories"] });
    queryClient.invalidateQueries({ queryKey: ["category-includes"] });
  };

  const handleEditCategory = (cat: NonNullable<typeof categories>[0]) => {
    setEditingCategoryId(cat.id);
    const includes = categoryIncludes?.filter((ci) => ci.category_id === cat.id).map((ci) => ci.included_category_id) || [];
    setCategoryForm({ name: cat.name, position: String(cat.position), includedCategoryIds: includes });
  };

  const handleDeleteCategory = async (id: string) => {
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) { toast.error("Erro: " + error.message); }
    else { toast.success("Categoria excluída"); queryClient.invalidateQueries({ queryKey: ["categories"] }); queryClient.invalidateQueries({ queryKey: ["category-includes"] }); }
  };

  const toggleIncludedCategory = (catId: string) => {
    setCategoryForm((f) => ({
      ...f,
      includedCategoryIds: f.includedCategoryIds.includes(catId)
        ? f.includedCategoryIds.filter((id) => id !== catId)
        : [...f.includedCategoryIds, catId],
    }));
  };

  return (
    <div className="min-h-screen bg-background overflow-auto">
      <div className="mx-auto max-w-5xl p-4 md:p-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-foreground">Painel de Administração</h1>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/")}>
              <Tv className="h-4 w-4 mr-1" /> Ver Player
            </Button>
            <Button variant="outline" size="sm" onClick={signOut}>
              <LogOut className="h-4 w-4 mr-1" /> Sair
            </Button>
          </div>
        </div>

        <Tabs defaultValue="channels">
          <TabsList className="mb-6 flex-wrap">
            <TabsTrigger value="channels"><Tv className="h-4 w-4 mr-1" /> Canais</TabsTrigger>
            <TabsTrigger value="categories"><Layers className="h-4 w-4 mr-1" /> Categorias</TabsTrigger>
            <TabsTrigger value="users"><Users className="h-4 w-4 mr-1" /> Usuários</TabsTrigger>
            <TabsTrigger value="hubsoft"><Link className="h-4 w-4 mr-1" /> Hubsoft</TabsTrigger>
          </TabsList>

          <TabsContent value="channels">
            {/* Channel form */}
            <Card className="mb-6">
              <CardHeader><CardTitle>{editingChannelId ? "Editar Canal" : "Novo Canal"}</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Nome do Canal <span className="text-destructive">*</span></Label>
                    <Input value={channelForm.name} onChange={(e) => setChannelForm((f) => ({ ...f, name: e.target.value }))} placeholder="Ex: Globo HD" />
                  </div>
                  <div className="space-y-2">
                    <Label>Número <span className="text-destructive">*</span></Label>
                    <Input type="number" value={channelForm.channel_number} onChange={(e) => setChannelForm((f) => ({ ...f, channel_number: e.target.value }))} placeholder="Ex: 1" />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>URL do Stream (HLS) <span className="text-destructive">*</span></Label>
                    <Input value={channelForm.stream_url} onChange={(e) => setChannelForm((f) => ({ ...f, stream_url: e.target.value }))} placeholder="https://seu-flussonic.com/canal/index.m3u8" />
                  </div>
                  <div className="space-y-2">
                    <Label>URL do Logo (opcional)</Label>
                    <Input value={channelForm.logo_url} onChange={(e) => setChannelForm((f) => ({ ...f, logo_url: e.target.value }))} placeholder="https://..." />
                  </div>
                  <div className="space-y-2">
                    <Label>Categoria</Label>
                    <Select value={channelForm.category_id} onValueChange={(v) => setChannelForm((f) => ({ ...f, category_id: v }))}>
                      <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                      <SelectContent>
                        {categories?.map((c) => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={channelForm.is_active} onCheckedChange={(v) => setChannelForm((f) => ({ ...f, is_active: v }))} />
                  <Label>Ativo</Label>
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleSaveChannel} disabled={saving}>
                    <Plus className="h-4 w-4 mr-1" /> {saving ? "Salvando..." : editingChannelId ? "Salvar" : "Adicionar"}
                  </Button>
                  {editingChannelId && (
                    <Button variant="outline" onClick={() => { setEditingChannelId(null); setChannelForm({ name: "", channel_number: "", stream_url: "", logo_url: "", category_id: "", is_active: true }); }}>
                      Cancelar
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Canais Cadastrados</CardTitle></CardHeader>
              <CardContent>
                {channelsLoading ? (
                  <p className="text-muted-foreground">Carregando...</p>
                ) : !channels?.length ? (
                  <p className="text-muted-foreground">Nenhum canal cadastrado</p>
                ) : (
                  <div className="space-y-2">
                    {channels.map((ch) => (
                      <div key={ch.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary">
                        <div className="flex items-center gap-3">
                          <span className="channel-badge text-sm">{ch.channel_number}</span>
                          {ch.logo_url && <img src={ch.logo_url} alt="" className="h-8 w-8 rounded object-contain bg-muted" />}
                          <div>
                            <p className="font-medium text-foreground">{ch.name}</p>
                            <p className="text-xs text-muted-foreground truncate max-w-xs">{ch.stream_url}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-2 py-0.5 rounded ${ch.is_active ? "bg-primary/20 text-primary" : "bg-destructive/20 text-destructive"}`}>
                            {ch.is_active ? "Ativo" : "Inativo"}
                          </span>
                          <Button variant="ghost" size="sm" onClick={() => handleEditChannel(ch)}>Editar</Button>
                          <Button variant="ghost" size="sm" onClick={() => handleDeleteChannel(ch.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="categories">
            <Card className="mb-6">
              <CardHeader><CardTitle>{editingCategoryId ? "Editar Categoria" : "Nova Categoria"}</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Nome <span className="text-destructive">*</span></Label>
                    <Input value={categoryForm.name} onChange={(e) => setCategoryForm((f) => ({ ...f, name: e.target.value }))} placeholder="Ex: Esportes" />
                  </div>
                  <div className="space-y-2">
                    <Label>Posição</Label>
                    <Input type="number" value={categoryForm.position} onChange={(e) => setCategoryForm((f) => ({ ...f, position: e.target.value }))} placeholder="0" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleSaveCategory} disabled={saving}>
                    <Plus className="h-4 w-4 mr-1" /> {saving ? "Salvando..." : editingCategoryId ? "Salvar" : "Adicionar"}
                  </Button>
                  {editingCategoryId && (
                    <Button variant="outline" onClick={() => { setEditingCategoryId(null); setCategoryForm({ name: "", position: "" }); }}>
                      Cancelar
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Categorias</CardTitle></CardHeader>
              <CardContent>
                {categoriesLoading ? (
                  <p className="text-muted-foreground">Carregando...</p>
                ) : !categories?.length ? (
                  <p className="text-muted-foreground">Nenhuma categoria</p>
                ) : (
                  <div className="space-y-2">
                    {categories.map((c) => (
                      <div key={c.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary">
                        <div>
                          <p className="font-medium text-foreground">{c.name}</p>
                          <p className="text-xs text-muted-foreground">Posição: {c.position}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="sm" onClick={() => handleEditCategory(c)}>Editar</Button>
                          <Button variant="ghost" size="sm" onClick={() => handleDeleteCategory(c.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="users">
            <UserManagement />
          </TabsContent>

          <TabsContent value="hubsoft">
            <HubsoftIntegration />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default AdminPanel;
