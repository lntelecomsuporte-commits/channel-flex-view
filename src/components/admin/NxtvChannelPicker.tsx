import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronsUpDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchNxtvChannelList } from "@/lib/nxtv";

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** URL base do gateway (opcional — usa o padrão quando vazio) */
  baseUrl?: string;
}

export default function NxtvChannelPicker({ value, onChange, baseUrl }: Props) {
  const [open, setOpen] = useState(false);
  const [channels, setChannels] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (loading || (loaded && channels.length)) return;
    setLoading(true);
    setError(null);
    try {
      const list = await fetchNxtvChannelList(baseUrl);
      setChannels(list);
      setLoaded(true);
      if (!list.length) setError("Nenhum canal retornado pela NXTV.");
    } catch (e) {
      console.error("[NxtvChannelPicker]", e);
      setChannels([]);
      setError(e instanceof Error ? e.message : "Falha ao carregar canais da NXTV");
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return channels;
    return channels.filter((c) => c.name.toLowerCase().includes(q) || c.id.includes(q));
  }, [channels, search]);

  return (
    <div className="flex gap-2">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Ex: 748"
        className="flex-1"
      />
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) load(); }}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="shrink-0">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronsUpDown className="h-4 w-4" />}
            <span className="ml-1">Buscar</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[400px] p-0" align="end">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Buscar canal por nome ou ID..." value={search} onValueChange={setSearch} />
            <CommandList className="max-h-[300px]">
              <CommandEmpty>{loading ? "Carregando canais…" : error || "Nenhum canal encontrado"}</CommandEmpty>
              <CommandGroup heading={`${filtered.length} canais`}>
                {filtered.slice(0, 200).map((ch) => (
                  <CommandItem
                    key={ch.id}
                    value={ch.id}
                    onSelect={() => { onChange(ch.id); setOpen(false); }}
                    className={cn("cursor-pointer", value === ch.id && "bg-accent")}
                  >
                    <div className="flex justify-between w-full gap-2">
                      <span className="text-sm font-medium truncate">{ch.name}</span>
                      <span className="text-xs text-muted-foreground shrink-0">{ch.id}</span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
