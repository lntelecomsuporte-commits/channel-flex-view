import { useEffect, useRef, useState, useMemo } from "react";
import type { Channel } from "@/hooks/useChannels";
import { Search, X } from "lucide-react";
import { CachedLogo } from "@/components/CachedLogo";
import { isSelectKey } from "@/lib/remoteKeys";

interface ChannelSearchProps {
  channels: Channel[];
  visible: boolean;
  onSelect: (channel: Channel) => void;
  onClose: () => void;
}

const ChannelSearch = ({ channels, visible, onSelect, onClose }: ChannelSearchProps) => {
  const [query, setQuery] = useState("");
  const [focusedResult, setFocusedResult] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (visible) {
      setQuery("");
      setFocusedResult(0);
      // Foca o input pra digitar direto (controle remoto + soft keyboard ou USB keyboard)
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [visible]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return channels
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          String(c.channel_number).padStart(3, "0").includes(q),
      )
      .slice(0, 8);
  }, [query, channels]);

  useEffect(() => {
    if (focusedResult >= results.length) setFocusedResult(0);
  }, [results.length, focusedResult]);

  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      // Esc/Backspace vazio fecha
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      // Setas ↑↓ navegam resultados (sem mudar canal)
      if (e.key === "ArrowDown" && results.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        setFocusedResult((i) => (i < results.length - 1 ? i + 1 : 0));
        return;
      }
      if (e.key === "ArrowUp") {
        // Se está no primeiro resultado (ou sem resultados), ↑ fecha a busca
        if (results.length === 0 || focusedResult === 0) {
          e.preventDefault();
          e.stopPropagation();
          onClose();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        setFocusedResult((i) => i - 1);
        return;
      }
      if (isSelectKey(e) && results.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        const ch = results[focusedResult];
        if (ch) {
          onSelect(ch);
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [visible, results, focusedResult, onSelect, onClose]);

  if (!visible) return null;

  return (
    <div className="absolute bottom-64 sm:bottom-72 lg:bottom-80 left-0 right-0 z-20 px-4 sm:px-6 lg:px-8 animate-slide-up">
      <div className="max-w-xl mx-auto bg-background/90 backdrop-blur-md border border-border/60 rounded-xl shadow-xl overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40">
          <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            inputMode="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setFocusedResult(0);
            }}
            placeholder="Buscar canal pelo nome ou número..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="text-muted-foreground hover:text-foreground p-1"
            aria-label="Fechar busca"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {results.length > 0 && (
          <div className="max-h-64 overflow-y-auto">
            {results.map((ch, idx) => {
              const isFocused = idx === focusedResult;
              return (
                <button
                  key={ch.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(ch);
                    onClose();
                  }}
                  onPointerEnter={() => setFocusedResult(idx)}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                    isFocused ? "bg-primary/20" : "hover:bg-accent/30"
                  }`}
                >
                  <div className="flex-shrink-0 w-9 h-9 rounded bg-white/10 flex items-center justify-center overflow-hidden">
                    {ch.logo_url ? (
                      <CachedLogo src={ch.logo_url} alt={ch.name} className="w-full h-full object-contain p-0.5" />
                    ) : (
                      <span className="text-[10px] font-bold text-foreground/70">
                        {String(ch.channel_number).padStart(3, "0")}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-bold text-foreground">
                      {String(ch.channel_number).padStart(3, "0")}
                    </span>
                    <span className="text-sm text-foreground/90 ml-2 truncate">{ch.name}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {query.trim() && results.length === 0 && (
          <div className="px-3 py-3 text-xs text-muted-foreground">Nenhum canal encontrado.</div>
        )}
      </div>
    </div>
  );
};

export default ChannelSearch;
