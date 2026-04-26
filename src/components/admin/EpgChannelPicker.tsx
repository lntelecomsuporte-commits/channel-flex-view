import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronsUpDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { getLocalFunctionUrl } from "@/lib/localBackend";
import { getLocalSourceUrl } from "@/lib/epgCache";

interface XmlChannel {
  id: string;
  name: string;
  source?: string;
}

interface EpgChannelPickerProps {
  value: string;
  onChange: (value: string) => void;
  /** Single fallback URL (when no extra URLs provided) */
  xmlUrl: string;
  /** Optional extra URLs to merge results from */
  extraUrls?: string[];
  /** Called when user picks a channel — receives id and the source URL where it was found */
  onResolve?: (id: string, sourceUrl: string) => void;
}

export default function EpgChannelPicker({ value, onChange, xmlUrl, extraUrls = [], onResolve }: EpgChannelPickerProps) {
  const [open, setOpen] = useState(false);
  const [channels, setChannels] = useState<XmlChannel[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [lastKey, setLastKey] = useState("");
  const [search, setSearch] = useState("");

  const allUrls = useMemo(() => {
    const set = new Set<string>();
    if (xmlUrl) set.add(xmlUrl);
    extraUrls.forEach((u) => u && set.add(u));
    return Array.from(set);
  }, [xmlUrl, extraUrls]);

  const fetchOne = async (url: string): Promise<XmlChannel[]> => {
    // 1) Tenta cache local servido pelo nginx (rápido, sem CORS, sem anti-bot).
    let text: string | null = null;
    try {
      const localRes = await fetch(getLocalSourceUrl(url), { cache: "no-cache" });
      if (localRes.ok) text = await localRes.text();
    } catch { /* segue */ }

    // 2) Fallback: edge function epg-proxy (URLs não cacheadas)
    if (!text || text.length < 100) {
      const proxyUrl = `${getLocalFunctionUrl("epg-proxy")}?url=${encodeURIComponent(url)}&fresh=1`;
      const res = await fetch(proxyUrl);
      if (!res.ok) throw new Error(`Falha ao carregar XML: ${url}`);
      text = await res.text();
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(text, "text/xml");
    const channelNodes = doc.querySelectorAll("channel");
    const list: XmlChannel[] = [];
    channelNodes.forEach((node) => {
      const id = node.getAttribute("id") || "";
      const name = node.querySelector("display-name")?.textContent || id;
      if (id) list.push({ id, name, source: url });
    });
    if (list.length === 0) console.warn(`[EpgChannelPicker] 0 canais em ${url} (resposta ${text.length} bytes)`);
    return list;
  };

  const fetchChannels = async () => {
    if (!allUrls.length) return;
    const key = allUrls.join("|");
    if (loaded && lastKey === key) return;
    setLoading(true);
    try {
      const results = await Promise.allSettled(allUrls.map(fetchOne));
      const merged: XmlChannel[] = [];
      const seen = new Set<string>();
      results.forEach((r) => {
        if (r.status === "fulfilled") {
          for (const ch of r.value) {
            if (seen.has(ch.id)) continue;
            seen.add(ch.id);
            merged.push(ch);
          }
        } else {
          console.error("EPG source failed:", r.reason);
        }
      });
      merged.sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
      setChannels(merged);
      setLoaded(true);
      setLastKey(key);
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
            <span className="ml-1">Buscar{allUrls.length > 1 ? ` (${allUrls.length})` : ""}</span>
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
              <CommandGroup heading={`${filtered.length} canais ${filtered.length > MAX_VISIBLE ? `(mostrando ${MAX_VISIBLE} — refine a busca)` : "encontrados"}${allUrls.length > 1 ? ` · ${allUrls.length} fontes` : ""}`}>
                {visible.map((ch) => (
                  <CommandItem
                    key={ch.id}
                    value={ch.id}
                    onSelect={() => {
                      onChange(ch.id);
                      if (onResolve && ch.source) onResolve(ch.id, ch.source);
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
