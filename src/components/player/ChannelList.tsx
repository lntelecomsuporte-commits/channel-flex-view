import { useState, useEffect, useRef, useMemo } from "react";
import type { Channel } from "@/hooks/useChannels";
import { useMultiEPG } from "@/hooks/useMultiEPG";
import type { EPGProgram } from "@/hooks/useEPG";
import { LogOut, X, Search, Info } from "lucide-react";

interface ChannelListProps {
  channels: Channel[];
  currentIndex: number;
  visible: boolean;
  onSelect: (index: number) => void;
  onClose: () => void;
  onLogout?: () => void;
}

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function RatingBadge({ rating }: { rating: string | null }) {
  if (!rating) return null;
  const r = rating.trim().toUpperCase();
  let bg = "bg-green-600";
  if (r === "18" || r === "18 ANOS") bg = "bg-black";
  else if (r === "16" || r === "16 ANOS") bg = "bg-red-600";
  else if (r === "14" || r === "14 ANOS") bg = "bg-orange-500";
  else if (r === "12" || r === "12 ANOS") bg = "bg-yellow-500";
  else if (r === "10" || r === "10 ANOS") bg = "bg-blue-500";
  else if (r === "L" || r === "LIVRE") bg = "bg-green-600";

  return (
    <span className={`${bg} text-white text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 leading-none`}>
      {r.replace(" ANOS", "")}
    </span>
  );
}

function ProgramProgress({ startDate, endDate }: { startDate: string; endDate: string | null }) {
  if (!endDate) return null;
  const now = Date.now();
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  const total = end - start;
  if (total <= 0) return null;
  const elapsed = Math.max(0, Math.min(now - start, total));
  const pct = (elapsed / total) * 100;

  return (
    <div className="w-full h-1 bg-muted/30 rounded-full overflow-hidden">
      <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
    </div>
  );
}

function findCurrentAndUpcoming(programs: EPGProgram[]): EPGProgram[] {
  const now = new Date();
  let startIdx = -1;

  for (let i = 0; i < programs.length; i++) {
    const start = new Date(programs[i].start_date);
    const end = i + 1 < programs.length ? new Date(programs[i + 1].start_date) : null;
    if (start <= now && (!end || end > now)) {
      startIdx = i;
      break;
    }
  }

  if (startIdx === -1 && programs.length > 0) {
    for (let i = programs.length - 1; i >= 0; i--) {
      if (new Date(programs[i].start_date) <= now) {
        startIdx = i;
        break;
      }
    }
  }

  if (startIdx === -1) return [];
  // Return current + up to 3 upcoming
  return programs.slice(startIdx, startIdx + 4);
}

function ChannelEPGInfo({
  programs,
  altText,
  epgType,
  onClickSynopsis,
}: {
  programs: EPGProgram[];
  altText: string | null;
  epgType: string | null;
  onClickSynopsis: (program: EPGProgram) => void;
}) {
  if (programs.length === 0) {
    if (epgType === "alt_text" && altText) {
      return <span className="text-xs text-muted-foreground italic truncate">{altText}</span>;
    }
    return <span className="text-xs text-muted-foreground">Programação não disponível</span>;
  }

  const { current, next } = findCurrentNext(programs);

  if (!current) {
    return <span className="text-xs text-muted-foreground">Programação não disponível</span>;
  }

  return (
    <div className="flex-1 min-w-0 space-y-0.5">
      <div className="flex items-center gap-2">
        <RatingBadge rating={current.rating} />
        <p className="text-sm text-foreground truncate font-medium">{current.title}</p>
        {current.desc && (
          <button
            onClick={(e) => { e.stopPropagation(); onClickSynopsis(current); }}
            className="flex-shrink-0 text-primary hover:text-primary/80 transition-colors"
            title="Ver sinopse"
          >
            <Info className="w-4 h-4" />
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>{formatTime(current.start_date)}</span>
        <div className="flex-1 max-w-[120px]">
          <ProgramProgress startDate={current.start_date} endDate={next?.start_date ?? null} />
        </div>
        {next && <span>{formatTime(next.start_date)}</span>}
      </div>
    </div>
  );
}

function SynopsisModal({ program, onClose }: { program: EPGProgram; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="bg-background rounded-lg p-6 max-w-lg w-full mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-3">
          <div className="flex items-center gap-2">
            <RatingBadge rating={program.rating} />
            <div>
              <h3 className="text-lg font-bold text-foreground">{program.title}</h3>
              <p className="text-sm text-muted-foreground">{formatTime(program.start_date)}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-sm text-foreground/90 leading-relaxed">{program.desc || "Sinopse não disponível."}</p>
      </div>
    </div>
  );
}

const ChannelList = ({ channels, currentIndex, visible, onSelect, onClose, onLogout }: ChannelListProps) => {
  const [focusedIndex, setFocusedIndex] = useState(currentIndex);
  const [synopsisProgram, setSynopsisProgram] = useState<EPGProgram | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  const epgMap = useMultiEPG(
    channels.map((ch) => ({
      id: ch.id,
      epg_type: (ch as any).epg_type,
      epg_url: (ch as any).epg_url,
      epg_channel_id: (ch as any).epg_channel_id,
    }))
  );

  const filteredChannels = useMemo(() => {
    if (!searchQuery.trim()) return channels;
    const q = searchQuery.toLowerCase();
    return channels.filter(
      (ch) =>
        ch.name.toLowerCase().includes(q) ||
        String(ch.channel_number).includes(q)
    );
  }, [channels, searchQuery]);

  useEffect(() => {
    if (visible) {
      setFocusedIndex(0);
      setSearchQuery("");
    }
  }, [visible]);

  useEffect(() => {
    itemRefs.current[focusedIndex]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusedIndex]);

  useEffect(() => {
    if (!visible) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (synopsisProgram) {
        if (e.key === "Escape") { e.preventDefault(); setSynopsisProgram(null); }
        return;
      }
      const isSearchFocused = document.activeElement === searchRef.current;

      switch (e.key) {
        case "ArrowUp":
          e.preventDefault(); e.stopPropagation();
          setFocusedIndex((prev) => (prev > 0 ? prev - 1 : filteredChannels.length - 1));
          break;
        case "ArrowDown":
          e.preventDefault(); e.stopPropagation();
          setFocusedIndex((prev) => (prev < filteredChannels.length - 1 ? prev + 1 : 0));
          break;
        case "Enter":
          e.preventDefault(); e.stopPropagation();
          if (filteredChannels[focusedIndex]) {
            const realIndex = channels.indexOf(filteredChannels[focusedIndex]);
            if (realIndex >= 0) onSelect(realIndex);
          }
          break;
        case "Escape":
        case "Backspace":
          if (!isSearchFocused || e.key === "Escape") {
            e.preventDefault(); e.stopPropagation();
            onClose();
          }
          break;
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [visible, focusedIndex, filteredChannels, channels, onSelect, onClose, synopsisProgram]);

  if (!visible) return null;

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-black/90 animate-fade-in">
      {/* Header */}
      <div className="p-3 sm:p-4 border-b border-border/50 flex-shrink-0">
        <div className="flex justify-between items-center gap-3">
          <h2 className="text-lg sm:text-xl font-bold text-foreground flex-shrink-0">Canais</h2>

          <div className="flex-1 max-w-xs relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Buscar canal..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setFocusedIndex(0); }}
              className="w-full pl-8 pr-3 py-1.5 text-sm bg-secondary/50 border border-border/50 rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="flex items-center gap-3 flex-shrink-0">
            <span className="text-xs text-muted-foreground hidden sm:inline">↑↓ Navegar • OK Selecionar • ESC Fechar</span>
            {onLogout && (
              <button onClick={(e) => { e.stopPropagation(); onLogout(); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-destructive/20 hover:bg-destructive/40 text-destructive text-xs font-medium transition-colors">
                <LogOut className="w-3.5 h-3.5" /> Sair
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Channel list */}
      <div className="flex-1 overflow-y-auto" ref={listRef}>
        {filteredChannels.map((channel, index) => {
          const ch = channel as any;
          const programs = epgMap.get(channel.id) || [];
          const altText = ch.epg_alt_text as string | null;
          const epgType = ch.epg_type as string | null;
          const realIndex = channels.indexOf(channel);
          const isActive = realIndex === currentIndex;

          return (
            <div
              key={channel.id}
              ref={(el) => { itemRefs.current[index] = el; }}
              onClick={() => onSelect(realIndex)}
              className={`flex items-center gap-3 px-3 sm:px-4 py-2.5 sm:py-3 cursor-pointer transition-colors border-b border-border/20 ${
                index === focusedIndex
                  ? "bg-primary/15 ring-1 ring-inset ring-primary/40"
                  : isActive
                  ? "bg-accent/20"
                  : "hover:bg-accent/10"
              }`}
            >
              {/* Logo */}
              <div className="flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 rounded-md overflow-hidden bg-white/10 flex items-center justify-center">
                {channel.logo_url ? (
                  <img src={channel.logo_url} alt={channel.name} className="w-full h-full object-contain p-0.5" />
                ) : (
                  <span className="text-xs text-muted-foreground font-bold">{channel.name.substring(0, 2)}</span>
                )}
              </div>

              {/* Number + Name */}
              <div className="flex-shrink-0 w-20 sm:w-24">
                <span className="text-lg sm:text-xl font-bold text-foreground">{String(channel.channel_number).padStart(3, "0")}</span>
                <p className="text-xs sm:text-sm text-muted-foreground truncate leading-tight">{channel.name}</p>
              </div>

              {/* EPG info */}
              <div className="flex-1 min-w-0 flex items-center">
                <ChannelEPGInfo
                  programs={programs}
                  altText={altText}
                  epgType={epgType}
                  onClickSynopsis={(prog) => setSynopsisProgram(prog)}
                />
              </div>

              {/* Active indicator */}
              {isActive && (
                <span className="text-xs text-primary font-bold flex-shrink-0">● ATUAL</span>
              )}
            </div>
          );
        })}

        {filteredChannels.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <p className="text-muted-foreground text-sm">Nenhum canal encontrado.</p>
          </div>
        )}
      </div>

      {synopsisProgram && <SynopsisModal program={synopsisProgram} onClose={() => setSynopsisProgram(null)} />}
    </div>
  );
};

export default ChannelList;
