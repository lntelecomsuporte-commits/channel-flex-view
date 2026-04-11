import { useState, useEffect, useRef } from "react";
import type { Channel } from "@/hooks/useChannels";

interface ChannelListProps {
  channels: Channel[];
  currentIndex: number;
  visible: boolean;
  onSelect: (index: number) => void;
  onClose: () => void;
}

const ChannelList = ({ channels, currentIndex, visible, onSelect, onClose }: ChannelListProps) => {
  const [focusedIndex, setFocusedIndex] = useState(currentIndex);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (visible) {
      setFocusedIndex(currentIndex);
    }
  }, [visible, currentIndex]);

  useEffect(() => {
    itemRefs.current[focusedIndex]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusedIndex]);

  useEffect(() => {
    if (!visible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          e.stopPropagation();
          setFocusedIndex((prev) => (prev > 0 ? prev - 1 : channels.length - 1));
          break;
        case "ArrowDown":
          e.preventDefault();
          e.stopPropagation();
          setFocusedIndex((prev) => (prev < channels.length - 1 ? prev + 1 : 0));
          break;
        case "Enter":
          e.preventDefault();
          e.stopPropagation();
          onSelect(focusedIndex);
          break;
        case "Escape":
        case "Backspace":
          e.preventDefault();
          e.stopPropagation();
          onClose();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [visible, focusedIndex, channels.length, onSelect, onClose]);

  if (!visible) return null;

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 animate-fade-in">
      <div className="glass-panel w-full max-w-md max-h-[80vh] flex flex-col mx-4">
        <div className="p-4 border-b border-border">
          <h2 className="text-lg font-bold text-foreground">Lista de Canais</h2>
          <p className="text-xs text-muted-foreground mt-1">
            ↑↓ Navegar • OK Selecionar • ESC Fechar
          </p>
        </div>
        <div ref={listRef} className="overflow-y-auto flex-1 p-2">
          {channels.map((channel, index) => (
            <div
              key={channel.id}
              ref={(el) => { itemRefs.current[index] = el; }}
              onClick={() => onSelect(index)}
              className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                index === focusedIndex
                  ? "bg-primary/20 ring-1 ring-primary"
                  : index === currentIndex
                  ? "bg-accent/30"
                  : "hover:bg-accent/20"
              }`}
            >
              <span className="channel-badge text-sm min-w-[3rem] text-center">
                {channel.channel_number}
              </span>
              {channel.logo_url && (
                <img
                  src={channel.logo_url}
                  alt={channel.name}
                  className="h-8 w-8 rounded object-contain bg-secondary"
                />
              )}
              <span className="font-medium text-foreground truncate">{channel.name}</span>
              {index === currentIndex && (
                <span className="ml-auto text-xs text-primary font-semibold">AO VIVO</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ChannelList;
