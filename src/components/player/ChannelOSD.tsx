import type { Channel } from "@/hooks/useChannels";
import { useEPG } from "@/hooks/useEPG";

interface ChannelOSDProps {
  channel: Channel;
  visible: boolean;
}

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

const ChannelOSD = ({ channel, visible }: ChannelOSDProps) => {
  const ch = channel as any;
  const { data: epg } = useEPG({
    epg_type: ch.epg_type,
    epg_url: ch.epg_url,
    epg_channel_id: ch.epg_channel_id,
  });
  const altText = ch.epg_alt_text as string | null;
  const epgType = ch.epg_type as string | null;

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
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold text-foreground">{channel.name}</h2>
          {epg?.current ? (
            <div className="mt-1 space-y-0.5">
              <p className="text-sm text-foreground/90 truncate">
                <span className="text-primary font-semibold">Agora</span>{" "}
                <span className="text-muted-foreground">{formatTime(epg.current.start_date)}</span>{" "}
                {epg.current.title}
              </p>
              {epg.next && (
                <p className="text-xs text-muted-foreground truncate">
                  <span className="font-semibold">A seguir</span>{" "}
                  <span>{formatTime(epg.next.start_date)}</span>{" "}
                  {epg.next.title}
                </p>
              )}
            </div>
          ) : altText ? (
            <p className="text-sm text-muted-foreground mt-1 truncate">{altText}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default ChannelOSD;
