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

function getProgress(startStr: string, endStr: string | null): number {
  if (!endStr) return 0;
  const now = Date.now();
  const start = new Date(startStr).getTime();
  const end = new Date(endStr).getTime();
  if (end <= start) return 0;
  return Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100));
}

const ChannelOSD = ({ channel, visible }: ChannelOSDProps) => {
  const ch = channel as any;
  const { data: epg } = useEPG({
    epg_type: ch.epg_type,
    epg_url: ch.epg_url,
    epg_channel_id: ch.epg_channel_id,
  });
  const altText = ch.epg_alt_text as string | null;

  if (!visible) return null;

  const currentProgress = epg?.current && epg?.next
    ? getProgress(epg.current.start_date, epg.next.start_date)
    : 0;

  return (
    <div className="absolute bottom-0 left-0 right-0 z-10 animate-slide-up">
      {/* OSD container */}
      <div className="bg-black/80 backdrop-blur-sm border-t border-border/30">
        {/* Main row */}
        <div className="flex items-center px-4 py-3 md:px-8 md:py-4 gap-4 md:gap-6">
          {/* Channel logo */}
          {channel.logo_url && (
            <div className="flex-shrink-0 w-14 h-14 md:w-20 md:h-20 rounded-lg overflow-hidden bg-white/10 flex items-center justify-center">
              <img
                src={channel.logo_url}
                alt={channel.name}
                className="w-full h-full object-contain p-1"
              />
            </div>
          )}

          {/* Channel number + name + current EPG */}
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-3 mb-1">
              <span className="text-2xl md:text-4xl font-bold text-primary tabular-nums">
                {String(channel.channel_number).padStart(3, "0")}
              </span>
              <h2 className="text-xl md:text-3xl font-bold text-foreground truncate">
                {channel.name}
              </h2>
            </div>

            {epg?.current ? (
              <div className="space-y-1.5">
                <p className="text-sm md:text-lg text-foreground/90 truncate">
                  {epg.current.title}
                </p>
                {/* Progress bar with times */}
                <div className="flex items-center gap-2 md:gap-3">
                  <span className="text-xs md:text-sm text-muted-foreground tabular-nums">
                    {formatTime(epg.current.start_date)}
                  </span>
                  <div className="flex-1 max-w-xs h-1.5 md:h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${currentProgress}%` }}
                    />
                  </div>
                  <span className="text-xs md:text-sm text-muted-foreground tabular-nums">
                    {epg.next ? formatTime(epg.next.start_date) : "--:--"}
                  </span>
                </div>
              </div>
            ) : altText ? (
              <p className="text-sm md:text-lg text-muted-foreground mt-1 truncate">{altText}</p>
            ) : null}
          </div>

          {/* Next program (right side, desktop) */}
          {epg?.next && (
            <div className="hidden md:flex flex-shrink-0 flex-col items-end border-l border-border/40 pl-6 max-w-[280px]">
              <span className="text-xs text-muted-foreground uppercase tracking-wider mb-1">A seguir</span>
              <p className="text-base text-foreground/90 truncate max-w-full text-right">
                {epg.next.title}
              </p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatTime(epg.next.start_date)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Next program row (mobile only) */}
        {epg?.next && (
          <div className="md:hidden px-4 pb-3 flex items-center gap-2">
            <span className="text-xs text-primary font-semibold">A seguir</span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatTime(epg.next.start_date)}
            </span>
            <span className="text-xs text-foreground/80 truncate">{epg.next.title}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChannelOSD;
