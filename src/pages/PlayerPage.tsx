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
import { toast } from "sonner";

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

  const [showOSD, setShowOSD] = useState(true);
  const [showFavoritesBar, setShowFavoritesBar] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showChannelList, setShowChannelList] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [osdTimeout, setOsdTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [previewTimeout, setPreviewTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);

  // Pré-carrega EPG em segundo plano. Pausa quando a lista está aberta ou
  // o usuário troca de canal; só retoma após 8s de inatividade.
  const [preloadEpg, setPreloadEpg] = useState(false);
  useEffect(() => {
    if (!channels?.length || showChannelList) {
      setPreloadEpg(false);
      return;
    }
    setPreloadEpg(false);
    const t = setTimeout(() => setPreloadEpg(true), 8000);
    return () => clearTimeout(t);
  }, [channels?.length, currentIndex, showChannelList]);

  useMultiEPG(
    channels?.map((ch: any) => ({
      id: ch.id,
      epg_type: ch.epg_type,
      epg_url: ch.epg_url,
      epg_channel_id: ch.epg_channel_id,
    })) ?? [],
    preloadEpg
  );


  const currentChannel: Channel | null = channels?.[currentIndex] ?? null;
  const previewChannel: Channel | null = previewIndex !== null ? channels?.[previewIndex] ?? null : null;
  const focusedChannel: Channel | null = previewChannel ?? currentChannel;

  const [synopsisProgram, setSynopsisProgram] = useState<EPGProgram | null>(null);
  const [favFocusIndex, setFavFocusIndex] = useState<number | null>(null);
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

  // Numeric channel jump: digite 149 + auto-confirma após 1.5s ou OK
  const [numBuffer, setNumBuffer] = useState("");
  const numTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jumpToChannelNumber = useCallback(
    (numStr: string) => {
      if (!channels?.length || !numStr) return;
      const target = parseInt(numStr, 10);
      if (isNaN(target)) return;
      const idx = channels.findIndex((c) => c.channel_number === target);
      if (idx >= 0) {
        setShowPreview(false);
        setPreviewIndex(null);
        setCurrentIndex(idx);
      } else {
        toast.error(`Canal ${target} não encontrado`);
      }
    },
    [channels]
  );
  const pushDigit = useCallback((digit: string) => {
    if (numTimerRef.current) clearTimeout(numTimerRef.current);
    setNumBuffer((prev) => {
      const next = (prev + digit).slice(-4);
      numTimerRef.current = setTimeout(() => {
        jumpToChannelNumber(next);
        setNumBuffer("");
      }, 1500);
      return next;
    });
  }, [jumpToChannelNumber]);

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

  // Triple-press back to exit. Counter resets after 2s of inactivity.
  const backPressRef = useRef<{ count: number; timer: ReturnType<typeof setTimeout> | null }>({ count: 0, timer: null });
  const handleBackPress = useCallback((): boolean => {
    // 1) Close any open overlay first (always handled)
    if (showStats) { setShowStats(false); return true; }
    if (synopsisProgram) { setSynopsisProgram(null); return true; }
    if (showChannelList) { setShowChannelList(false); return true; }
    if (favFocusIndex !== null) { setFavFocusIndex(null); return true; }
    if (showPreview) {
      setShowPreview(false);
      setPreviewIndex(null);
      if (previewTimeout) clearTimeout(previewTimeout);
      return true;
    }
    if (showOSD || showFavoritesBar) {
      setShowOSD(false);
      setShowFavoritesBar(false);
      if (osdTimeout) clearTimeout(osdTimeout);
      return true;
    }

    // 2) Nothing open — require 3 consecutive presses within 2s to exit
    backPressRef.current.count += 1;
    if (backPressRef.current.timer) clearTimeout(backPressRef.current.timer);

    if (backPressRef.current.count >= 3) {
      backPressRef.current.count = 0;
      return false; // let app exit
    }

    const remaining = 3 - backPressRef.current.count;
    toast(`Pressione Voltar mais ${remaining}x para sair`, { duration: 2000 });
    backPressRef.current.timer = setTimeout(() => {
      backPressRef.current.count = 0;
    }, 2000);
    return true;
  }, [showStats, synopsisProgram, showChannelList, favFocusIndex, showPreview, previewTimeout, showOSD, showFavoritesBar, osdTimeout]);

  // Hardware/remote Back button (Android TV)
  useNativeBackButton(handleBackPress);

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
      // Build ordered favorite channels (matches FavoritesBar ordering)
      const favChannels = favorites
        .map((f) => channels?.find((c) => c.id === f.channel_id))
        .filter((c): c is Channel => !!c);

      // ---- Favorites focus mode (only active when OSD+favorites bar is visible) ----
      if (favFocusIndex !== null) {
        switch (e.key) {
          case "ArrowLeft":
            e.preventDefault();
            setFavFocusIndex((i) => {
              if (i === null || favChannels.length === 0) return i;
              return i > 0 ? i - 1 : favChannels.length - 1;
            });
            showOSDTemporarily(true);
            return;
          case "ArrowRight":
            e.preventDefault();
            setFavFocusIndex((i) => {
              if (i === null || favChannels.length === 0) return i;
              return i < favChannels.length - 1 ? i + 1 : 0;
            });
            showOSDTemporarily(true);
            return;
          case "ArrowDown":
          case "Escape":
          case "Backspace":
            e.preventDefault();
            setFavFocusIndex(null);
            return;
          case "ArrowUp":
            // stay in favorites focus
            e.preventDefault();
            return;
          case "Enter":
            e.preventDefault();
            if (e.repeat) return;
            if (favChannels.length > 0 && favFocusIndex < favChannels.length) {
              const target = favChannels[favFocusIndex];
              const idx = channels?.findIndex((c) => c.id === target.id) ?? -1;
              if (idx >= 0) {
                setCurrentIndex(idx);
                setFavFocusIndex(null);
                showOSDTemporarily(false);
              }
            }
            return;
        }
      }

      // Numeric keys: jump to channel by number
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        pushDigit(e.key);
        return;
      }
      // OK while typing number = confirm immediately
      if (numBuffer && e.key === "Enter") {
        if (numTimerRef.current) clearTimeout(numTimerRef.current);
        e.preventDefault();
        const buf = numBuffer;
        setNumBuffer("");
        jumpToChannelNumber(buf);
        return;
      }

      switch (e.key) {
        case "Escape":
        case "Backspace":
          e.preventDefault();
          handleBackPress();
          break;
        case "ArrowUp":
          e.preventDefault();
          comboRef.current = [];
          // If OSD+favorites bar is showing and we have favorites, enter favorites focus
          if (showOSD && showFavoritesBar && favChannels.length > 0) {
            const activeIdx = favChannels.findIndex((c) => c.id === currentChannel?.id);
            setFavFocusIndex(activeIdx >= 0 ? activeIdx : 0);
            showOSDTemporarily(true);
            break;
          }
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
      // Preview ativo: OK confirma instantaneamente (sem delay de double-press)
      if (showPreview) {
        lastEnterRef.current = { id: "", time: 0 };
        confirmPreview();
        return;
      }
      const id = focusedChannel?.id ?? "";
      const now = Date.now();
      const last = lastEnterRef.current;
      // Double press within 400ms -> open list
      if (id && last.id === id && now - last.time < 400) {
        lastEnterRef.current = { id: "", time: 0 };
        setShowChannelList(true);
        return;
      }
      lastEnterRef.current = { id, time: now };
      showOSDTemporarily(true);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [changeChannel, showNextPreview, confirmPreview, showPreview, showChannelList, synopsisProgram, focusedChannel, openSynopsisForFocused, pushCombo, isComboArmed, showStats, toggleFavorite, showOSDTemporarily, favFocusIndex, favorites, channels, currentChannel, showOSD, showFavoritesBar, handleBackPress, pushDigit, numBuffer, jumpToChannelNumber]);

  // Clear favorites focus when OSD hides
  useEffect(() => {
    if (!showFavoritesBar || !showOSD) setFavFocusIndex(null);
  }, [showFavoritesBar, showOSD]);

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
                focusedIndex={favFocusIndex}
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

          {/* Numeric channel input overlay */}
          {numBuffer && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 pointer-events-none animate-fade-in">
              <div className="glass-panel px-8 py-6 text-center">
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Canal</p>
                <p className="text-6xl font-bold text-foreground tabular-nums">{numBuffer}</p>
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
