import type { Channel } from "@/hooks/useChannels";

interface ChannelPreviewProps {
  channel: Channel | null;
  visible: boolean;
  direction: "next" | "prev";
}

const ChannelPreview = ({ channel, visible, direction }: ChannelPreviewProps) => {
  if (!visible || !channel) return null;

  return (
    <div className="absolute right-4 top-1/2 -translate-y-1/2 z-20 animate-slide-right">
      <div className="glass-panel p-4 w-64">
        <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">
          {direction === "next" ? "Próximo" : "Anterior"}
        </div>
        <div className="flex items-center gap-3">
          <span className="channel-badge text-lg">
            {channel.channel_number}
          </span>
          <div>
            <p className="font-semibold text-foreground">{channel.name}</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Pressione OK para trocar
        </p>
      </div>
    </div>
  );
};

export default ChannelPreview;
