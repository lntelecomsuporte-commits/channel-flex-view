import { useState, useEffect, useCallback, useRef } from "react";
import { useChannels, type Channel } from "@/hooks/useChannels";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTouchControls } from "@/hooks/useTouchControls";
import { useAuth } from "@/hooks/useAuth";
import { useEPG, type EPGProgram } from "@/hooks/useEPG";
import { useMultiEPG } from "@/hooks/useMultiEPG";
import { useNativeBackButton } from "@/hooks/useNativeBackButton";
import VideoPlayer, { type VideoPlayerHandle } from "@/components/player/VideoPlayer";
import ChannelOSD from "@/components/player/ChannelOSD";
import ChannelPreview from "@/components/player/ChannelPreview";
import ChannelList from "@/components/player/ChannelList";
import SynopsisModal from "@/components/player/SynopsisModal";
import StatsOverlay from "@/components/player/StatsOverlay";
import FavoritesBar from "@/components/player/FavoritesBar";
import { useFavorites } from "@/hooks/useFavorites";
import { List, ChevronUp, ChevronDown } from "lucide-react";

const PlayerPage = () => {
  const { signOut } = useAuth();
  const isMobile = useIsMobile();
  const { favorites, isFavorite, toggleFavorite } = useFavorites();

  useEffect(() => {
    document.body.classList.add("player-mode");
    return () => document.body.classList.remove("player-mode");
  }, []);

  const { data: channels, isLoading } = useChannels();
  const [currentIndex, setCurrentIndex] = useState(0);

  // Pré-carrega EPG em segundo plano (cache compartilhado com a ChannelList)
  // Espera 3s após o player iniciar para não competir com o stream
  const [preloadEpg, setPreloadEpg] = useState(false);
  useEffect(() => {
    if (!channels?.length) return;
    const t = setTimeout(() => setPreloadEpg(true), 3000);
    return () => clearTimeout(t);
  }, [channels?.length]);
  useMultiEPG(
    channels?.map((ch: any) => ({
      id: ch.id,
      epg_type: ch.epg_type,
      epg_url: ch.epg_url,
      epg_channel_id: ch.epg_channel_id,
    })) ?? [],
    preloadEpg
  );

  const [showOSD, setShowOSD] = useState(true);
  const [showFavoritesBar, setShowFavoritesBar] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showChannelList, setShowChannelList] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [osdTimeout, setOsdTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [previewTimeout, setPreviewTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);

  const currentChannel: Channel | null = channels?.[currentIndex] ?? null;
  const previewChannel: Channel | null = previewIndex !== null ? channels?.[previewIndex] ?? null : null;
  const focusedChannel: Channel | null = previewChannel ?? currentChannel;

  const [synopsisProgram, setSynopsisProgram] = useState<EPGProgram | null>(null);
  const lastEnterRef = useRef<{ id: string; time: number }>({ id: "", time: 0 });
  const enterHandledRef = useRef(false);
  const enterLongPressFiredRef = useRef(false);
  const enterLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const LONG_PRESS_MS = 600;

  // Easter egg: ← ← ← → → ← + OK -> stats overlay
  const [showStats, setShowStats] = useState(false);
  const playerRef = useRef<VideoPlayerHandle>(null);
  const comboRef = useRef<string[]>([]);
  const comboTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const COMBO_SEQUENCE = ["L", "L", "L", "R", "R", "L"];

  const pushCombo = useCallback((key: "L" | "R") => {
    const next = [...comboRef.current, key].slice(-COMBO_SEQUENCE.length);
    comboRef.current = next;
    if (comboTimerRef.current) clearTimeout(comboTimerRef.current);
    comboTimerRef.current = setTimeout(() => { comboRef.current = []; }, 3000);
  }, []);

  const isComboArmed = useCallback(() => {
    const c = comboRef.current;
    if (c.length !== COMBO_SEQUENCE.length) return false;
    return c.every((k, i) => k === COMBO_SEQUENCE[i]);
  }, []);

  const fc: any = focusedChannel;
  const { data: focusedEpg } = useEPG({
    epg_type: fc?.epg_type,
    epg_url: fc?.epg_url,
    epg_channel_id: fc?.epg_channel_id,
  });

  const openSynopsisForFocused = useCallback(() => {
    if (focusedEpg?.current && focusedChannel) {
      setSynopsisProgram(focusedEpg.current);
    }
  }, [focusedEpg, focusedChannel]);

  const showOSDTemporarily = useCallback((withFavorites = false) => {
    setShowOSD(true);
    if (withFavorites) setShowFavoritesBar(true);
    if (osdTimeout) clearTimeout(osdTimeout);
    const t = setTimeout(() => {
      setShowOSD(false);
      setShowFavoritesBar(false);
    }, 4000);
    setOsdTimeout(t);
  }, [osdTimeout]);

  const changeChannel = useCallback(
    (direction: "up" | "down") => {
      if (!channels?.length) return;
      setShowPreview(false);
      setPreviewIndex(null);
      if (previewTimeout) clearTimeout(previewTimeout);

      setCurrentIndex((prev) => {
        if (direction === "up") {
          return prev < channels.length - 1 ? prev + 1 : 0;
        }
        return prev > 0 ? prev - 1 : channels.length - 1;
      });
      showOSDTemporarily();
    },
    [channels, showOSDTemporarily, previewTimeout]
  );

  const showNextPreview = useCallback(
    (direction: "next" | "prev") => {
      if (!channels?.length) return;
      const baseIdx = previewIndex !== null ? previewIndex : currentIndex;
      const nextIdx =
        direction === "next"
          ? baseIdx < channels.length - 1
            ? baseIdx + 1
            : 0
          : baseIdx > 0
          ? baseIdx - 1
          : channels.length - 1;
      setPreviewIndex(nextIdx);
      setShowPreview(true);

      if (previewTimeout) clearTimeout(previewTimeout);
      const t = setTimeout(() => {
        setShowPreview(false);
        setPreviewIndex(null);
      }, 5000);
      setPreviewTimeout(t);
    },
    [channels, currentIndex, previewIndex, previewTimeout]
  );

  const confirmPreview = useCallback(() => {
    if (previewIndex !== null) {
      setCurrentIndex(previewIndex);
      setShowPreview(false);
      setPreviewIndex(null);
      if (previewTimeout) clearTimeout(previewTimeout);
      showOSDTemporarily();
    }
  }, [previewIndex, previewTimeout, showOSDTemporarily]);

  // Touch/swipe controls for mobile
  const touchHandlers = useTouchControls({
    onSwipeUp: () => {
      if (!showChannelList) changeChannel("up");
    },
    onSwipeDown: () => {
      if (!showChannelList) changeChannel("down");
    },
    onSwipeLeft: () => {
      if (!showChannelList) showNextPreview("next");
    },
    onSwipeRight: () => {
      if (!showChannelList) {
        if (showPreview) {
          confirmPreview();
        } else {
          showNextPreview("prev");
        }
      }
    },
    onTap: () => {
      if (!showChannelList) {
        if (showPreview) {
          confirmPreview();
        } else {
          showOSDTemporarily();
        }
      }
    },
  });

  // Hardware/remote Back button (Android TV) — close overlays instead of exiting
  useNativeBackButton(() => {
    if (showStats) { setShowStats(false); return true; }
    if (synopsisProgram) { setSynopsisProgram(null); return true; }
    if (showChannelList) { setShowChannelList(false); return true; }
    if (showPreview) {
      setShowPreview(false);
      setPreviewIndex(null);
      if (previewTimeout) clearTimeout(previewTimeout);
      return true;
    }
    return false; // let app exit
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (showChannelList) return;
      if (showStats && (e.key === "Escape" || e.key === "Backspace")) {
        e.preventDefault();
        setShowStats(false);
        return;
      }
      if (synopsisProgram) {
        if (e.key === "Escape" || e.key === "Enter" || e.key === "Backspace") {
          e.preventDefault();
          setSynopsisProgram(null);
        }
        return;
      }
      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          comboRef.current = [];
          changeChannel("up");
          break;
        case "ArrowDown":
          e.preventDefault();
          comboRef.current = [];
          changeChannel("down");
          break;
        case "ArrowRight":
          e.preventDefault();
          pushCombo("R");
          showNextPreview("next");
          break;
        case "ArrowLeft":
          e.preventDefault();
          pushCombo("L");
          showNextPreview("prev");
          break;
        case "Enter": {
          e.preventDefault();
          if (isComboArmed()) {
            comboRef.current = [];
            setShowStats((s) => !s);
            break;
          }
          if (e.repeat) break;
          // Arm long-press timer for favorite toggle
          enterLongPressFiredRef.current = false;
          if (enterLongPressTimerRef.current) clearTimeout(enterLongPressTimerRef.current);
          const focusedId = focusedChannel?.id ?? "";
          enterLongPressTimerRef.current = setTimeout(() => {
            enterLongPressFiredRef.current = true;
            if (focusedId) toggleFavorite(focusedId);
          }, LONG_PRESS_MS);
          break;
        }
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      enterHandledRef.current = false;
      if (enterLongPressTimerRef.current) {
        clearTimeout(enterLongPressTimerRef.current);
        enterLongPressTimerRef.current = null;
      }
      if (enterLongPressFiredRef.current) {
        enterLongPressFiredRef.current = false;
        return;
      }
      if (showChannelList || synopsisProgram || showStats) return;
      const id = focusedChannel?.id ?? "";
      const now = Date.now();
      const last = lastEnterRef.current;
      // Double press within 400ms -> open list (or confirm preview)
      if (id && last.id === id && now - last.time < 400) {
        lastEnterRef.current = { id: "", time: 0 };
        if (showPreview) confirmPreview();
        else setShowChannelList(true);
        return;
      }
      lastEnterRef.current = { id, time: now };
      if (showPreview) {
        window.setTimeout(() => {
          if (lastEnterRef.current.id === id && lastEnterRef.current.time === now) {
            lastEnterRef.current = { id: "", time: 0 };
            confirmPreview();
          }
        }, 400);
      } else {
        showOSDTemporarily();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [changeChannel, showNextPreview, confirmPreview, showPreview, showChannelList, synopsisProgram, focusedChannel, openSynopsisForFocused, pushCombo, isComboArmed, showStats, toggleFavorite, showOSDTemporarily]);

  // Auto-hide OSD after initial show
  useEffect(() => {
    const t = setTimeout(() => setShowOSD(false), 3000);
    return () => clearTimeout(t);
  }, []);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent mx-auto mb-4" />
          <p className="text-muted-foreground">Carregando canais...</p>
        </div>
      </div>
    );
  }

  if (!channels?.length) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center glass-panel p-8">
          <p className="text-xl font-semibold text-foreground">Nenhum canal disponível</p>
          <p className="text-muted-foreground mt-2">
            Adicione canais no painel de administração
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative w-full h-full overflow-hidden bg-background select-none"
      style={{ width: '100vw', height: '100vh' }}
      {...touchHandlers}
      onClick={() => {
        if (!isMobile && !showChannelList) {
          if (showPreview) {
            confirmPreview();
          } else {
            setShowChannelList(true);
          }
        }
      }}
    >
      {currentChannel && (
        <>
          <VideoPlayer ref={playerRef} streamUrl={currentChannel.stream_url} />
          {showStats && (
            <StatsOverlay
              videoEl={playerRef.current?.getVideoElement() ?? null}
              hls={playerRef.current?.getHls() ?? null}
              onClose={() => setShowStats(false)}
            />
          )}
          {showPreview && previewChannel ? (
            <ChannelPreview
              channel={previewChannel}
              visible={true}
              direction={previewIndex !== null && previewIndex > currentIndex ? "next" : "prev"}
            />
          ) : (
            <>
              <FavoritesBar
                channels={channels}
                favoriteIds={favorites.map((f) => f.channel_id)}
                currentChannelId={currentChannel.id}
                visible={showFavoritesBar}
                onSelect={(ch) => {
                  const idx = channels.findIndex((c) => c.id === ch.id);
                  if (idx >= 0) {
                    setCurrentIndex(idx);
                    showOSDTemporarily();
                  }
                }}
              />
              <ChannelOSD channel={currentChannel} visible={showOSD} isFavorite={isFavorite(currentChannel.id)} />
            </>
          )}

          {/* Top info bar */}
          {showOSD && (
            <div className="absolute top-0 left-0 right-0 osd-top-gradient p-4 animate-fade-in z-10">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  {isMobile
                    ? "↕ Deslize para trocar • Toque para info"
                    : "↑↓ Trocar canal • →← Ver próximo • OK Lista de canais"}
                </span>
              </div>
            </div>
          )}

          {/* Mobile floating controls */}
          {isMobile && (
            <div className="absolute right-3 bottom-20 z-20 flex flex-col items-center gap-2 animate-fade-in">
              <button
                onClick={(e) => { e.stopPropagation(); changeChannel("up"); }}
                className="w-12 h-12 rounded-full bg-background/60 backdrop-blur-sm border border-border flex items-center justify-center active:bg-primary/30 transition-colors"
                aria-label="Canal anterior"
              >
                <ChevronUp className="w-6 h-6 text-foreground" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setShowChannelList(true); }}
                className="w-14 h-14 rounded-full bg-primary/80 backdrop-blur-sm flex items-center justify-center active:bg-primary transition-colors shadow-lg"
                aria-label="Lista de canais"
              >
                <List className="w-7 h-7 text-primary-foreground" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); changeChannel("down"); }}
                className="w-12 h-12 rounded-full bg-background/60 backdrop-blur-sm border border-border flex items-center justify-center active:bg-primary/30 transition-colors"
                aria-label="Próximo canal"
              >
                <ChevronDown className="w-6 h-6 text-foreground" />
              </button>
            </div>
          )}

          <ChannelList
            channels={channels}
            currentIndex={currentIndex}
            visible={showChannelList}
            onSelect={(index) => {
              setCurrentIndex(index);
              setShowChannelList(false);
              showOSDTemporarily();
            }}
            onClose={() => setShowChannelList(false)}
            onLogout={signOut}
          />

          {synopsisProgram && (
            <SynopsisModal
              program={synopsisProgram}
              channelName={focusedChannel?.name}
              onClose={() => setSynopsisProgram(null)}
            />
          )}
        </>
      )}
    </div>
  );
};

export default PlayerPage;
