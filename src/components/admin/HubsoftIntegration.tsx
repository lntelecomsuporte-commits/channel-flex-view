import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Save, Copy } from "lucide-react";

function useHubsoftConfig() {
  return useQuery({
    queryKey: ["hubsoft-config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hubsoft_config")
        .select("*")
        .limit(1)
        .single();
      if (error) throw error;
      return data;
    },
  });
}

const HubsoftIntegration = () => {
  const { data: config, isLoading } = useHubsoftConfig();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    api_url: "",
    client_id: "",
    client_secret: "",
    username: "",
    password: "",
    package_id: "",
    is_active: false,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (config) {
      setForm({
        api_url: config.api_url,
        client_id: config.client_id,
        client_secret: config.client_secret,
        username: config.username,
        password: config.password,
        package_id: config.package_id,
        is_active: config.is_active,
      });
    }
  }, [config]);

  const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/hubsoft-webhook`;

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    const { error } = await supabase
      .from("hubsoft_config")
      .update(form)
      .eq("id", config.id);
    setSaving(false);

    if (error) {
      toast.error("Erro ao salvar: " + error.message);
    } else {
      toast.success("Configuração salva!");
      queryClient.invalidateQueries({ queryKey: ["hubsoft-config"] });
    }
  };

  const copyWebhook = () => {
    navigator.clipboard.writeText(webhookUrl);
    toast.success("URL do webhook copiada!");
  };

  if (isLoading) {
    return <p className="text-muted-foreground">Carregando...</p>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Webhook URL</CardTitle>
          <CardDescription>
            Configure esta URL no Hubsoft para receber notificações de criação, bloqueio e exclusão de clientes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <Input value={webhookUrl} readOnly className="font-mono text-xs" />
            <Button variant="outline" size="sm" onClick={copyWebhook}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-4 text-sm text-muted-foreground space-y-1">
            <p><strong>Ações suportadas:</strong></p>
            <ul className="list-disc list-inside space-y-1">
              <li><code>create</code> — Cria usuário de TV (email + senha)</li>
              <li><code>block</code> — Bloqueia o acesso do usuário</li>
              <li><code>unblock</code> — Desbloqueia o acesso do usuário</li>
              <li><code>delete</code> — Exclui o usuário de TV</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Configuração da API Hubsoft</CardTitle>
          <CardDescription>
            Credenciais para conectar com a API do Hubsoft (opcional, para sincronização ativa).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <Switch checked={form.is_active} onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))} />
            <Label>Integração ativa</Label>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>URL da API</Label>
              <Input value={form.api_url} onChange={(e) => setForm((f) => ({ ...f, api_url: e.target.value }))} placeholder="https://api.seuprovedor.com.br" />
            </div>
            <div className="space-y-2">
              <Label>Client ID</Label>
              <Input value={form.client_id} onChange={(e) => setForm((f) => ({ ...f, client_id: e.target.value }))} placeholder="89" />
            </div>
            <div className="space-y-2">
              <Label>Client Secret</Label>
              <Input type="password" value={form.client_secret} onChange={(e) => setForm((f) => ({ ...f, client_secret: e.target.value }))} placeholder="Secret" />
            </div>
            <div className="space-y-2">
              <Label>Username</Label>
              <Input value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} placeholder="api@provedor.com" />
            </div>
            <div className="space-y-2">
              <Label>Password</Label>
              <Input type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder="Senha" />
            </div>
            <div className="space-y-2">
              <Label>ID do Pacote</Label>
              <Input value={form.package_id} onChange={(e) => setForm((f) => ({ ...f, package_id: e.target.value }))} placeholder="ID do pacote de TV no Hubsoft" />
            </div>
          </div>
          <Button onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4 mr-1" /> {saving ? "Salvando..." : "Salvar Configuração"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default HubsoftIntegration;
