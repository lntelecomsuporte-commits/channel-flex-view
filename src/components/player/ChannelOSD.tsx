import type { Channel } from "@/hooks/useChannels";

interface ChannelOSDProps {
  channel: Channel;
  visible: boolean;
}

const ChannelOSD = ({ channel, visible }: ChannelOSDProps) => {
  if (!visible) return null;

  return (
    <div className="absolute bottom-0 left-0 right-0 osd-gradient p-6 animate-slide-up z-10">
      <div className="flex items-center gap-4">
        <span className="channel-badge text-2xl min-w-[4rem] text-center">
          {channel.channel_number}
        </span>
        {channel.logo_url && (
          <img
            src={channel.logo_url}
            alt={channel.name}
            className="h-10 w-10 rounded-md object-contain bg-secondary"
          />
        )}
        <div>
          <h2 className="text-xl font-bold text-foreground">{channel.name}</h2>
        </div>
      </div>
    </div>
  );
};

export default ChannelOSD;
