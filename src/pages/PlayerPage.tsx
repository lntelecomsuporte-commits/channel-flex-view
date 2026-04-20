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
import { isSelectKey } from "@/lib/remoteKeys";
import { List, ChevronUp, ChevronDown } from "lucide-react";
import { toast } from "sonner";
...
      // OK while typing number = confirm immediately
      if (numBuffer && isSelectKey(e)) {
        if (numTimerRef.current) clearTimeout(numTimerRef.current);
        e.preventDefault();
        const buf = numBuffer;
        setNumBuffer("");
        jumpToChannelNumber(buf);
        return;
      }
...
        if (isSelectKey(e)) {
          e.preventDefault();
          if (isComboArmed()) {
            comboRef.current = [];
            setShowStats((s) => !s);
            return;
          }
          if (!enterLongPressTimerRef.current) {
            enterLongPressFiredRef.current = false;
            const focusedId = focusedChannel?.id ?? "";
            enterLongPressTimerRef.current = setTimeout(() => {
              enterLongPressFiredRef.current = true;
              enterLongPressTimerRef.current = null;
              if (focusedId) toggleFavorite(focusedId);
            }, LONG_PRESS_MS);
          }
          return;
        }
      };
      const handleKeyUp = (e: KeyboardEvent) => {
        if (!isSelectKey(e)) return;
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
