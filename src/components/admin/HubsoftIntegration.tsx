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
import { getLocalFunctionUrl } from "@/lib/localBackend";

type HubsoftConfig = {
  id: string;
  name: string;
  api_url: string;
  api_key: string;
  username: string;
  password: string;
  package_id: string;
  is_active: boolean;
  trial_enabled: boolean;
  trial_days: number;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function useHubsoftConfigs() {
  return useQuery({
    queryKey: ["hubsoft-configs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hubsoft_config")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as HubsoftConfig[];
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

function useHubsoftConfigTrialCategories() {
  return useQuery({
    queryKey: ["hubsoft-config-trial-categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hubsoft_config_trial_categories")
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
  const baseUrl = getLocalFunctionUrl("hubsoft-webhook");
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
  trial_enabled: boolean;
  trial_days: number;
  trial_category_ids: string[];
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
  trial_enabled: false,
  trial_days: 30,
  trial_category_ids: [],
};

async function syncCategoriesToExistingUsers(configId: string, categoryIds: string[]): Promise<number> {
  // Pega todos os usuários que já foram criados por essa integração
  const { data: existingAccess, error: accessErr } = await supabase
    .from("user_category_access")
    .select("user_id")
    .eq("hubsoft_config_id", configId);
  if (accessErr) throw accessErr;

  const userIds = Array.from(new Set((existingAccess ?? []).map((a) => a.user_id)));
  if (userIds.length === 0) return 0;

  // Remove acessos antigos vinculados a essa integração
  const { error: delErr } = await supabase
    .from("user_category_access")
    .delete()
    .eq("hubsoft_config_id", configId)
    .in("user_id", userIds);
  if (delErr) throw delErr;

  // Insere novos acessos pra cada user × cada categoria selecionada
  if (categoryIds.length > 0) {
    const rows = userIds.flatMap((uid) =>
      categoryIds.map((cid) => ({
        user_id: uid,
        category_id: cid,
        hubsoft_config_id: configId,
        is_active: true,
      })),
    );
    const { error: insErr } = await supabase
      .from("user_category_access")
      .upsert(rows, { onConflict: "user_id,category_id" });
    if (insErr) throw insErr;
  }

  return userIds.length;
}

async function syncTrialToExistingUsers(
  configId: string,
  trialCategoryIds: string[],
  trialDays: number,
): Promise<number> {
  // Pega TODOS os usuários cadastrados via Hubsoft (qualquer integração),
  // não apenas os que já estavam vinculados a essa config.
  const { data: hubsoftProfiles, error: profErr } = await supabase
    .from("profiles")
    .select("user_id")
    .not("hubsoft_client_id", "is", null);
  if (profErr) throw profErr;

  // Também inclui quem já tem qualquer linha em user_category_access dessa config
  const { data: existingAccess, error: accessErr } = await supabase
    .from("user_category_access")
    .select("user_id")
    .eq("hubsoft_config_id", configId);
  if (accessErr) throw accessErr;

  const userIds = Array.from(
    new Set([
      ...(hubsoftProfiles ?? []).map((p) => p.user_id),
      ...(existingAccess ?? []).map((a) => a.user_id),
    ]),
  );
  if (userIds.length === 0) return 0;
  if (trialCategoryIds.length === 0) return 0;

  // Preserva trial_expires_at de quem já tem trial ativo dessa config.
  // Só atribui nova data (agora + trialDays) pra quem nunca teve trial aqui.
  const { data: existingTrials, error: existErr } = await supabase
    .from("user_category_access")
    .select("user_id, trial_expires_at")
    .eq("hubsoft_config_id", configId)
    .eq("is_trial", true)
    .in("user_id", userIds);
  if (existErr) throw existErr;

  // Pega a maior trial_expires_at por user (caso haja múltiplas categorias)
  const existingExpiryByUser = new Map<string, string>();
  for (const row of existingTrials ?? []) {
    if (!row.trial_expires_at) continue;
    const prev = existingExpiryByUser.get(row.user_id);
    if (!prev || new Date(row.trial_expires_at) > new Date(prev)) {
      existingExpiryByUser.set(row.user_id, row.trial_expires_at);
    }
  }

  const freshExpiry = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toISOString();

  // Limpa apenas o vínculo dessa config pros users alvo (sem mexer em trial_expires_at de outras configs)
  const { error: delErr1 } = await supabase
    .from("user_category_access")
    .delete()
    .eq("hubsoft_config_id", configId)
    .in("user_id", userIds);
  if (delErr1) throw delErr1;

  // Limpa também conflitos por (user_id, category_id) das categorias de trial
  const { error: delErr2 } = await supabase
    .from("user_category_access")
    .delete()
    .in("user_id", userIds)
    .in("category_id", trialCategoryIds);
  if (delErr2) throw delErr2;

  const rows = userIds.flatMap((uid) => {
    const expiresAt = existingExpiryByUser.get(uid) ?? freshExpiry;
    return trialCategoryIds.map((cid) => ({
      user_id: uid,
      category_id: cid,
      hubsoft_config_id: configId,
      is_active: true,
      is_trial: true,
      trial_expires_at: expiresAt,
    }));
  });
  const { error: insErr } = await supabase
    .from("user_category_access")
    .upsert(rows, { onConflict: "user_id,category_id" });
  if (insErr) throw insErr;

  return userIds.length;
}

const HubsoftIntegration = () => {
  const { data: configs, isLoading } = useHubsoftConfigs();
  const { data: configCategories } = useHubsoftConfigCategories();
  const { data: trialConfigCategories } = useHubsoftConfigTrialCategories();
  const { data: categories } = useCategories();
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [applyToExisting, setApplyToExisting] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const handleSyncExisting = async (configId: string, categoryIds: string[], configName: string) => {
    if (!confirm(`Aplicar as ${categoryIds.length} categoria(s) atuais de "${configName}" a TODOS os usuários já cadastrados por essa integração? Os acessos anteriores vinculados a ela serão substituídos.`)) return;
    setSyncingId(configId);
    try {
      const count = await syncCategoriesToExistingUsers(configId, categoryIds);
      toast.success(count > 0 ? `Categorias aplicadas a ${count} usuário(s)` : "Nenhum usuário cadastrado por essa integração");
    } catch (e) {
      toast.error("Erro ao sincronizar: " + getErrorMessage(e));
    } finally {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setSyncingId(null);
    }
  };

  const handleSyncTrialExisting = async (
    configId: string,
    trialCategoryIds: string[],
    trialDays: number,
    configName: string,
  ) => {
    if (trialCategoryIds.length === 0) {
      toast.error("Nenhuma categoria de degustação configurada");
      return;
    }
    if (
      !confirm(
        `Aplicar DEGUSTAÇÃO (${trialCategoryIds.length} categoria(s), ${trialDays} dias) a TODOS os usuários de "${configName}"? Os acessos atuais vinculados a ela serão substituídos. A expiração será contada a partir de agora.`,
      )
    )
      return;
    setSyncingId(configId);
    try {
      const count = await syncTrialToExistingUsers(configId, trialCategoryIds, trialDays);
      toast.success(count > 0 ? `Degustação aplicada a ${count} usuário(s)` : "Nenhum usuário cadastrado por essa integração");
    } catch (e) {
      toast.error("Erro ao aplicar degustação: " + getErrorMessage(e));
    } finally {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["user_trial_access"] });
      setSyncingId(null);
    }
  };

  const getCategoryIdsForConfig = (configId: string) => {
    return configCategories?.filter((cc) => cc.hubsoft_config_id === configId).map((cc) => cc.category_id) || [];
  };

  const getTrialCategoryIdsForConfig = (configId: string) => {
    return trialConfigCategories?.filter((cc) => cc.hubsoft_config_id === configId).map((cc) => cc.category_id) || [];
  };

  const startNew = () => {
    setEditingId(null);
    setForm({ ...emptyForm, api_key: generateApiKey() });
    setApplyToExisting(false);
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
      trial_enabled: !!config.trial_enabled,
      trial_days: Number(config.trial_days) || 30,
      trial_category_ids: getTrialCategoryIdsForConfig(config.id),
    });
    setApplyToExisting(false);
    setShowForm(true);
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm({ ...emptyForm });
    setApplyToExisting(false);
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
      trial_enabled: form.trial_enabled,
      trial_days: Math.max(1, Number(form.trial_days) || 30),
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

    // Sync categories (normal + trial)
    if (configId) {
      await supabase.from("hubsoft_config_categories").delete().eq("hubsoft_config_id", configId);
      if (form.category_ids.length > 0) {
        const rows = form.category_ids.map((cid) => ({
          hubsoft_config_id: configId!,
          category_id: cid,
        }));
        await supabase.from("hubsoft_config_categories").insert(rows);
      }

      await supabase.from("hubsoft_config_trial_categories").delete().eq("hubsoft_config_id", configId);
      if (form.trial_enabled && form.trial_category_ids.length > 0) {
        const trialRows = form.trial_category_ids.map((cid) => ({
          hubsoft_config_id: configId!,
          category_id: cid,
        }));
        await supabase.from("hubsoft_config_trial_categories").insert(trialRows);
      }
    }

    let syncedCount = 0;
    let syncedTrial = false;
    if (configId && applyToExisting) {
      try {
        if (form.trial_enabled) {
          if (form.trial_category_ids.length === 0) {
            toast.error("Integração salva, mas não apliquei degustação: selecione ao menos uma categoria de degustação.");
          } else {
            syncedCount = await syncTrialToExistingUsers(
              configId,
              form.trial_category_ids,
              Math.max(1, Number(form.trial_days) || 30),
            );
            syncedTrial = true;
          }
        } else {
          syncedCount = await syncCategoriesToExistingUsers(configId, form.category_ids);
        }
      } catch (e) {
        toast.error("Integração salva, mas erro ao aplicar a usuários: " + getErrorMessage(e));
      }
    }

    setSaving(false);
    const baseMsg = editingId ? "Integração atualizada!" : "Integração criada!";
    toast.success(
      applyToExisting && syncedCount > 0
        ? `${baseMsg} ${syncedTrial ? "Degustação aplicada" : "Categorias aplicadas"} a ${syncedCount} usuário(s).`
        : baseMsg,
    );
    cancelForm();
    queryClient.invalidateQueries({ queryKey: ["hubsoft-configs"] });
    queryClient.invalidateQueries({ queryKey: ["hubsoft-config-categories"] });
    queryClient.invalidateQueries({ queryKey: ["hubsoft-config-trial-categories"] });
    queryClient.invalidateQueries({ queryKey: ["users"] });
    queryClient.invalidateQueries({ queryKey: ["profiles"] });
    queryClient.invalidateQueries({ queryKey: ["user_trial_access"] });
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
      queryClient.invalidateQueries({ queryKey: ["hubsoft-config-trial-categories"] });
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

  const toggleTrialCategory = (categoryId: string) => {
    setForm((f) => ({
      ...f,
      trial_category_ids: f.trial_category_ids.includes(categoryId)
        ? f.trial_category_ids.filter((id) => id !== categoryId)
        : [...f.trial_category_ids, categoryId],
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

            {/* Trial / Degustação */}
            <div className="space-y-3 rounded-lg border border-border p-3 bg-secondary/30">
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.trial_enabled}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, trial_enabled: v }))}
                />
                <Label className="cursor-pointer">Ativar período de degustação</Label>
              </div>
              <p className="text-xs text-muted-foreground">
                Novos usuários cadastrados por esta integração recebem as categorias de degustação por X dias. Ao expirar, os acessos voltam automaticamente para as categorias normais acima.
              </p>

              {form.trial_enabled && (
                <>
                  <div className="space-y-2">
                    <Label>Dias de degustação</Label>
                    <Input
                      type="number"
                      min={1}
                      max={365}
                      value={form.trial_days}
                      onChange={(e) => setForm((f) => ({ ...f, trial_days: parseInt(e.target.value || "0", 10) }))}
                      className="max-w-[140px]"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Categorias de degustação</Label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                      {categories?.map((cat) => (
                        <label key={cat.id} className="flex items-center gap-2 p-2 rounded-lg bg-secondary cursor-pointer hover:bg-secondary/80">
                          <Checkbox
                            checked={form.trial_category_ids.includes(cat.id)}
                            onCheckedChange={() => toggleTrialCategory(cat.id)}
                          />
                          <span className="text-sm text-foreground">{cat.name}</span>
                        </label>
                      ))}
                      {(!categories || categories.length === 0) && (
                        <p className="text-xs text-muted-foreground">Nenhuma categoria cadastrada</p>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {editingId && (
              <label className="flex items-start gap-2 p-3 rounded-lg border border-border bg-secondary/40 cursor-pointer">
                <Checkbox
                  checked={applyToExisting}
                  onCheckedChange={(v) => setApplyToExisting(v === true)}
                  className="mt-0.5"
                />
                <div className="text-sm">
                  <p className="font-medium text-foreground">Aplicar também aos usuários já cadastrados</p>
                  <p className="text-xs text-muted-foreground">
                    Se a degustação estiver ativa, aplica as categorias de degustação com nova expiração; caso contrário, aplica as categorias normais selecionadas acima.
                  </p>
                </div>
              </label>
            )}

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
                      <Button variant="ghost" size="sm" onClick={() => copyToClipboard(buildCallbackUrl(config.api_key), "URL")} title="Copiar URL">
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSyncExisting(config.id, catIds, config.name)}
                        disabled={syncingId === config.id}
                        title="Aplicar categorias atuais a todos os usuários desta integração"
                      >
                        <RefreshCw className={`h-4 w-4 ${syncingId === config.id ? "animate-spin" : ""}`} />
                      </Button>
                      {config.trial_enabled && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            handleSyncTrialExisting(
                              config.id,
                              getTrialCategoryIdsForConfig(config.id),
                              Number(config.trial_days) || 30,
                              config.name,
                            )
                          }
                          disabled={syncingId === config.id}
                          title="Aplicar período de degustação a todos os usuários desta integração"
                        >
                          🎁
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => startEdit(config)} title="Editar">
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(config.id)} title="Excluir">
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
