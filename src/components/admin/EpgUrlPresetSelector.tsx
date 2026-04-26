import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabaseLocal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ChevronsUpDown, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface Preset {
  id: string;
  epg_type: string;
  name: string;
  url: string;
}

interface Props {
  epgType: string;
  currentUrl: string;
  /** Called when the primary URL (used for save) changes */
  onSelect: (url: string) => void;
  /** Called with the full list of selected URLs (used for multi-source channel search) */
  onUrlsChange?: (urls: string[]) => void;
}

const PRESET_TABLE = "epg_url_presets" as const;

export default function EpgUrlPresetSelector({ epgType, currentUrl, onSelect, onUrlsChange }: Props) {
  const qc = useQueryClient();

  const { data: presets = [] } = useQuery({
    queryKey: ["epg_url_presets", epgType],
    enabled: !!epgType,
    queryFn: async () => {
      const { data, error } = await supabase
        .from(PRESET_TABLE)
        .select("*")
        .eq("epg_type", epgType)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data || []) as Preset[];
    },
  });

  // Multi-selection state (preset IDs). Resets when epg type changes.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [popoverOpen, setPopoverOpen] = useState(false);

  useEffect(() => {
    setSelectedIds([]);
  }, [epgType]);

  // Notify parent whenever the resolved URLs change
  useEffect(() => {
    const urls = selectedIds
      .map((id) => presets.find((p) => p.id === id)?.url)
      .filter((u): u is string => !!u);
    onUrlsChange?.(urls);
  }, [selectedIds, presets, onUrlsChange]);

  const toggleSelected = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = checked ? [...prev, id] : prev.filter((x) => x !== id);
      // Apenas preenche o campo "URL do XML" quando há EXATAMENTE 1 URL selecionada.
      // Com múltiplas selecionadas, deixa o campo vazio — o usuário usa a busca,
      // e a URL correta é preenchida via onResolve ao clicar no canal encontrado.
      if (next.length === 1) {
        const onlyUrl = presets.find((p) => p.id === next[0])?.url || "";
        if (onlyUrl) onSelect(onlyUrl);
      } else {
        onSelect("");
      }
      return next;
    });
  };

  // Dialog (add/edit) state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Preset | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!dialogOpen) return;
    if (editing) {
      setName(editing.name);
      setUrl(editing.url);
    } else {
      setName("");
      setUrl(currentUrl || "");
    }
  }, [dialogOpen, editing, currentUrl]);

  const handleSave = async () => {
    if (!name.trim() || !url.trim()) {
      toast.error("Nome e URL são obrigatórios");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const { error } = await supabase
          .from(PRESET_TABLE)
          .update({ name: name.trim(), url: url.trim() })
          .eq("id", editing.id);
        if (error) throw error;
        toast.success("URL atualizada");
      } else {
        const { error } = await supabase
          .from(PRESET_TABLE)
          .insert({ epg_type: epgType, name: name.trim(), url: url.trim() });
        if (error) throw error;
        toast.success("URL salva");
      }
      qc.invalidateQueries({ queryKey: ["epg_url_presets", epgType] });
      setDialogOpen(false);
      setEditing(null);
    } catch (e: any) {
      toast.error(e.message || "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editing) return;
    if (!confirm(`Remover "${editing.name}"?`)) return;
    setSaving(true);
    try {
      const { error } = await supabase.from(PRESET_TABLE).delete().eq("id", editing.id);
      if (error) throw error;
      toast.success("URL removida");
      qc.invalidateQueries({ queryKey: ["epg_url_presets", epgType] });
      setSelectedIds((prev) => prev.filter((id) => id !== editing.id));
      setDialogOpen(false);
      setEditing(null);
    } catch (e: any) {
      toast.error(e.message || "Erro ao remover");
    } finally {
      setSaving(false);
    }
  };

  // For the edit button — only enabled when exactly 1 selected
  const singleSelected = selectedIds.length === 1
    ? presets.find((p) => p.id === selectedIds[0]) || null
    : null;

  const buttonLabel = selectedIds.length === 0
    ? (presets.length ? "Selecionar URLs salvas" : "Nenhuma URL salva")
    : selectedIds.length === 1
      ? (presets.find((p) => p.id === selectedIds[0])?.name || "1 URL")
      : `${selectedIds.length} URLs selecionadas`;

  return (
    <div className="flex gap-2 items-end">
      <div className="flex-1 min-w-0">
        <Label className="text-xs text-muted-foreground mb-1 block">
          URLs salvas {selectedIds.length > 1 && <span className="text-primary">(use a busca — a URL será preenchida ao escolher o canal)</span>}
        </Label>
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="w-full justify-between font-normal"
              disabled={!presets.length}
            >
              <span className="truncate">{buttonLabel}</span>
              <ChevronsUpDown className="h-4 w-4 ml-2 opacity-50 shrink-0" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
            <div className="max-h-[280px] overflow-y-auto p-1">
              {presets.map((p) => {
                const checked = selectedIds.includes(p.id);
                return (
                  <label
                    key={p.id}
                    className="flex items-center gap-2 px-2 py-2 rounded-sm hover:bg-accent cursor-pointer text-sm"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => toggleSelected(p.id, !!v)}
                    />
                    <span className="flex-1 truncate">{p.name}</span>
                  </label>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) setEditing(null); }}>
        <DialogTrigger asChild>
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(null)} title="Adicionar URL">
            <Plus className="h-4 w-4" />
          </Button>
        </DialogTrigger>
        {singleSelected && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => { setEditing(singleSelected); setDialogOpen(true); }}
            title="Editar URL selecionada"
          >
            <Pencil className="h-4 w-4" />
          </Button>
        )}
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar URL salva" : "Nova URL"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Nome</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Brasil 1" />
            </div>
            <div className="space-y-1">
              <Label>URL</Label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
            </div>
          </div>
          <DialogFooter className="gap-2">
            {editing && (
              <Button type="button" variant="destructive" onClick={handleDelete} disabled={saving}>
                <Trash2 className="h-4 w-4 mr-1" /> Remover
              </Button>
            )}
            <Button type="button" onClick={handleSave} disabled={saving}>
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
