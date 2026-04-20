import { useEffect, useRef } from "react";
import type { Channel } from "@/hooks/useChannels";
import { Star } from "lucide-react";

interface FavoritesBarProps {
  channels: Channel[];
  favoriteIds: string[];
  currentChannelId: string | null;
  visible: boolean;
  onSelect: (channel: Channel) => void;
}

const FavoritesBar = ({ channels, favoriteIds, currentChannelId, visible, onSelect }: FavoritesBarProps) => {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  // ordered favorites
  const favs = favoriteIds
    .map((id) => channels.find((c) => c.id === id))
    .filter((c): c is Channel => !!c);

  useEffect(() => {
    if (visible && activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  }, [visible, currentChannelId]);

  if (!visible) return null;

  if (favs.length === 0) {
    return (
      <div className="absolute bottom-40 sm:bottom-44 lg:bottom-52 left-0 right-0 px-4 sm:px-6 lg:px-8 z-10 animate-fade-in pointer-events-none">
        <div className="inline-flex items-center gap-2 bg-background/70 backdrop-blur-sm border border-border/50 rounded-full px-4 py-2">
          <Star className="w-4 h-4 text-yellow-500" />
          <span className="text-xs sm:text-sm text-foreground/80">
            Segure OK para favoritar este canal
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute bottom-40 sm:bottom-44 lg:bottom-52 left-0 right-0 z-10 animate-slide-up">
      <div className="px-4 sm:px-6 lg:px-8 mb-1.5 flex items-center gap-1.5">
        <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
        <span className="text-xs font-semibold uppercase tracking-wide text-foreground/80">
          Favoritos
        </span>
      </div>
      <div
        ref={scrollerRef}
        className="flex gap-3 sm:gap-4 overflow-x-auto px-4 sm:px-6 lg:px-8 pb-2 scrollbar-thin"
        style={{ scrollbarWidth: "thin" }}
      >
        {favs.map((ch) => {
          const isActive = ch.id === currentChannelId;
          return (
            <button
              key={ch.id}
              ref={isActive ? activeRef : undefined}
              onClick={(e) => { e.stopPropagation(); onSelect(ch); }}
              className={`flex-shrink-0 flex flex-col items-center gap-1 rounded-lg p-2 transition-all ${
                isActive
                  ? "bg-primary/20 ring-2 ring-primary scale-105"
                  : "bg-background/60 backdrop-blur-sm hover:bg-background/80 border border-border/40"
              }`}
              style={{ width: 96 }}
            >
              <div className="w-16 h-16 rounded-md overflow-hidden bg-white/10 flex items-center justify-center">
                {ch.logo_url ? (
                  <img src={ch.logo_url} alt={ch.name} className="w-full h-full object-contain p-1" />
                ) : (
                  <span className="text-lg font-bold text-foreground/70">
                    {String(ch.channel_number).padStart(3, "0")}
                  </span>
                )}
              </div>
              <span className="text-[11px] leading-tight text-foreground/90 truncate w-full text-center">
                {ch.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default FavoritesBar;
