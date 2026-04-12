import { useState, useEffect, useCallback } from "react";
import { useChannels, type Channel } from "@/hooks/useChannels";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTouchControls } from "@/hooks/useTouchControls";
import VideoPlayer from "@/components/player/VideoPlayer";
import ChannelOSD from "@/components/player/ChannelOSD";
import ChannelPreview from "@/components/player/ChannelPreview";
import ChannelList from "@/components/player/ChannelList";
import { List, ChevronUp, ChevronDown } from "lucide-react";

const PlayerPage = () => {
  useEffect(() => {
    document.body.classList.add("player-mode");
    return () => document.body.classList.remove("player-mode");
  }, []);

  const { data: channels, isLoading } = useChannels();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showOSD, setShowOSD] = useState(true);
  const [showPreview, setShowPreview] = useState(false);
  const [showChannelList, setShowChannelList] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [osdTimeout, setOsdTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [previewTimeout, setPreviewTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);

  const currentChannel: Channel | null = channels?.[currentIndex] ?? null;
  const previewChannel: Channel | null = previewIndex !== null ? channels?.[previewIndex] ?? null : null;

  const showOSDTemporarily = useCallback(() => {
    setShowOSD(true);
    if (osdTimeout) clearTimeout(osdTimeout);
    const t = setTimeout(() => setShowOSD(false), 3000);
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (showChannelList) return; // Let ChannelList handle keys
      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          changeChannel("up");
          break;
        case "ArrowDown":
          e.preventDefault();
          changeChannel("down");
          break;
        case "ArrowRight":
          e.preventDefault();
          showNextPreview("next");
          break;
        case "ArrowLeft":
          e.preventDefault();
          showNextPreview("prev");
          break;
        case "Enter":
          e.preventDefault();
          if (showPreview) {
            confirmPreview();
          } else {
            setShowChannelList(true);
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [changeChannel, showNextPreview, confirmPreview, showPreview, showChannelList]);

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
    <div className="relative w-full h-full overflow-hidden bg-background select-none" style={{ width: '100vw', height: '100vh' }}>
      {currentChannel && (
        <>
          <VideoPlayer streamUrl={currentChannel.stream_url} />
          <ChannelOSD channel={currentChannel} visible={showOSD} />
          <ChannelPreview
            channel={previewChannel}
            visible={showPreview}
            direction={previewIndex !== null && previewIndex > currentIndex ? "next" : "prev"}
          />

          {/* Top info bar */}
          {showOSD && (
            <div className="absolute top-0 left-0 right-0 osd-top-gradient p-4 animate-fade-in z-10">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  ↑↓ Trocar canal • →← Ver próximo • OK Lista de canais
                </span>
              </div>
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
          />
        </>
      )}
    </div>
  );
};

export default PlayerPage;
