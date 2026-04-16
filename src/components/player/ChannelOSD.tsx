import type { Channel } from "@/hooks/useChannels";
import { useEPG } from "@/hooks/useEPG";

function RatingBadge({ rating }: { rating: string | null }) {
  if (!rating) return null;
  const r = rating.trim().toUpperCase();
  let bg = "bg-green-600";
  if (r === "18" || r === "18 ANOS") bg = "bg-black";
  else if (r === "16" || r === "16 ANOS") bg = "bg-red-600";
  else if (r === "14" || r === "14 ANOS") bg = "bg-orange-500";
  else if (r === "12" || r === "12 ANOS") bg = "bg-yellow-500";
  else if (r === "10" || r === "10 ANOS") bg = "bg-blue-500";
  else if (r === "L" || r === "LIVRE") bg = "bg-green-600";
  return (
    <span className={`${bg} text-white text-xs sm:text-sm font-bold px-2 py-0.5 rounded flex-shrink-0 leading-none`}>
      {r.replace(" ANOS", "")}
    </span>
  );
}

interface ChannelOSDProps {
  channel: Channel;
  visible: boolean;
}

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function ProgramProgress({ startDate, endDate }: { startDate: string; endDate: string | null }) {
  if (!endDate) return null;
  const now = Date.now();
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  const total = end - start;
  if (total <= 0) return null;
  const elapsed = Math.max(0, Math.min(now - start, total));
  const pct = (elapsed / total) * 100;

  return (
    <div className="w-full h-1.5 bg-muted/40 rounded-full mt-1.5 overflow-hidden">
      <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
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

  return (
    <div className="absolute bottom-0 left-0 right-0 osd-gradient p-4 sm:p-6 lg:p-8 animate-slide-up z-10">
      {/* Main row */}
      <div className="flex items-center gap-4 sm:gap-5 lg:gap-6">
        {/* Logo */}
        {channel.logo_url && (
          <div className="flex-shrink-0 w-14 h-14 sm:w-16 sm:h-16 lg:w-20 lg:h-20 rounded-lg overflow-hidden bg-white/10 flex items-center justify-center">
            <img
              src={channel.logo_url}
              alt={channel.name}
              className="w-full h-full object-contain p-1"
            />
          </div>
        )}

        {/* Channel number */}
        <span className="text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground tracking-tight flex-shrink-0">
          {String(channel.channel_number).padStart(3, "0")}
        </span>

        {/* Info block */}
        <div className="flex-1 min-w-0">
          <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold text-foreground leading-tight">
            {channel.name}
          </h2>

          {epg?.current ? (
            <div className="mt-1.5 sm:mt-2">
              <div className="flex items-center gap-2">
                {epg.current.rating && (
                  <RatingBadge rating={epg.current.rating} />
                )}
                <p className="text-sm sm:text-base lg:text-lg text-foreground/90 truncate">
                  {epg.current.title}
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground mt-0.5">
                <span>{formatTime(epg.current.start_date)}</span>
                {epg.next && (
                  <>
                    <span>—</span>
                    <span>{formatTime(epg.next.start_date)}</span>
                  </>
                )}
              </div>
              <ProgramProgress
                startDate={epg.current.start_date}
                endDate={epg.next?.start_date ?? null}
              />
            </div>
          ) : altText ? (
            <p className="text-sm sm:text-base text-muted-foreground mt-1 truncate">{altText}</p>
          ) : null}
        </div>

        {/* Next program (right side, desktop) */}
        {epg?.next && (
          <div className="hidden md:flex flex-col items-end flex-shrink-0 max-w-[280px] min-w-0 border-l border-border/30 pl-5">
            <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wide mb-0.5">A seguir</span>
            <p className="text-sm lg:text-base text-foreground/80 truncate w-full text-right">
              {epg.next.title}
            </p>
            <span className="text-xs text-muted-foreground">{formatTime(epg.next.start_date)}</span>
          </div>
        )}
      </div>

      {/* Next on mobile */}
      {epg?.next && (
        <div className="md:hidden mt-2 pt-2 border-t border-border/20">
          <p className="text-xs text-muted-foreground truncate">
            <span className="font-semibold">A seguir:</span> {formatTime(epg.next.start_date)} — {epg.next.title}
          </p>
        </div>
      )}
    </div>
  );
};

export default ChannelOSD;
