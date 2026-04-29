import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useAllChannels, useCategories } from "@/hooks/useChannels";
import { normalizeGithubUrl as normalizeGithub } from "@/hooks/useEPG";
import { supabase } from "@/lib/supabaseLocal";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2, LogOut, Tv, Layers, Users, Link, Activity, Download } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import UserManagement from "@/components/admin/UserManagement";
import HubsoftIntegration from "@/components/admin/HubsoftIntegration";
import ProxyMonitoring from "@/components/admin/ProxyMonitoring";
import EpgChannelPicker from "@/components/admin/EpgChannelPicker";
import EpgUrlPresetSelector from "@/components/admin/EpgUrlPresetSelector";
import { getLocalFunctionUrl, LOCAL_SUPABASE_PUBLISHABLE_KEY } from "@/lib/localBackend";

const emptyChannelForm = {
  name: "", channel_number: "", stream_url: "", stream_format: "auto", backup_stream_urls: "", logo_url: "", category_id: "", is_active: true,
  epg_type: "", epg_url: "", epg_alt_text: "", epg_channel_id: "", epg_grab_logo: false, epg_show_synopsis: false,
  use_proxy_token: false,
};

const AdminPanel = () => {
  const { user, isAdmin, loading: authLoading, signOut } = useAuth();
  const { data: channels, isLoading: channelsLoading } = useAllChannels();
  const { data: categories, isLoading: categoriesLoading } = useCategories();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [channelForm, setChannelForm] = useState({ ...emptyChannelForm });
  const [extraEpgUrls, setExtraEpgUrls] = useState<string[]>([]);
  const [categoryForm, setCategoryForm] = useState({ name: "", position: "", includedCategoryIds: [] as string[] });
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const channelFormRef = useRef<HTMLDivElement>(null);
  const categoryFormRef = useRef<HTMLDivElement>(null);

  // (removido) busca global de presets — agora o EpgUrlPresetSelector lista
  // todas as URLs salvas do tipo "xmltv" e o usuário escolhe quais buscar.

  // Fetch category includes
  const { data: categoryIncludes } = useQuery({
    queryKey: ["category-includes"],
    queryFn: async () => {
      const { data, error } = await supabase.from("category_includes").select("*");
      if (error) throw error;
      return data;
    },
  });

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

    // Se epg_grab_logo está marcado, busca logo do XML EPG
    let logoUrl = channelForm.logo_url || null;
    if (channelForm.epg_type === "xmltv" && channelForm.epg_grab_logo && channelForm.epg_channel_id && channelForm.epg_url) {
      try {
        const epgUrl = normalizeGithub(channelForm.epg_url);
        const proxyUrl = `${getLocalFunctionUrl("epg-proxy")}?url=${encodeURIComponent(epgUrl)}`;
        const res = await fetch(proxyUrl);
        if (res.ok) {
          const text = await res.text();
          const parser = new DOMParser();
          const doc = parser.parseFromString(text, "text/xml");
          const channel = doc.querySelector(`channel[id="${channelForm.epg_channel_id}"]`);
          const icon = channel?.querySelector("icon");
          const grabLogo = icon?.getAttribute("src") || null;
          if (grabLogo) {
            logoUrl = grabLogo;
            toast.info("Logo do EPG obtido com sucesso!");
          }
        }
      } catch (e) {
        console.warn("Falha ao buscar logo do EPG:", e);
      }
    }

    const isXmltv = channelForm.epg_type === "xmltv";
    const backupList = (channelForm.backup_stream_urls || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const payload = {
      name: channelForm.name, channel_number: parseInt(channelForm.channel_number),
      stream_url: channelForm.stream_url,
      stream_format: channelForm.stream_format || "auto",
      backup_stream_urls: backupList,
      logo_url: logoUrl,
      category_id: channelForm.category_id || null, is_active: channelForm.is_active,
      epg_type: channelForm.epg_type || null,
      epg_url: isXmltv ? (normalizeGithub(channelForm.epg_url) || null) : null,
      epg_alt_text: channelForm.epg_type === "alt_text" ? (channelForm.epg_alt_text || null) : null,
      epg_channel_id: isXmltv ? (channelForm.epg_channel_id || null) : null,
      epg_grab_logo: isXmltv ? channelForm.epg_grab_logo : false,
      epg_show_synopsis: channelForm.epg_show_synopsis,
      use_proxy_token: channelForm.use_proxy_token,
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
      setChannelForm({ ...emptyChannelForm });
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
    setChannelForm({
      name: ch.name, channel_number: String(ch.channel_number), stream_url: ch.stream_url,
      backup_stream_urls: (((ch as any).backup_stream_urls ?? []) as string[]).join("\n"),
      logo_url: ch.logo_url ?? "", category_id: ch.category_id ?? "", is_active: ch.is_active,
      epg_type: (() => {
        const t = (ch as any).epg_type ?? "";
        // Migra valores legados para o novo "xmltv"
        if (["iptv_epg_org", "open_epg", "github_xml", "epg_pw"].includes(t)) return "xmltv";
        return t;
      })(),
      epg_url: (ch as any).epg_url ?? "",
      epg_alt_text: (ch as any).epg_alt_text ?? "",
      epg_channel_id: (ch as any).epg_channel_id ?? "",
      epg_grab_logo: (ch as any).epg_grab_logo ?? false,
      epg_show_synopsis: (ch as any).epg_show_synopsis ?? false,
      use_proxy_token: (ch as any).use_proxy_token ?? false,
    });
    requestAnimationFrame(() => {
      channelFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
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
    requestAnimationFrame(() => {
      categoryFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
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
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const t = toast.loading("Gerando dump SQL...");
                try {
                  const { data: { session } } = await supabase.auth.getSession();
                  const url = getLocalFunctionUrl("export-database");
                  const res = await fetch(url, {
                    headers: {
                      Authorization: `Bearer ${session?.access_token}`,
                      apikey: LOCAL_SUPABASE_PUBLISHABLE_KEY,
                    },
                  });
                  if (!res.ok) throw new Error(await res.text());
                  const blob = await res.blob();
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = `lntv-dump-${new Date().toISOString().slice(0, 10)}.sql`;
                  a.click();
                  URL.revokeObjectURL(a.href);
                  toast.success("Dump baixado!", { id: t });
                } catch (e: any) {
                  toast.error("Falha: " + e.message, { id: t });
                }
              }}
            >
              <Download className="h-4 w-4 mr-1" /> Exportar BD
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
            <TabsTrigger value="monitoring"><Activity className="h-4 w-4 mr-1" /> Monitoramento</TabsTrigger>
          </TabsList>

          <TabsContent value="channels">
            <Card className="mb-6" ref={channelFormRef}>
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
                  <div className="space-y-2 md:col-span-2">
                    <Label>URLs de Backup (opcional)</Label>
                    <Textarea
                      rows={3}
                      value={channelForm.backup_stream_urls}
                      onChange={(e) => setChannelForm((f) => ({ ...f, backup_stream_urls: e.target.value }))}
                      placeholder={"Uma URL por linha. Se a principal cair, o player tenta cada uma em ordem.\nhttps://backup1.exemplo.com/canal/index.m3u8\nhttps://backup2.exemplo.com/canal/index.m3u8"}
                      className="font-mono text-xs"
                    />
                    <p className="text-xs text-muted-foreground">Uma URL por linha — testadas em ordem após esgotar tentativas na principal (~3s por URL).</p>
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

                {/* EPG Section */}
                <div className="space-y-4 border-t border-border pt-4">
                  <Label className="text-base font-semibold">Configuração de EPG</Label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Tipo de EPG</Label>
                      <Select value={channelForm.epg_type} onValueChange={(v) => setChannelForm((f) => ({ ...f, epg_type: v }))}>
                        <SelectTrigger><SelectValue placeholder="Nenhum" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Nenhum</SelectItem>
                          <SelectItem value="alt_text">Texto Alternativo</SelectItem>
                          <SelectItem value="xmltv">XMLTV</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {channelForm.epg_type === "alt_text" && (
                    <div className="space-y-2">
                      <Label>Texto Alternativo</Label>
                      <Input value={channelForm.epg_alt_text} onChange={(e) => setChannelForm((f) => ({ ...f, epg_alt_text: e.target.value }))} placeholder="Ex: Filmes e Séries 24h" />
                    </div>
                  )}

                  {channelForm.epg_type === "xmltv" && (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <EpgUrlPresetSelector
                          epgType="xmltv"
                          currentUrl={channelForm.epg_url}
                          onSelect={(url) => setChannelForm((f) => ({ ...f, epg_url: url }))}
                          onUrlsChange={setExtraEpgUrls}
                        />
                        <Label>URL do XML <span className="text-xs text-muted-foreground">(selecione uma das URLs salvas acima ou cole aqui — link com /blob/ do GitHub é convertido automaticamente)</span></Label>
                        <Input
                          value={channelForm.epg_url}
                          onChange={(e) => setChannelForm((f) => ({ ...f, epg_url: e.target.value }))}
                          placeholder="https://..."
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>ID do Canal (no XML) <span className="text-xs text-muted-foreground">— a busca cobre todas as URLs marcadas acima</span></Label>
                        <EpgChannelPicker
                          value={channelForm.epg_channel_id}
                          onChange={(v) => setChannelForm((f) => ({ ...f, epg_channel_id: v }))}
                          xmlUrl={normalizeGithub(channelForm.epg_url || "")}
                          extraUrls={extraEpgUrls.map(normalizeGithub)}
                          onResolve={(id, sourceUrl) => {
                            // Se o canal foi achado em outra URL, atualiza a URL principal
                            const normalized = normalizeGithub(sourceUrl);
                            if (normalized && normalized !== normalizeGithub(channelForm.epg_url || "")) {
                              setChannelForm((f) => ({ ...f, epg_channel_id: id, epg_url: sourceUrl }));
                              toast.success("URL definida automaticamente", { description: sourceUrl });
                            }
                          }}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <Checkbox checked={channelForm.epg_grab_logo} onCheckedChange={(v) => setChannelForm((f) => ({ ...f, epg_grab_logo: !!v }))} />
                        <Label>Usar logo do canal do EPG (substitui URL do logo)</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Checkbox checked={channelForm.epg_show_synopsis} onCheckedChange={(v) => setChannelForm((f) => ({ ...f, epg_show_synopsis: !!v }))} />
                        <Label>Exibir sinopse (permite clicar em um programa para ver a descrição)</Label>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Switch checked={channelForm.is_active} onCheckedChange={(v) => setChannelForm((f) => ({ ...f, is_active: v }))} />
                  <Label>Ativo</Label>
                </div>
                <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3">
                  <Switch
                    checked={channelForm.use_proxy_token}
                    onCheckedChange={(v) => setChannelForm((f) => ({ ...f, use_proxy_token: v }))}
                  />
                  <div className="space-y-1">
                    <Label className="cursor-pointer">🔒 Ocultar URL do canal (proxy + token)</Label>
                    <p className="text-xs text-muted-foreground">
                      Força o stream pelo proxy local com URL temporária assinada (válida por 60s).
                      A URL real do provedor não aparece no F12. Aumenta o uso de banda do servidor.
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleSaveChannel} disabled={saving}>
                    <Plus className="h-4 w-4 mr-1" /> {saving ? "Salvando..." : editingChannelId ? "Salvar" : "Adicionar"}
                  </Button>
                  {editingChannelId && (
                    <Button variant="outline" onClick={() => { setEditingChannelId(null); setChannelForm({ ...emptyChannelForm }); }}>
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
            <Card className="mb-6" ref={categoryFormRef}>
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

                {categories && categories.filter((c) => c.id !== editingCategoryId).length > 0 && (
                  <div className="space-y-2">
                    <Label>Inclui canais de outras categorias</Label>
                    <p className="text-xs text-muted-foreground">
                      Usuários desta categoria também poderão assistir canais das categorias marcadas abaixo.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
                      {categories.filter((c) => c.id !== editingCategoryId).map((cat) => (
                        <label key={cat.id} className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 cursor-pointer hover:bg-muted">
                          <Checkbox
                            checked={categoryForm.includedCategoryIds.includes(cat.id)}
                            onCheckedChange={() => toggleIncludedCategory(cat.id)}
                          />
                          <span className="text-sm text-foreground">{cat.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button onClick={handleSaveCategory} disabled={saving}>
                    <Plus className="h-4 w-4 mr-1" /> {saving ? "Salvando..." : editingCategoryId ? "Salvar" : "Adicionar"}
                  </Button>
                  {editingCategoryId && (
                    <Button variant="outline" onClick={() => { setEditingCategoryId(null); resetCategoryForm(); }}>
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
                    {categories.map((cat) => {
                      const includes = categoryIncludes?.filter((ci) => ci.category_id === cat.id) || [];
                      const hubsoftCats = hubsoftConfigCategories?.filter((hcc) => hcc.category_id === cat.id) || [];
                      const linkedHubsoft = hubsoftCats.map((hc) => hubsoftConfigs?.find((h) => h.id === hc.hubsoft_config_id)?.name).filter(Boolean);
                      return (
                        <div key={cat.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary">
                          <div>
                            <p className="font-medium text-foreground">{cat.name} <span className="text-xs text-muted-foreground">(pos: {cat.position})</span></p>
                            {includes.length > 0 && (
                              <p className="text-xs text-muted-foreground">
                                Inclui: {includes.map((inc) => categories.find((c) => c.id === inc.included_category_id)?.name).filter(Boolean).join(", ")}
                              </p>
                            )}
                            {linkedHubsoft.length > 0 && (
                              <p className="text-xs text-primary">Hubsoft: {linkedHubsoft.join(", ")}</p>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <Button variant="ghost" size="sm" onClick={() => handleEditCategory(cat)}>Editar</Button>
                            <Button variant="ghost" size="sm" onClick={() => handleDeleteCategory(cat.id)}>
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
          </TabsContent>

          <TabsContent value="users">
            <UserManagement />
          </TabsContent>

          <TabsContent value="hubsoft">
            <HubsoftIntegration />
          </TabsContent>

          <TabsContent value="monitoring">
            <ProxyMonitoring />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default AdminPanel;
