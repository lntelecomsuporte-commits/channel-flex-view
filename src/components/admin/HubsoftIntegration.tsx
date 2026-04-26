import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseLocal";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Save, Copy, RefreshCw, Plus, Trash2, Edit2, X } from "lucide-react";
import { useCategories } from "@/hooks/useChannels";

function useHubsoftConfigs() {
  return useQuery({
    queryKey: ["hubsoft-configs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hubsoft_config")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

function useHubsoftConfigCategories() {
  return useQuery({
    queryKey: ["hubsoft-config-categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hubsoft_config_categories")
        .select("*");
      if (error) throw error;
      return data;
    },
  });
}

function generateApiKey() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let key = "";
  for (let i = 0; i < 32; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
}

function buildCallbackUrl(apiKey: string) {
  const baseUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/hubsoft-webhook`;
  const encodedApiKey = apiKey ? encodeURIComponent(apiKey) : "sem-chave";
  return `${baseUrl}/${encodedApiKey}`;
}

type FormState = {
  name: string;
  api_url: string;
  api_key: string;
  username: string;
  password: string;
  package_id: string;
  is_active: boolean;
  category_ids: string[];
};

const emptyForm: FormState = {
  name: "",
  api_url: "",
  api_key: "",
  username: "",
  password: "",
  package_id: "",
  is_active: true,
  category_ids: [],
};

const HubsoftIntegration = () => {
  const { data: configs, isLoading } = useHubsoftConfigs();
  const { data: configCategories } = useHubsoftConfigCategories();
  const { data: categories } = useCategories();
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  const getCategoryIdsForConfig = (configId: string) => {
    return configCategories?.filter((cc) => cc.hubsoft_config_id === configId).map((cc) => cc.category_id) || [];
  };

  const startNew = () => {
    setEditingId(null);
    setForm({ ...emptyForm, api_key: generateApiKey() });
    setShowForm(true);
  };

  const startEdit = (config: NonNullable<typeof configs>[0]) => {
    setEditingId(config.id);
    setForm({
      name: config.name,
      api_url: config.api_url,
      api_key: config.api_key,
      username: config.username,
      password: config.password,
      package_id: config.package_id,
      is_active: config.is_active,
      category_ids: getCategoryIdsForConfig(config.id),
    });
    setShowForm(true);
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm({ ...emptyForm });
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error("Informe o nome da integração");
      return;
    }
    setSaving(true);

    const payload = {
      name: form.name,
      api_url: form.api_url,
      api_key: form.api_key,
      username: form.username,
      password: form.password,
      package_id: form.package_id,
      is_active: form.is_active,
    };

    let configId = editingId;

    if (editingId) {
      const { error } = await supabase.from("hubsoft_config").update(payload).eq("id", editingId);
      if (error) {
        toast.error("Erro ao salvar: " + error.message);
        setSaving(false);
        return;
      }
    } else {
      const { data, error } = await supabase.from("hubsoft_config").insert(payload).select("id").single();
      if (error) {
        toast.error("Erro ao criar: " + error.message);
        setSaving(false);
        return;
      }
      configId = data.id;
    }

    // Sync categories
    if (configId) {
      await supabase.from("hubsoft_config_categories").delete().eq("hubsoft_config_id", configId);
      if (form.category_ids.length > 0) {
        const rows = form.category_ids.map((cid) => ({
          hubsoft_config_id: configId!,
          category_id: cid,
        }));
        await supabase.from("hubsoft_config_categories").insert(rows);
      }
    }

    setSaving(false);
    toast.success(editingId ? "Integração atualizada!" : "Integração criada!");
    cancelForm();
    queryClient.invalidateQueries({ queryKey: ["hubsoft-configs"] });
    queryClient.invalidateQueries({ queryKey: ["hubsoft-config-categories"] });
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir esta integração?")) return;
    const { error } = await supabase.from("hubsoft_config").delete().eq("id", id);
    if (error) {
      toast.error("Erro ao excluir: " + error.message);
    } else {
      toast.success("Integração excluída");
      queryClient.invalidateQueries({ queryKey: ["hubsoft-configs"] });
      queryClient.invalidateQueries({ queryKey: ["hubsoft-config-categories"] });
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copiado!`);
  };

  const toggleCategory = (categoryId: string) => {
    setForm((f) => ({
      ...f,
      category_ids: f.category_ids.includes(categoryId)
        ? f.category_ids.filter((id) => id !== categoryId)
        : [...f.category_ids, categoryId],
    }));
  };

  if (isLoading) {
    return <p className="text-muted-foreground">Carregando...</p>;
  }

  if (showForm) {
    const callbackUrl = buildCallbackUrl(form.api_key);
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">
            {editingId ? "Editar Integração" : "Nova Integração"}
          </h2>
          <Button variant="ghost" size="sm" onClick={cancelForm}>
            <X className="h-4 w-4 mr-1" /> Cancelar
          </Button>
        </div>

        {/* Callback URL */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Callback URL</CardTitle>
            <CardDescription>
              Cole esta URL no campo <strong>url</strong> do Hubsoft (metodo: POST).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Input value={callbackUrl} readOnly className="font-mono text-xs" />
              <Button variant="outline" size="sm" onClick={() => copyToClipboard(callbackUrl, "Callback URL")}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Configurações</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Switch checked={form.is_active} onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))} />
              <Label>Integração ativa</Label>
            </div>

            <div className="space-y-2">
              <Label>Nome da Integração <span className="text-destructive">*</span></Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Ex: TVLN - Canais Abertos" />
            </div>

            <div className="space-y-2">
              <Label>API Key</Label>
              <div className="flex items-center gap-2">
                <Input value={form.api_key} readOnly className="font-mono text-xs" />
                <Button variant="outline" size="sm" onClick={() => { setForm((f) => ({ ...f, api_key: generateApiKey() })); toast.info("Nova API Key gerada!"); }} title="Gerar nova">
                  <RefreshCw className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" onClick={() => copyToClipboard(form.api_key, "API Key")} disabled={!form.api_key}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>ID do Pacote (opcional)</Label>
              <Input value={form.package_id} onChange={(e) => setForm((f) => ({ ...f, package_id: e.target.value }))} placeholder="ID do pacote no Hubsoft" />
            </div>

            {/* Category selection */}
            <div className="space-y-2">
              <Label>Categorias vinculadas</Label>
              <p className="text-xs text-muted-foreground">
                Usuários criados por esta integração terão acesso às categorias selecionadas.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                {categories?.map((cat) => (
                  <label key={cat.id} className="flex items-center gap-2 p-2 rounded-lg bg-secondary cursor-pointer hover:bg-secondary/80">
                    <Checkbox
                      checked={form.category_ids.includes(cat.id)}
                      onCheckedChange={() => toggleCategory(cat.id)}
                    />
                    <span className="text-sm text-foreground">{cat.name}</span>
                  </label>
                ))}
                {(!categories || categories.length === 0) && (
                  <p className="text-xs text-muted-foreground">Nenhuma categoria cadastrada</p>
                )}
              </div>
            </div>

            <Button onClick={handleSave} disabled={saving}>
              <Save className="h-4 w-4 mr-1" /> {saving ? "Salvando..." : "Salvar"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Integrações Hubsoft</h2>
        <Button onClick={startNew} size="sm">
          <Plus className="h-4 w-4 mr-1" /> Nova Integração
        </Button>
      </div>

      {!configs?.length ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">Nenhuma integração cadastrada</p>
            <Button onClick={startNew} variant="outline" className="mt-4">
              <Plus className="h-4 w-4 mr-1" /> Criar primeira integração
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {configs.map((config) => {
            const catIds = getCategoryIdsForConfig(config.id);
            const catNames = categories?.filter((c) => catIds.includes(c.id)).map((c) => c.name) || [];
            return (
              <Card key={config.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-foreground truncate">{config.name}</p>
                        <span className={`text-xs px-2 py-0.5 rounded ${config.is_active ? "bg-primary/20 text-primary" : "bg-destructive/20 text-destructive"}`}>
                          {config.is_active ? "Ativa" : "Inativa"}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 font-mono truncate">
                        {buildCallbackUrl(config.api_key)}
                      </p>
                      {catNames.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {catNames.map((name) => (
                            <span key={name} className="text-xs px-2 py-0.5 rounded bg-accent text-accent-foreground">{name}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 ml-2">
                      <Button variant="ghost" size="sm" onClick={() => copyToClipboard(buildCallbackUrl(config.api_key), "URL")}>
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => startEdit(config)}>
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(config.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">📋 Como configurar no Hubsoft</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
            <li>Vá em <strong>Integrações → Plataforma de Conteúdo</strong></li>
            <li>Gateway: <strong>Outros</strong></li>
            <li>Cole a <strong>Callback URL</strong> da integração no parâmetro <strong>url</strong></li>
            <li>Defina <strong>metodo</strong> como <strong>POST</strong></li>
            <li>Marque <strong>"Pacote único"</strong> e <strong>"Habilitar/Suspender Assinaturas"</strong></li>
            <li>Salve a integração</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
};

export default HubsoftIntegration;
