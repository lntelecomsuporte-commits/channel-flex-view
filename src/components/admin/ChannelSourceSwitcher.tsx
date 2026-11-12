import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabaseLocal";
import { sendAppCommand } from "@/lib/appCommands";
import {
  normalizeSourceOrigin,
  planChannelSourceSwitch,
  type ChannelSourceSwitchMode,
} from "@/lib/channelSourceSwitch";
import type { Channel } from "@/hooks/useChannels";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

type Props = {
  channels: Channel[] | undefined;
  canReloadAll: boolean;
};

type SwitchResult = {
  matched_count: number;
  updated_count: number;
  skipped_without_backup: number;
};

const ChannelSourceSwitcher = ({ channels, canReloadAll }: Props) => {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ChannelSourceSwitchMode>("invert");
  const [source, setSource] = useState("");
  const [replacement, setReplacement] = useState("");
  const [saveOldAsBackup, setSaveOldAsBackup] = useState(true);
  const [autoReload, setAutoReload] = useState(canReloadAll);
  const [saving, setSaving] = useState(false);

  const sourceOrigin = normalizeSourceOrigin(source);
  const replacementOrigin = normalizeSourceOrigin(replacement);
  const sourceInvalid = source.trim().length > 0 && !sourceOrigin;
  const replacementInvalid = mode === "replace" && replacement.trim().length > 0 && !replacementOrigin;
  const sameOrigins = mode === "replace" && !!sourceOrigin && sourceOrigin === replacementOrigin;

  const plan = useMemo(() => planChannelSourceSwitch(channels ?? [], {
    mode,
    sourceOrigin,
    replacementOrigin: replacementOrigin ?? undefined,
    saveOldAsBackup,
  }), [channels, mode, sourceOrigin, replacementOrigin, saveOldAsBackup]);
  const updates = plan.filter((item) => item.nextStreamUrl !== null);
  const missingBackup = plan.length - updates.length;

  const handleApply = async () => {
    if (!sourceOrigin || updates.length === 0 || saving || replacementInvalid || sameOrigins) return;
    if (mode === "replace" && !replacementOrigin) return;

    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("switch_channel_sources", {
        _mode: mode,
        _source_origin: sourceOrigin,
        _replacement_origin: mode === "replace" ? replacementOrigin : null,
        _save_old_as_backup: saveOldAsBackup,
      });
      if (error) throw error;
      const result = (data as SwitchResult[] | null)?.[0];
      if (!result) throw new Error("O banco não retornou o resultado da operação.");

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["channels-all"] }),
        queryClient.invalidateQueries({ queryKey: ["channels"] }),
      ]);
      toast.success(`${result.updated_count} canal(is) alterado(s)`, {
        description: result.skipped_without_backup > 0
          ? `${result.skipped_without_backup} sem backup foram mantidos sem alteração.`
          : undefined,
      });
      setOpen(false);

      if (autoReload && canReloadAll && result.updated_count > 0) {
        await sendAppCommand("reload_channels", null, undefined, { confirm: false });
      }
    } catch (error) {
      toast.error("Erro ao alterar as fontes", {
        description: error instanceof Error ? error.message : "Tente novamente.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) setOpen(next); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ArrowLeftRight className="h-4 w-4 mr-1" /> Alterar fonte
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Alterar fonte dos canais</DialogTitle>
          <DialogDescription>
            Localiza as URLs principais pelo endereço e porta. Confira a prévia antes de salvar.
          </DialogDescription>
        </DialogHeader>

        <RadioGroup value={mode} onValueChange={(value) => setMode(value as ChannelSourceSwitchMode)} className="grid gap-3 md:grid-cols-2">
          <Label htmlFor="source-mode-invert" className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-4 font-normal">
            <RadioGroupItem id="source-mode-invert" value="invert" className="mt-0.5" />
            <span>
              <span className="block font-medium text-foreground">Inverter com o backup</span>
              <span className="mt-1 block text-xs text-muted-foreground">O backup 1 vira principal e a URL atual passa a ser o backup 1.</span>
            </span>
          </Label>
          <Label htmlFor="source-mode-replace" className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-4 font-normal">
            <RadioGroupItem id="source-mode-replace" value="replace" className="mt-0.5" />
            <span>
              <span className="block font-medium text-foreground">Substituir endereço</span>
              <span className="mt-1 block text-xs text-muted-foreground">Troca somente o endereço e porta, preservando o caminho de cada canal.</span>
            </span>
          </Label>
        </RadioGroup>

        <div className={`grid gap-4 ${mode === "replace" ? "md:grid-cols-2" : ""}`}>
          <div className="space-y-2">
            <Label htmlFor="source-origin">Endereço atual</Label>
            <Input
              id="source-origin"
              value={source}
              onChange={(event) => setSource(event.target.value)}
              placeholder="http://178.92.163.93:5001"
              className="font-mono text-xs"
            />
            {sourceInvalid && <p className="text-xs text-destructive">Informe uma URL HTTP ou HTTPS válida.</p>}
          </div>
          {mode === "replace" && (
            <div className="space-y-2">
              <Label htmlFor="replacement-origin">Novo endereço</Label>
              <Input
                id="replacement-origin"
                value={replacement}
                onChange={(event) => setReplacement(event.target.value)}
                placeholder="http://151.242.41.43:5001"
                className="font-mono text-xs"
              />
              {replacementInvalid && <p className="text-xs text-destructive">Informe uma URL HTTP ou HTTPS válida.</p>}
              {sameOrigins && <p className="text-xs text-destructive">O novo endereço precisa ser diferente do atual.</p>}
            </div>
          )}
        </div>

        <div className="space-y-3">
          {mode === "replace" && (
            <Label className="flex cursor-pointer items-start gap-2 font-normal">
              <Checkbox checked={saveOldAsBackup} onCheckedChange={(checked) => setSaveOldAsBackup(checked === true)} />
              <span className="text-sm">Salvar a URL principal antiga como backup antes de substituir</span>
            </Label>
          )}
          {canReloadAll && (
            <Label className="flex cursor-pointer items-start gap-2 font-normal">
              <Checkbox checked={autoReload} onCheckedChange={(checked) => setAutoReload(checked === true)} />
              <span>
                <span className="block text-sm">Recarregar os canais nos apps compatíveis após salvar</span>
                <span className="block text-xs text-muted-foreground">O comando chega em até 30 segundos; nenhum link de lista M3U é alterado.</span>
              </span>
            </Label>
          )}
        </div>

        <div className="rounded-lg border border-border">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-4 py-3">
            <p className="text-sm font-medium">Prévia em tempo real</p>
            <p className="text-xs text-muted-foreground">
              {plan.length} encontrado(s) · {updates.length} será(ão) alterado(s)
            </p>
          </div>
          <div className="max-h-[38vh] overflow-y-auto">
            {!sourceOrigin ? (
              <p className="p-6 text-center text-sm text-muted-foreground">Digite o endereço atual para localizar os canais.</p>
            ) : plan.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">Nenhum canal usa esse endereço na URL principal.</p>
            ) : (
              <div className="divide-y divide-border">
                {plan.map(({ channel, nextStreamUrl, skippedReason }) => (
                  <div key={channel.id} className="grid gap-2 p-4 md:grid-cols-[160px_1fr]">
                    <div>
                      <p className="text-sm font-medium">{channel.channel_number} · {channel.name}</p>
                      {skippedReason ? (
                        <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
                          <TriangleAlert className="h-3.5 w-3.5" /> Sem backup — não será alterado
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-muted-foreground">Pronto para alterar</p>
                      )}
                    </div>
                    <div className="min-w-0 space-y-1 font-mono text-xs">
                      <p className="break-all text-muted-foreground">De: {channel.stream_url}</p>
                      <p className="break-all text-foreground">Para: {nextStreamUrl ?? "mantida sem alteração"}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {missingBackup > 0 && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            {missingBackup} canal(is) sem backup serão ignorados no modo de inversão.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
          <Button
            onClick={handleApply}
            disabled={saving || !sourceOrigin || updates.length === 0 || replacementInvalid || sameOrigins || (mode === "replace" && !replacementOrigin)}
          >
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ArrowLeftRight className="h-4 w-4 mr-2" />}
            {saving ? "Alterando..." : `Confirmar alteração em ${updates.length} canal(is)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ChannelSourceSwitcher;
