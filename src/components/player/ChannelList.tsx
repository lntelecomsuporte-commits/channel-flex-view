import { useState, useEffect, useRef, useMemo, memo, useLayoutEffect } from "react";
import { FixedSizeList, type ListChildComponentProps } from "react-window";
import type { Channel } from "@/hooks/useChannels";
import { useMultiEPG } from "@/hooks/useMultiEPG";
import type { EPGProgram } from "@/hooks/useEPG";
import { useFavorites } from "@/hooks/useFavorites";
import { isSelectKey, isPageNextKey, isPagePrevKey } from "@/lib/remoteKeys";
import { LogOut, X, Info, Star } from "lucide-react";
import { CachedLogo } from "@/components/CachedLogo";

interface ChannelListProps {
  channels: Channel[];
  currentIndex: number;
  visible: boolean;
  preloadEpg?: boolean;
  onSelect: (index: number) => void;
  onClose: () => void;
  onLogout?: () => void;
}

const LONG_PRESS_MS = 1500;
const IS_NATIVE_APK = typeof window !== "undefined" && !!(window as any).Capacitor?.isNativePlatform?.();

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
  return programs.slice(startIdx, startIdx + 4);
}

const ChannelEPGInfo = memo(function ChannelEPGInfo({
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
  const upcoming = useMemo(() => findCurrentAndUpcoming(programs), [programs]);

  if (programs.length === 0) {
    if (epgType === "alt_text" && altText) {
      return <span className="text-xs text-muted-foreground italic truncate">{altText}</span>;
    }
    return <span className="text-xs text-muted-foreground">Programação não disponível</span>;
  }

  if (upcoming.length === 0) {
    return <span className="text-xs text-muted-foreground">Programação não disponível</span>;
  }

  const current = upcoming[0];
  const next = upcoming[1] || null;

  return (
    <div className="flex-1 min-w-0 overflow-x-auto">
      <div className="flex items-stretch gap-1">
        <div className="flex-shrink-0 min-w-[160px] max-w-[220px] space-y-0.5">
          <div className="flex items-center gap-1.5">
            <RatingBadge rating={current.rating} />
            <p className="text-sm text-foreground truncate font-semibold">{current.title}</p>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClickSynopsis(current);
              }}
              className="flex-shrink-0 text-primary hover:text-primary/80 transition-colors"
              title="Ver sinopse"
            >
              <Info className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span>{formatTime(current.start_date)}</span>
            <div className="flex-1">
              <ProgramProgress startDate={current.start_date} endDate={next?.start_date ?? null} />
            </div>
            {next && <span>{formatTime(next.start_date)}</span>}
          </div>
        </div>

        {upcoming.slice(1).map((prog, i) => (
          <div
            key={i}
            className="flex-shrink-0 min-w-[140px] max-w-[180px] border-l border-border/30 pl-2 space-y-0.5 opacity-70"
          >
            <div className="flex items-center gap-1">
              <RatingBadge rating={prog.rating} />
              <p className="text-xs text-foreground/80 truncate">{prog.title}</p>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClickSynopsis(prog);
                }}
                className="flex-shrink-0 text-primary/60 hover:text-primary transition-colors"
                title="Ver sinopse"
              >
                <Info className="w-3 h-3" />
              </button>
            </div>
            <span className="text-[10px] text-muted-foreground">{formatTime(prog.start_date)}</span>
          </div>
        ))}
      </div>
    </div>
  );
});

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

interface RowData {
  filteredChannels: Channel[];
  channelIndexMap: Map<string, number>;
  currentIndex: number;
  focusedIndex: number;
  epgMap: Map<string, EPGProgram[]>;
  favoriteIds: Set<string>;
  showEpg: boolean;
  onSelect: (index: number) => void;
  onFocus: (index: number) => void;
  onSynopsis: (p: EPGProgram) => void;
  setItemRef: (index: number, el: HTMLDivElement | null) => void;
}

const Row = memo(({ index, style, data }: ListChildComponentProps<RowData>) => {
  const { filteredChannels, channelIndexMap, currentIndex, focusedIndex, epgMap, favoriteIds, showEpg, onSelect, onFocus, onSynopsis, setItemRef } = data;
  const channel = filteredChannels[index];
  if (!channel) return null;
  const ch = channel as any;
  const programs = epgMap.get(channel.id) || [];
  const altText = ch.epg_alt_text as string | null;
  const epgType = ch.epg_type as string | null;
  const realIndex = channelIndexMap.get(channel.id) ?? -1;
  const isActive = realIndex === currentIndex;
  const isFocused = index === focusedIndex;
  const isFav = favoriteIds.has(channel.id);

  return (
    <div style={style}>
      <div
        ref={(el) => setItemRef(index, el)}
        onPointerEnter={(e) => {
          if (e.pointerType === "mouse") onFocus(index);
        }}
        onClick={() => {
          onFocus(index);
          onSelect(realIndex);
        }}
        className={`flex items-center gap-3 px-3 sm:px-4 h-full cursor-pointer transition-colors border-b border-border/20 ${
          isFocused
            ? "bg-primary/15 ring-1 ring-inset ring-primary/40"
            : isActive
              ? "bg-accent/20"
              : ""
        }`}
      >
        <div className="flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 rounded-md overflow-hidden bg-white/10 flex items-center justify-center relative">
          {channel.logo_url ? (
            <CachedLogo src={channel.logo_url} alt={channel.name} className="w-full h-full object-contain p-0.5" loading="lazy" decoding="async" />
          ) : (
            <span className="text-xs text-muted-foreground font-bold">{channel.name.substring(0, 2)}</span>
          )}
          {isFav && <Star className="absolute -top-1 -right-1 w-3.5 h-3.5 fill-yellow-400 text-yellow-400 drop-shadow" />}
        </div>
        <div className="flex-shrink-0 w-20 sm:w-24">
          <span className="text-lg sm:text-xl font-bold text-foreground">{String(channel.channel_number).padStart(3, "0")}</span>
          <p className="text-xs sm:text-sm text-muted-foreground truncate leading-tight">{channel.name}</p>
        </div>
        {showEpg && (
          <div className="flex-1 min-w-0 flex items-center">
            <ChannelEPGInfo programs={programs} altText={altText} epgType={epgType} onClickSynopsis={onSynopsis} />
          </div>
        )}
        {isActive && <span className="text-xs text-primary font-bold flex-shrink-0">● ATUAL</span>}
      </div>
    </div>
  );
}, (prev, next) => {
  if (prev.index !== next.index) return false;
  if (prev.style !== next.style) return false;
  const ch = next.data.filteredChannels[next.index];
  const prevCh = prev.data.filteredChannels[prev.index];
  if (ch?.id !== prevCh?.id) return false;
  if (ch?.updated_at !== prevCh?.updated_at) return false;
  const wasFocused = prev.data.focusedIndex === prev.index;
  const isFocused = next.data.focusedIndex === next.index;
  if (wasFocused !== isFocused) return false;
  const realIdx = next.data.channelIndexMap.get(ch?.id ?? "") ?? -1;
  const prevRealIdx = prev.data.channelIndexMap.get(prevCh?.id ?? "") ?? -1;
  const wasActive = prev.data.currentIndex === prevRealIdx;
  const isActive = next.data.currentIndex === realIdx;
  if (wasActive !== isActive) return false;
  if (prev.data.showEpg !== next.data.showEpg) return false;
  if (prev.data.epgMap.get(ch?.id ?? "") !== next.data.epgMap.get(ch?.id ?? "")) return false;
  const wasFav = prev.data.favoriteIds.has(prevCh?.id ?? "");
  const isFav = next.data.favoriteIds.has(ch?.id ?? "");
  if (wasFav !== isFav) return false;
  return true;
});
Row.displayName = "ChannelRow";

const ChannelList = ({ channels, currentIndex, visible, preloadEpg = false, onSelect, onClose, onLogout }: ChannelListProps) => {
  const [focusedIndex, setFocusedIndex] = useState(currentIndex);
  const [synopsisProgram, setSynopsisProgram] = useState<EPGProgram | null>(null);
  const [listSize, setListSize] = useState({ width: 0, height: 0 });
  const [showEpgDetails, setShowEpgDetails] = useState(!IS_NATIVE_APK);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<FixedSizeList>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  const { favorites, isFavorite, setFavorite, isUpdatingFavorite } = useFavorites();
  const favoriteIds = useMemo(() => new Set(favorites.map((f) => f.channel_id)), [favorites]);

  const enterPressStartRef = useRef<number | null>(null);
  const enterFavoriteFiredRef = useRef(false);
  // Throttle de 16ms (~60fps) para repetição de teclas de navegação
  const lastNavTickRef = useRef(0);
  const NAV_THROTTLE_MS = 16;

  // Lógica "estilo OSD": ↑↓ apertando uma vez → troca rapidamente.
  // Segurando → corre os canais (foca, sem abrir). Ao SOLTAR (keyup),
  // abre o canal focado. Distinguimos toque-curto de hold via flag.
  const arrowHeldRef = useRef(false);

  const epgMap = useMultiEPG(
    channels.map((ch) => ({
      id: ch.id,
      epg_type: (ch as any).epg_type,
      epg_url: (ch as any).epg_url,
      epg_channel_id: (ch as any).epg_channel_id,
    })),
    visible && preloadEpg && showEpgDetails
  );

  const filteredChannels = channels;

  // Quando a lista abre, foca o canal atual (não o primeiro da lista).
  useEffect(() => {
    if (visible) {
      setFocusedIndex(currentIndex);
      setShowEpgDetails(!IS_NATIVE_APK);
      arrowHeldRef.current = false;
      if (IS_NATIVE_APK && preloadEpg) {
        const t = setTimeout(() => setShowEpgDetails(true), 350);
        return () => clearTimeout(t);
      }
    }
  }, [visible, currentIndex, preloadEpg]);

  useLayoutEffect(() => {
    if (!visible) return;
    const el = containerRef.current;
    if (!el) return;
    const update = () => setListSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible || listSize.height <= 0) return;
    listRef.current?.scrollToItem(focusedIndex, "auto");
  }, [focusedIndex, visible, listSize.height]);

  const initialOffset = useMemo(() => {
    const ITEM = 72;
    const target = currentIndex * ITEM - Math.max(0, listSize.height / 2 - ITEM / 2);
    return Math.max(0, target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, currentIndex, listSize.height > 0]);

  const setItemRef = (index: number, el: HTMLDivElement | null) => {
    itemRefs.current[index] = el;
  };

  const channelIndexMap = useMemo(() => {
    const m = new Map<string, number>();
    channels.forEach((ch, i) => m.set(ch.id, i));
    return m;
  }, [channels]);

  const rowData = useMemo<RowData>(
    () => ({
      filteredChannels,
      channelIndexMap,
      currentIndex,
      focusedIndex,
      epgMap,
      favoriteIds,
      showEpg: showEpgDetails,
      onSelect,
      onFocus: (i: number) => setFocusedIndex(i),
      onSynopsis: (p: EPGProgram) => setSynopsisProgram(p),
      setItemRef,
    }),
    [filteredChannels, channelIndexMap, currentIndex, focusedIndex, epgMap, favoriteIds, showEpgDetails, onSelect]
  );

  useEffect(() => {
    if (!visible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (synopsisProgram) {
        if (e.key === "Escape" || isSelectKey(e)) {
          e.preventDefault();
          setSynopsisProgram(null);
        }
        return;
      }

      // Throttle de repetição
      const isNavKey =
        isPageNextKey(e) || isPagePrevKey(e) || e.key === "ArrowUp" || e.key === "ArrowDown" ||
        e.key === "ArrowLeft" || e.key === "ArrowRight";
      if (isNavKey && e.repeat) {
        const now = performance.now();
        if (now - lastNavTickRef.current < NAV_THROTTLE_MS) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        lastNavTickRef.current = now;
      }

      // FF / RW / Ch+ / Ch- / ArrowLeft / ArrowRight → paginar 5 (garante troca de tela em TVs que mostram ~6 canais)
      const PAGE_STEP = 5;
      if (isPageNextKey(e) || e.key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
        setFocusedIndex((prev) => Math.min(filteredChannels.length - 1, prev + PAGE_STEP));
        return;
      }
      if (isPagePrevKey(e) || e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        setFocusedIndex((prev) => Math.max(0, prev - PAGE_STEP));
        return;
      }

      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          e.stopPropagation();
          if (e.repeat) arrowHeldRef.current = true;
          setFocusedIndex((prev) => (prev > 0 ? prev - 1 : filteredChannels.length - 1));
          return;
        case "ArrowDown":
          e.preventDefault();
          e.stopPropagation();
          if (e.repeat) arrowHeldRef.current = true;
          setFocusedIndex((prev) => (prev < filteredChannels.length - 1 ? prev + 1 : 0));
          return;
        case "Escape":
        case "Backspace":
          e.preventDefault();
          e.stopPropagation();
          onClose();
          return;
        default:
          if (isSelectKey(e)) {
            e.preventDefault();
            e.stopPropagation();
            if (isUpdatingFavorite) return;

            // Long-press: tecla repetindo por tempo suficiente → favorita
            if (e.repeat) {
              if (enterFavoriteFiredRef.current) return;
              const startedAt = enterPressStartRef.current;
              if (startedAt && performance.now() - startedAt >= LONG_PRESS_MS) {
                enterFavoriteFiredRef.current = true;
                const ch = filteredChannels[focusedIndex];
                const focusedId = ch?.id ?? "";
                if (focusedId) setFavorite(focusedId, !isFavorite(focusedId));
              }
              return;
            }

            if (enterPressStartRef.current === null) {
              enterPressStartRef.current = performance.now();
              enterFavoriteFiredRef.current = false;
            }
          }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      // Soltou seta ↑/↓ depois de segurar → confirma o canal focado
      if ((e.key === "ArrowUp" || e.key === "ArrowDown") && arrowHeldRef.current) {
        arrowHeldRef.current = false;
        e.preventDefault();
        e.stopPropagation();
        const ch = filteredChannels[focusedIndex];
        if (ch) {
          const realIndex = channels.indexOf(ch);
          if (realIndex >= 0) onSelect(realIndex);
        }
        return;
      }
      arrowHeldRef.current = false;

      if (!isSelectKey(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const startedAt = enterPressStartRef.current;
      const fired = enterFavoriteFiredRef.current;
      enterPressStartRef.current = null;
      enterFavoriteFiredRef.current = false;

      if (fired) return;
      if (startedAt === null) return;

      const heldMs = performance.now() - startedAt;
      const ch = filteredChannels[focusedIndex];
      if (!ch) return;

      if (heldMs >= LONG_PRESS_MS) {
        if (!isUpdatingFavorite) setFavorite(ch.id, !isFavorite(ch.id));
      } else {
        const realIndex = channels.indexOf(ch);
        if (realIndex >= 0) onSelect(realIndex);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
    };
  }, [visible, focusedIndex, filteredChannels, channels, onSelect, onClose, synopsisProgram, setFavorite, isFavorite, isUpdatingFavorite]);

  if (!visible) return null;

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-black/90 animate-fade-in">
      <div className="p-3 sm:p-4 border-b border-border/50 flex-shrink-0">
        <div className="flex justify-between items-center gap-3">
          <h2 className="text-lg sm:text-xl font-bold text-foreground flex-shrink-0">Canais</h2>

          <div className="flex items-center gap-3 flex-shrink-0 ml-auto">
            <span className="text-xs text-muted-foreground hidden sm:inline">↑↓ Navegar/Solte abre • ←→ ±10 • OK Selecionar • Segure OK Favoritar • ESC Fechar</span>
            {onLogout && (
              <button onClick={(e) => { e.stopPropagation(); onLogout(); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-destructive/20 hover:bg-destructive/40 text-destructive text-xs font-medium transition-colors">
                <LogOut className="w-3.5 h-3.5" /> Sair
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0" ref={containerRef}>
        {filteredChannels.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-muted-foreground text-sm">Nenhum canal encontrado.</p>
          </div>
        ) : listSize.height > 0 ? (
          <FixedSizeList
            ref={listRef}
            height={listSize.height}
            width={listSize.width}
            itemCount={filteredChannels.length}
            itemSize={72}
            itemData={rowData}
            overscanCount={4}
            initialScrollOffset={initialOffset}
          >
            {Row}
          </FixedSizeList>
        ) : null}
      </div>

      {synopsisProgram && <SynopsisModal program={synopsisProgram} onClose={() => setSynopsisProgram(null)} />}
    </div>
  );
};

export default ChannelList;
