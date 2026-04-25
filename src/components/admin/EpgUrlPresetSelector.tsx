import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Pencil, Plus, Trash2 } from "lucide-react";
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
  onSelect: (url: string) => void;
}

const PRESET_TABLE = "epg_url_presets" as const;

export default function EpgUrlPresetSelector({ epgType, currentUrl, onSelect }: Props) {
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

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Preset | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);

  // Quando abre o dialog: preenche com o que está editando
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
      setDialogOpen(false);
      setEditing(null);
    } catch (e: any) {
      toast.error(e.message || "Erro ao remover");
    } finally {
      setSaving(false);
    }
  };

  const selectedPreset = presets.find((p) => p.url === currentUrl) || null;

  return (
    <div className="flex gap-2 items-end">
      <div className="flex-1 min-w-0">
        <Label className="text-xs text-muted-foreground mb-1 block">URLs salvas</Label>
        <Select
          value={selectedPreset?.id || ""}
          onValueChange={(id) => {
            const preset = presets.find((p) => p.id === id);
            if (preset) onSelect(preset.url);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder={presets.length ? "Selecionar URL salva" : "Nenhuma URL salva"} />
          </SelectTrigger>
          <SelectContent>
            {presets.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) setEditing(null); }}>
        <DialogTrigger asChild>
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(null)} title="Adicionar URL">
            <Plus className="h-4 w-4" />
          </Button>
        </DialogTrigger>
        {selectedPreset && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => { setEditing(selectedPreset); setDialogOpen(true); }}
            title="Editar URL"
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
