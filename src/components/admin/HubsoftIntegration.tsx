import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Save, Copy, RefreshCw } from "lucide-react";

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

function generateApiKey() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let key = "";
  for (let i = 0; i < 32; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
}

const HubsoftIntegration = () => {
  const { data: config, isLoading } = useHubsoftConfig();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    api_url: "",
    api_key: "",
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
        api_key: config.api_key,
        username: config.username,
        password: config.password,
        package_id: config.package_id,
        is_active: config.is_active,
      });
    }
  }, [config]);

  const callbackUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/hubsoft-webhook`;

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

  const handleGenerateApiKey = () => {
    const key = generateApiKey();
    setForm((f) => ({ ...f, api_key: key }));
    toast.info("API Key gerada! Clique em Salvar para confirmar.");
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copiado!`);
  };

  if (isLoading) {
    return <p className="text-muted-foreground">Carregando...</p>;
  }

  return (
    <div className="space-y-6">
      {/* Callback URL */}
      <Card>
        <CardHeader>
          <CardTitle>Callback URL</CardTitle>
          <CardDescription>
            Configure esta URL como Callback URL da integração de Plataforma de Conteúdo no Hubsoft.
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

      {/* Parâmetros para configurar no Hubsoft */}
      <Card>
        <CardHeader>
          <CardTitle>Parâmetros para o Hubsoft</CardTitle>
          <CardDescription>
            Configure estes parâmetros na integração do Hubsoft. Copie os valores e cole no campo "Valor" de cada parâmetro.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* API Key */}
          <div className="space-y-2">
            <Label>Parâmetro 1: <code className="text-xs bg-muted px-1 py-0.5 rounded">api_key</code></Label>
            <div className="flex items-center gap-2">
              <Input value={form.api_key} readOnly className="font-mono text-xs" placeholder="Clique em Gerar para criar uma API Key" />
              <Button variant="outline" size="sm" onClick={handleGenerateApiKey} title="Gerar nova API Key">
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => copyToClipboard(form.api_key, "API Key")} disabled={!form.api_key}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Login */}
          <div className="space-y-2">
            <Label>Parâmetro 2: <code className="text-xs bg-muted px-1 py-0.5 rounded">login</code></Label>
            <div className="flex items-center gap-2">
              <Input
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                placeholder="Seu login de identificação"
              />
              <Button variant="outline" size="sm" onClick={() => copyToClipboard(form.username, "Login")} disabled={!form.username}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Senha */}
          <div className="space-y-2">
            <Label>Parâmetro 3: <code className="text-xs bg-muted px-1 py-0.5 rounded">senha</code></Label>
            <div className="flex items-center gap-2">
              <Input
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="Sua senha de autenticação"
              />
              <Button variant="outline" size="sm" onClick={() => copyToClipboard(form.password, "Senha")} disabled={!form.password}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* API URL */}
          <div className="space-y-2">
            <Label>Parâmetro 4: <code className="text-xs bg-muted px-1 py-0.5 rounded">api_url</code></Label>
            <div className="flex items-center gap-2">
              <Input value={callbackUrl} readOnly className="font-mono text-xs" />
              <Button variant="outline" size="sm" onClick={() => copyToClipboard(callbackUrl, "API URL")}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="mt-4 p-4 bg-muted/50 rounded-lg text-sm text-muted-foreground space-y-2">
            <p><strong>📋 Como configurar no Hubsoft:</strong></p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Vá em <strong>Integrações → Plataforma de Conteúdo</strong></li>
              <li>Cole a <strong>Callback URL</strong> acima</li>
              <li>Marque <strong>"Pacote único"</strong></li>
              <li>Marque <strong>"Habilitar/Suspender Assinaturas"</strong></li>
              <li>Adicione os 4 parâmetros acima com seus respectivos valores</li>
              <li>Salve a integração</li>
            </ol>
          </div>
        </CardContent>
      </Card>

      {/* Configurações internas */}
      <Card>
        <CardHeader>
          <CardTitle>Configurações da Integração</CardTitle>
          <CardDescription>
            Configurações internas do sistema. O ID do pacote é opcional.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <Switch checked={form.is_active} onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))} />
            <Label>Integração ativa</Label>
          </div>
          <div className="space-y-2">
            <Label>ID do Pacote (opcional)</Label>
            <Input value={form.package_id} onChange={(e) => setForm((f) => ({ ...f, package_id: e.target.value }))} placeholder="ID do pacote de TV no Hubsoft" />
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
