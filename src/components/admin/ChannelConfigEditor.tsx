import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabaseLocal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Copy, RefreshCw, Save } from "lucide-react";
import { parseChannelConfig, serializeChannels } from "@/lib/channelConfig";
import type { Channel, Category } from "@/hooks/useChannels";

type Props = {
  channels: Channel[] | undefined;
  categories: Category[] | undefined;
};

const ChannelConfigEditor = ({ channels, categories }: Props) => {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const categoryNameById = useMemo(() => {
    const map: Record<string, string> = {};
    (categories ?? []).forEach((c) => { map[c.id] = c.name; });
    return map;
  }, [categories]);

  const categoryIdByName = useMemo(() => {
    const map: Record<string, string> = {};
    (categories ?? []).forEach((c) => { map[c.name.trim().toLowerCase()] = c.id; });
    return map;
  }, [categories]);

  const reload = () => {
    if (!channels) return;
    setText(serializeChannels(channels as never, categoryNameById));
    setDirty(false);
  };

  useEffect(() => {
    if (!dirty) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels, categoryNameById]);

  const parsed = useMemo(() => parseChannelConfig(text), [text]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Configuração copiada");
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  const handleSave = async () => {
    const { channels: parsedChannels, errors } = parsed;
    if (errors.length) {
      toast.error("Corrija os erros antes de salvar", { description: errors.slice(0, 4).join("\n") });
      return;
    }
    if (!parsedChannels.length) {
      toast.error("Nenhum canal encontrado no texto");
      return;
    }

    setSaving(true);
    let updated = 0, created = 0;
    const failures: string[] = [];
    const missingCats = new Set<string>();

    for (const c of parsedChannels) {
      let categoryId: string | null = null;
      if (c.category_name) {
        categoryId = categoryIdByName[c.category_name.trim().toLowerCase()] ?? null;
        if (!categoryId) missingCats.add(c.category_name);
      }

      const isExternalLogo = !!c.logo_url && !c.logo_url.startsWith("/logos/");
      const payload: Record<string, unknown> = {
        name: c.name,
        channel_number: c.channel_number,
        stream_url: c.stream_url,
        backup_stream_urls: c.backup_stream_urls,
        logo_url: c.logo_url,
        category_id: categoryId,
        is_active: c.is_active,
        is_adult: c.is_adult,
        epg_type: c.epg_type,
        epg_url: c.epg_url,
        epg_channel_id: c.epg_channel_id,
        epg_alt_text: c.epg_alt_text,
        epg_show_synopsis: c.epg_show_synopsis,
        epg_grab_logo: c.epg_grab_logo,
        use_proxy_token: c.use_proxy_token,
        force_proxy_native: c.force_proxy_native,
        prefer_sw_decoder: c.prefer_sw_decoder,
      };
      if (isExternalLogo) payload.logo_source_url = c.logo_url;
      else if (!c.logo_url) payload.logo_source_url = null;

      if (c.id) {
        const { error } = await supabase.from("channels").update(payload as never).eq("id", c.id);
        if (error) failures.push(`${c.name}: ${error.message}`);
        else updated++;
      } else {
        const { error } = await supabase.from("channels").insert(payload as never);
        if (error) failures.push(`${c.name}: ${error.message}`);
        else created++;
      }
    }

    setSaving(false);
    setDirty(false);
    queryClient.invalidateQueries({ queryKey: ["channels-all"] });
    queryClient.invalidateQueries({ queryKey: ["channels"] });

    if (failures.length) {
      toast.error(`${failures.length} canal(is) com erro`, { description: failures.slice(0, 4).join("\n") });
    } else {
      toast.success(`Configuração salva: ${updated} atualizados, ${created} criados`);
    }
    if (missingCats.size) {
      toast.warning("Categorias não encontradas", { description: Array.from(missingCats).join(", ") });
    }
  };

  const removedCount = Math.max(
    0,
    (channels?.length ?? 0) - parsed.channels.filter((c) => c.id).length
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
        <div>
          <CardTitle>Editor de Configuração</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            {parsed.channels.length} canais identificados
            {parsed.errors.length > 0 && ` · ${parsed.errors.length} erro(s)`}
            {removedCount > 0 && ` · ${removedCount} canal(is) do banco fora do texto (não serão apagados)`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleCopy}>
            <Copy className="h-4 w-4 mr-1" /> Copiar
          </Button>
          <Button variant="outline" size="sm" onClick={reload}>
            <RefreshCw className="h-4 w-4 mr-1" /> Recarregar
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || parsed.errors.length > 0}>
            <Save className="h-4 w-4 mr-1" /> {saving ? "Salvando..." : "Salvar Configuração"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {parsed.errors.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive space-y-1 max-h-40 overflow-auto">
            {parsed.errors.slice(0, 20).map((e, i) => <div key={i}>{e}</div>)}
            {parsed.errors.length > 20 && <div>… e mais {parsed.errors.length - 20}</div>}
          </div>
        )}
        <Textarea
          value={text}
          onChange={(e) => { setText(e.target.value); setDirty(true); }}
          spellCheck={false}
          className="font-mono text-xs leading-5 min-h-[65vh] whitespace-pre"
          placeholder="Carregando canais..."
        />
      </CardContent>
    </Card>
  );
};

export default ChannelConfigEditor;
