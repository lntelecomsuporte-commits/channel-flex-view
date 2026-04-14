import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import type { Channel } from "@/hooks/useChannels";
import { useMultiEPG } from "@/hooks/useMultiEPG";
import type { EPGProgram } from "@/hooks/useEPG";
import { LogOut } from "lucide-react";

interface ChannelListProps {
  channels: Channel[];
  currentIndex: number;
  visible: boolean;
  onSelect: (index: number) => void;
  onClose: () => void;
  onLogout?: () => void;
}

// Timeline config
const HOUR_WIDTH = 200; // px per hour
const TIMELINE_HOURS = 6; // show 6 hours total
const TIMELINE_PAST_HOURS = 1; // 1 hour in the past

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function getTimelineStart(): Date {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  now.setHours(now.getHours() - TIMELINE_PAST_HOURS);
  return now;
}

function getTimelineEnd(start: Date): Date {
  return new Date(start.getTime() + TIMELINE_HOURS * 3600000);
}

function timeToPixels(time: Date, timelineStart: Date): number {
  const diffMs = time.getTime() - timelineStart.getTime();
  return (diffMs / 3600000) * HOUR_WIDTH;
}

// Timeline header with hour markers
function TimelineHeader({ timelineStart, now }: { timelineStart: Date; now: Date }) {
  const hours: Date[] = [];
  for (let i = 0; i < TIMELINE_HOURS; i++) {
    const h = new Date(timelineStart.getTime() + i * 3600000);
    hours.push(h);
  }
  const nowX = timeToPixels(now, timelineStart);
  const totalWidth = TIMELINE_HOURS * HOUR_WIDTH;

  return (
    <div className="relative h-8 border-b border-border" style={{ width: totalWidth }}>
      {hours.map((h, i) => (
        <div
          key={i}
          className="absolute top-0 h-full flex items-center border-l border-border/50 pl-2"
          style={{ left: i * HOUR_WIDTH }}
        >
          <span className="text-xs text-muted-foreground font-medium">
            {h.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
      ))}
      {/* Now marker */}
      <div
        className="absolute top-0 h-full w-0.5 bg-primary z-10"
        style={{ left: nowX }}
      >
        <div className="absolute -top-0 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-[10px] px-1 rounded-b font-bold">
          AGORA
        </div>
      </div>
    </div>
  );
}

// Program block in the timeline
function ProgramBlock({
  program,
  nextStart,
  timelineStart,
  timelineEnd,
  isCurrent,
}: {
  program: EPGProgram;
  nextStart: Date | null;
  timelineStart: Date;
  timelineEnd: Date;
  isCurrent: boolean;
}) {
  const start = new Date(program.start_date);
  const end = nextStart || new Date(start.getTime() + 3600000);

  const clampedStart = start < timelineStart ? timelineStart : start;
  const clampedEnd = end > timelineEnd ? timelineEnd : end;

  if (clampedStart >= clampedEnd) return null;

  const left = timeToPixels(clampedStart, timelineStart);
  const width = timeToPixels(clampedEnd, timelineStart) - left;

  if (width < 2) return null;

  return (
    <div
      className={`absolute top-1 bottom-1 rounded px-2 flex items-center overflow-hidden border transition-colors ${
        isCurrent
          ? "bg-primary/20 border-primary/40"
          : "bg-secondary/60 border-border/30 hover:bg-secondary/80"
      }`}
      style={{ left, width: Math.max(width - 2, 20) }}
      title={`${formatTime(program.start_date)} - ${program.title}`}
    >
      <span className="text-xs text-foreground truncate">
        {width > 60 && (
          <span className="text-muted-foreground mr-1">{formatTime(program.start_date)}</span>
        )}
        {program.title}
      </span>
    </div>
  );
}

// EPG row for a single channel
function ChannelEPGRow({
  programs,
  timelineStart,
  timelineEnd,
  now,
}: {
  programs: EPGProgram[];
  timelineStart: Date;
  timelineEnd: Date;
  now: Date;
}) {
  const totalWidth = TIMELINE_HOURS * HOUR_WIDTH;

  return (
    <div className="relative h-10" style={{ width: totalWidth }}>
      {programs.map((prog, i) => {
        const start = new Date(prog.start_date);
        const nextStart = i + 1 < programs.length ? new Date(programs[i + 1].start_date) : null;
        const end = nextStart || new Date(start.getTime() + 3600000);
        const isCurrent = start <= now && end > now;

        // Skip programs entirely outside timeline
        if (end <= timelineStart || start >= timelineEnd) return null;

        return (
          <ProgramBlock
            key={i}
            program={prog}
            nextStart={nextStart}
            timelineStart={timelineStart}
            timelineEnd={timelineEnd}
            isCurrent={isCurrent}
          />
        );
      })}
      {/* Now line through programs */}
      <div
        className="absolute top-0 h-full w-0.5 bg-primary/60 z-10 pointer-events-none"
        style={{ left: timeToPixels(now, timelineStart) }}
      />
    </div>
  );
}

const ChannelList = ({ channels, currentIndex, visible, onSelect, onClose, onLogout }: ChannelListProps) => {
  const [focusedIndex, setFocusedIndex] = useState(currentIndex);
  const listRef = useRef<HTMLDivElement>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  const now = useMemo(() => new Date(), [visible]);
  const timelineStart = useMemo(() => getTimelineStart(), [visible]);
  const timelineEnd = useMemo(() => getTimelineEnd(timelineStart), [timelineStart]);

  const epgMap = useMultiEPG(
    channels.map((ch) => ({ id: ch.id, epg_url: (ch as any).epg_url }))
  );

  const hasAnyEPG = epgMap.size > 0;

  // Auto-scroll timeline to "now" position
  useEffect(() => {
    if (visible && timelineScrollRef.current) {
      const nowX = timeToPixels(now, timelineStart);
      timelineScrollRef.current.scrollLeft = Math.max(0, nowX - 100);
    }
  }, [visible, now, timelineStart]);

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
        case "ArrowLeft":
          e.preventDefault();
          e.stopPropagation();
          if (timelineScrollRef.current) {
            timelineScrollRef.current.scrollLeft -= 150;
          }
          break;
        case "ArrowRight":
          e.preventDefault();
          e.stopPropagation();
          if (timelineScrollRef.current) {
            timelineScrollRef.current.scrollLeft += 150;
          }
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

  const totalWidth = TIMELINE_HOURS * HOUR_WIDTH;

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-black/85 animate-fade-in">
      {/* Header */}
      <div className="p-3 border-b border-border flex-shrink-0">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold text-foreground">Guia de Programação</h2>
          <div className="flex items-center gap-4">
            <span className="text-xs text-muted-foreground">
              ↑↓ Navegar • ←→ Linha do tempo • OK Selecionar • ESC Fechar
            </span>
            {onLogout && (
              <button
                onClick={(e) => { e.stopPropagation(); onLogout(); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-destructive/20 hover:bg-destructive/40 text-destructive text-xs font-medium transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sair
              </button>
            )}
          </div>
        </div>
      </div>

      {/* EPG Grid */}
      <div className="flex flex-1 overflow-hidden">
        {/* Fixed channel column */}
        <div className="flex-shrink-0 w-52 md:w-64 border-r border-border flex flex-col">
          {/* Spacer for timeline header */}
          {hasAnyEPG && <div className="h-8 border-b border-border flex-shrink-0" />}
          <div
            className="overflow-y-auto flex-1"
            ref={listRef}
            onScroll={(e) => {
              if (timelineScrollRef.current) {
                timelineScrollRef.current.scrollTop = (e.target as HTMLDivElement).scrollTop;
              }
            }}
          >
            {channels.map((channel, index) => (
              <div
                key={channel.id}
                ref={(el) => { itemRefs.current[index] = el; }}
                onClick={() => onSelect(index)}
                className={`flex items-center gap-2 px-2 cursor-pointer transition-colors ${
                  hasAnyEPG ? "h-10" : "h-12"
                } ${
                  index === focusedIndex
                    ? "bg-primary/20 ring-1 ring-primary"
                    : index === currentIndex
                    ? "bg-accent/30"
                    : "hover:bg-accent/20"
                }`}
              >
                <span className="channel-badge text-[10px] min-w-[1.8rem] text-center">
                  {channel.channel_number}
                </span>
                <span className="font-medium text-foreground text-sm truncate flex-1">
                  {channel.name}
                </span>
                {index === currentIndex && (
                  <span className="text-[10px] text-primary font-bold flex-shrink-0">●</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Scrollable timeline */}
        {hasAnyEPG && (
          <div
            ref={timelineScrollRef}
            className="flex-1 overflow-x-auto overflow-y-auto"
            onScroll={(e) => {
              // Sync vertical scroll with channel column
              if (listRef.current) {
                listRef.current.scrollTop = (e.target as HTMLDivElement).scrollTop;
              }
            }}
          >
            <div style={{ width: totalWidth }}>
              {/* Timeline header */}
              <TimelineHeader timelineStart={timelineStart} now={now} />
              {/* Program rows */}
              {channels.map((channel) => {
                const programs = epgMap.get(channel.id) || [];
                const altText = (channel as any).epg_alt_text as string | null;
                return (
                  <div key={channel.id} className="relative h-10" style={{ width: totalWidth }}>
                    {programs.length > 0 ? (
                      <ChannelEPGRow
                        programs={programs}
                        timelineStart={timelineStart}
                        timelineEnd={timelineEnd}
                        now={now}
                      />
                    ) : altText ? (
                      <div className="absolute inset-0 flex items-center px-3">
                        <span className="text-xs text-muted-foreground italic truncate">{altText}</span>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* If no EPG data at all, show simple list */}
        {!hasAnyEPG && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-muted-foreground text-sm">
              Nenhum canal com EPG configurado.
              <br />
              Adicione URLs de EPG no painel admin.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChannelList;
