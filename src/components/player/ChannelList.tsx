import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import type { Channel } from "@/hooks/useChannels";
import { useMultiEPG } from "@/hooks/useMultiEPG";
import type { EPGProgram } from "@/hooks/useEPG";
import { LogOut, X } from "lucide-react";

interface ChannelListProps {
  channels: Channel[];
  currentIndex: number;
  visible: boolean;
  onSelect: (index: number) => void;
  onClose: () => void;
  onLogout?: () => void;
}

const HOUR_WIDTH = 200;
const TIMELINE_HOURS = 6;
const TIMELINE_PAST_HOURS = 1;

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
        <div key={i} className="absolute top-0 h-full flex items-center border-l border-border/50 pl-2" style={{ left: i * HOUR_WIDTH }}>
          <span className="text-xs text-muted-foreground font-medium">
            {h.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
      ))}
      <div className="absolute top-0 h-full w-0.5 bg-primary z-10" style={{ left: nowX }}>
        <div className="absolute -top-0 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-[10px] px-1 rounded-b font-bold">
          AGORA
        </div>
      </div>
    </div>
  );
}

function ProgramBlock({
  program,
  nextStart,
  timelineStart,
  timelineEnd,
  isCurrent,
  showSynopsis,
  onClickSynopsis,
}: {
  program: EPGProgram;
  nextStart: Date | null;
  timelineStart: Date;
  timelineEnd: Date;
  isCurrent: boolean;
  showSynopsis: boolean;
  onClickSynopsis?: (program: EPGProgram) => void;
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
      } ${showSynopsis && program.desc ? "cursor-pointer" : ""}`}
      style={{ left, width: Math.max(width - 2, 20) }}
      title={`${formatTime(program.start_date)} - ${program.title}`}
      onClick={showSynopsis && program.desc && onClickSynopsis ? (e) => { e.stopPropagation(); onClickSynopsis(program); } : undefined}
    >
      <span className="text-xs text-foreground truncate">
        {width > 60 && (
          <span className="text-muted-foreground mr-1">{formatTime(program.start_date)}</span>
        )}
        {program.title}
        {showSynopsis && program.desc && <span className="ml-1 text-primary">ℹ</span>}
      </span>
    </div>
  );
}

function ChannelEPGRow({
  programs,
  timelineStart,
  timelineEnd,
  now,
  showSynopsis,
  onClickSynopsis,
}: {
  programs: EPGProgram[];
  timelineStart: Date;
  timelineEnd: Date;
  now: Date;
  showSynopsis: boolean;
  onClickSynopsis?: (program: EPGProgram) => void;
}) {
  const totalWidth = TIMELINE_HOURS * HOUR_WIDTH;

  return (
    <div className="relative h-10" style={{ width: totalWidth }}>
      {programs.map((prog, i) => {
        const start = new Date(prog.start_date);
        const nextStart = i + 1 < programs.length ? new Date(programs[i + 1].start_date) : null;
        const end = nextStart || new Date(start.getTime() + 3600000);
        const isCurrent = start <= now && end > now;

        if (end <= timelineStart || start >= timelineEnd) return null;

        return (
          <ProgramBlock
            key={i}
            program={prog}
            nextStart={nextStart}
            timelineStart={timelineStart}
            timelineEnd={timelineEnd}
            isCurrent={isCurrent}
            showSynopsis={showSynopsis}
            onClickSynopsis={onClickSynopsis}
          />
        );
      })}
      <div
        className="absolute top-0 h-full w-0.5 bg-primary/60 z-10 pointer-events-none"
        style={{ left: timeToPixels(now, timelineStart) }}
      />
    </div>
  );
}

// Synopsis modal
function SynopsisModal({ program, onClose }: { program: EPGProgram; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="bg-background rounded-lg p-6 max-w-lg w-full mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-3">
          <div>
            <h3 className="text-lg font-bold text-foreground">{program.title}</h3>
            <p className="text-sm text-muted-foreground">{formatTime(program.start_date)}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-sm text-foreground/90 leading-relaxed">{program.desc || "Sinopse não disponível."}</p>
      </div>
    </div>
  );
}

const ChannelList = ({ channels, currentIndex, visible, onSelect, onClose, onLogout }: ChannelListProps) => {
  const [focusedIndex, setFocusedIndex] = useState(currentIndex);
  const [synopsisProgram, setSynopsisProgram] = useState<EPGProgram | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  const now = useMemo(() => new Date(), [visible]);
  const timelineStart = useMemo(() => getTimelineStart(), [visible]);
  const timelineEnd = useMemo(() => getTimelineEnd(timelineStart), [timelineStart]);

  const epgMap = useMultiEPG(
    channels.map((ch) => ({
      id: ch.id,
      epg_type: (ch as any).epg_type,
      epg_url: (ch as any).epg_url,
      epg_channel_id: (ch as any).epg_channel_id,
    }))
  );

  const hasAnyEPG = epgMap.size > 0 || channels.some((ch) => (ch as any).epg_type === "alt_text" && (ch as any).epg_alt_text);

  useEffect(() => {
    if (visible && timelineScrollRef.current) {
      const nowX = timeToPixels(now, timelineStart);
      timelineScrollRef.current.scrollLeft = Math.max(0, nowX - 100);
    }
  }, [visible, now, timelineStart]);

  useEffect(() => {
    if (visible) setFocusedIndex(currentIndex);
  }, [visible, currentIndex]);

  useEffect(() => {
    itemRefs.current[focusedIndex]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusedIndex]);

  useEffect(() => {
    if (!visible) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (synopsisProgram) {
        if (e.key === "Escape") { e.preventDefault(); setSynopsisProgram(null); }
        return;
      }
      switch (e.key) {
        case "ArrowUp": e.preventDefault(); e.stopPropagation(); setFocusedIndex((prev) => (prev > 0 ? prev - 1 : channels.length - 1)); break;
        case "ArrowDown": e.preventDefault(); e.stopPropagation(); setFocusedIndex((prev) => (prev < channels.length - 1 ? prev + 1 : 0)); break;
        case "ArrowLeft": e.preventDefault(); e.stopPropagation(); if (timelineScrollRef.current) timelineScrollRef.current.scrollLeft -= 150; break;
        case "ArrowRight": e.preventDefault(); e.stopPropagation(); if (timelineScrollRef.current) timelineScrollRef.current.scrollLeft += 150; break;
        case "Enter": e.preventDefault(); e.stopPropagation(); onSelect(focusedIndex); break;
        case "Escape": case "Backspace": e.preventDefault(); e.stopPropagation(); onClose(); break;
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [visible, focusedIndex, channels.length, onSelect, onClose, synopsisProgram]);

  if (!visible) return null;

  const totalWidth = TIMELINE_HOURS * HOUR_WIDTH;

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-black/85 animate-fade-in">
      <div className="p-3 border-b border-border flex-shrink-0">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold text-foreground">Guia de Programação</h2>
          <div className="flex items-center gap-4">
            <span className="text-xs text-muted-foreground">↑↓ Navegar • ←→ Linha do tempo • OK Selecionar • ESC Fechar</span>
            {onLogout && (
              <button onClick={(e) => { e.stopPropagation(); onLogout(); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-destructive/20 hover:bg-destructive/40 text-destructive text-xs font-medium transition-colors">
                <LogOut className="w-3.5 h-3.5" /> Sair
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-shrink-0 w-52 md:w-64 border-r border-border flex flex-col">
          {hasAnyEPG && <div className="h-8 border-b border-border flex-shrink-0" />}
          <div
            className="overflow-y-auto flex-1"
            ref={listRef}
            onScroll={(e) => {
              if (timelineScrollRef.current) timelineScrollRef.current.scrollTop = (e.target as HTMLDivElement).scrollTop;
            }}
          >
            {channels.map((channel, index) => (
              <div
                key={channel.id}
                ref={(el) => { itemRefs.current[index] = el; }}
                onClick={() => onSelect(index)}
                className={`flex items-center gap-2 px-2 cursor-pointer transition-colors ${hasAnyEPG ? "h-10" : "h-12"} ${
                  index === focusedIndex ? "bg-primary/20 ring-1 ring-primary" : index === currentIndex ? "bg-accent/30" : "hover:bg-accent/20"
                }`}
              >
                <span className="channel-badge text-[10px] min-w-[1.8rem] text-center">{channel.channel_number}</span>
                <span className="font-medium text-foreground text-sm truncate flex-1">{channel.name}</span>
                {index === currentIndex && <span className="text-[10px] text-primary font-bold flex-shrink-0">●</span>}
              </div>
            ))}
          </div>
        </div>

        {hasAnyEPG && (
          <div
            ref={timelineScrollRef}
            className="flex-1 overflow-x-auto overflow-y-auto"
            onScroll={(e) => {
              if (listRef.current) listRef.current.scrollTop = (e.target as HTMLDivElement).scrollTop;
            }}
          >
            <div style={{ width: totalWidth }}>
              <TimelineHeader timelineStart={timelineStart} now={now} />
              {channels.map((channel) => {
                const ch = channel as any;
                const programs = epgMap.get(channel.id) || [];
                const altText = ch.epg_alt_text as string | null;
                const epgType = ch.epg_type as string | null;
                const showSynopsis = !!ch.epg_show_synopsis;

                return (
                  <div key={channel.id} className="relative h-10" style={{ width: totalWidth }}>
                    {programs.length > 0 ? (
                      <ChannelEPGRow
                        programs={programs}
                        timelineStart={timelineStart}
                        timelineEnd={timelineEnd}
                        now={now}
                        showSynopsis={showSynopsis}
                        onClickSynopsis={(prog) => setSynopsisProgram(prog)}
                      />
                    ) : epgType === "alt_text" && altText ? (
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

        {!hasAnyEPG && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-muted-foreground text-sm">
              Nenhum canal com EPG configurado.<br />Adicione EPG no painel admin.
            </p>
          </div>
        )}
      </div>

      {synopsisProgram && <SynopsisModal program={synopsisProgram} onClose={() => setSynopsisProgram(null)} />}
    </div>
  );
};

export default ChannelList;
