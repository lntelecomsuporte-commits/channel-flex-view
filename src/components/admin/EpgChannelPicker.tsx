import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronsUpDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface XmlChannel {
  id: string;
  name: string;
  icon?: string;
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

  const fetchChannels = async () => {
    if (!xmlUrl) return;
    if (loaded && lastUrl === xmlUrl) return;
    setLoading(true);
    try {
      const res = await fetch(xmlUrl);
      if (!res.ok) throw new Error("Falha ao carregar XML");
      const text = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, "text/xml");
      const channelNodes = doc.querySelectorAll("channel");
      const list: XmlChannel[] = [];
      channelNodes.forEach((node) => {
        const id = node.getAttribute("id") || "";
        const name = node.querySelector("display-name")?.textContent || id;
        const icon = node.querySelector("icon")?.getAttribute("src") || undefined;
        if (id) list.push({ id, name, icon });
      });
      list.sort((a, b) => a.name.localeCompare(b.name));
      setChannels(list);
      setLoaded(true);
      setLastUrl(xmlUrl);
    } catch {
      setChannels([]);
    } finally {
      setLoading(false);
    }
  };

  const selectedChannel = channels.find((c) => c.id === value);

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
          <Button variant="outline" size="sm" className="shrink-0">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronsUpDown className="h-4 w-4" />}
            <span className="ml-1 hidden sm:inline">Buscar</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[350px] p-0" align="end">
          <Command>
            <CommandInput placeholder="Buscar canal..." />
            <CommandList className="max-h-[300px]">
              <CommandEmpty>
                {loading ? "Carregando canais..." : "Nenhum canal encontrado"}
              </CommandEmpty>
              <CommandGroup>
                {channels.map((ch) => (
                  <CommandItem
                    key={ch.id}
                    value={`${ch.name} ${ch.id}`}
                    onSelect={() => {
                      onChange(ch.id);
                      setOpen(false);
                    }}
                    className={cn(value === ch.id && "bg-accent")}
                  >
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{ch.name}</span>
                      <span className="text-xs text-muted-foreground">{ch.id}</span>
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
