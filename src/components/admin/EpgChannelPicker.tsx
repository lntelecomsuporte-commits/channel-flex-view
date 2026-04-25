import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronsUpDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface XmlChannel {
  id: string;
  name: string;
}

interface EpgChannelPickerProps {
  value: string;
  onChange: (value: string) => void;
  xmlUrl: string;
}

export default function EpgChannelPicker({ value, onChange, xmlUrl }: EpgChannelPickerProps) {
  const [open, setOpen] = useState(false);
  const [channels, setChannels] = useState<XmlChannel[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [lastUrl, setLastUrl] = useState("");
  const [search, setSearch] = useState("");

  const fetchChannels = async () => {
    if (!xmlUrl) return;
    if (loaded && lastUrl === xmlUrl) return;
    setLoading(true);
    try {
      const proxyUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/epg-proxy?url=${encodeURIComponent(xmlUrl)}`;
      const res = await fetch(proxyUrl);
      if (!res.ok) throw new Error("Falha ao carregar XML");
      const text = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, "text/xml");
      const channelNodes = doc.querySelectorAll("channel");
      const list: XmlChannel[] = [];
      channelNodes.forEach((node) => {
        const id = node.getAttribute("id") || "";
        const name = node.querySelector("display-name")?.textContent || id;
        if (id) list.push({ id, name });
      });
      list.sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
      setChannels(list);
      setLoaded(true);
      setLastUrl(xmlUrl);
    } catch (e) {
      console.error("Erro ao buscar canais do XML:", e);
      setChannels([]);
    } finally {
      setLoading(false);
    }
  };

  const MAX_VISIBLE = 200;
  const filtered = useMemo(() => {
    if (!search.trim()) return channels;
    const q = search.toLowerCase();
    return channels.filter(
      (ch) => ch.name.toLowerCase().includes(q) || ch.id.toLowerCase().includes(q)
    );
  }, [channels, search]);
  const visible = useMemo(() => filtered.slice(0, MAX_VISIBLE), [filtered]);

  return (
    <div className="flex gap-2">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Ex: GloboHD.br"
        className="flex-1"
      />
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) fetchChannels(); }}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="shrink-0">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronsUpDown className="h-4 w-4" />}
            <span className="ml-1">Buscar</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[400px] p-0" align="end">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Buscar canal por nome ou ID..."
              value={search}
              onValueChange={setSearch}
            />
            <CommandList className="max-h-[300px]">
              <CommandEmpty>
                {loading ? "Carregando canais do XML..." : "Nenhum canal encontrado"}
              </CommandEmpty>
              <CommandGroup heading={`${filtered.length} canais encontrados`}>
                {filtered.map((ch) => (
                  <CommandItem
                    key={ch.id}
                    value={ch.id}
                    onSelect={() => {
                      onChange(ch.id);
                      setOpen(false);
                    }}
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