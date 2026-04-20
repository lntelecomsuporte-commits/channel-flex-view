import { forwardRef, useEffect, useState } from "react";
import type Hls from "hls.js";
import { X } from "lucide-react";

interface StatsOverlayProps {
  videoEl: HTMLVideoElement | null;
  hls: Hls | null;
  onClose: () => void;
}

interface Stats {
  resolution: string;
  fps: number;
  bitrate: string;
  bufferAhead: string;
  droppedFrames: number;
  totalFrames: number;
  bandwidth: string;
  level: string;
  codec: string;
}

const formatBitrate = (bps: number) => {
  if (!bps || !isFinite(bps)) return "—";
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`;
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(0)} kbps`;
  return `${bps.toFixed(0)} bps`;
};

const StatsOverlay = forwardRef<HTMLDivElement, StatsOverlayProps>(({ videoEl, hls, onClose }, ref) => {
  const [stats, setStats] = useState<Stats>({
    resolution: "—",
    fps: 0,
    bitrate: "—",
    bufferAhead: "—",
    droppedFrames: 0,
    totalFrames: 0,
    bandwidth: "—",
    level: "—",
    codec: "—",
  });

  useEffect(() => {
    if (!videoEl) return;

    let lastTime = performance.now();
    let lastFrames = 0;

    const interval = setInterval(() => {
      const w = videoEl.videoWidth;
      const h = videoEl.videoHeight;
      const resolution = w && h ? `${w}x${h} (${h}p)` : "—";

      // FPS via getVideoPlaybackQuality
      let fps = 0;
      let droppedFrames = 0;
      let totalFrames = 0;
      // @ts-ignore
      const q = videoEl.getVideoPlaybackQuality?.();
      if (q) {
        totalFrames = q.totalVideoFrames;
        droppedFrames = q.droppedVideoFrames;
        const now = performance.now();
        const dt = (now - lastTime) / 1000;
        const df = totalFrames - lastFrames;
        fps = dt > 0 ? Math.round(df / dt) : 0;
        lastTime = now;
        lastFrames = totalFrames;
      }

      // Buffer ahead
      let bufferAhead = "—";
      try {
        const buf = videoEl.buffered;
        if (buf.length > 0) {
          const end = buf.end(buf.length - 1);
          const ahead = Math.max(0, end - videoEl.currentTime);
          bufferAhead = `${ahead.toFixed(1)}s`;
        }
      } catch {}

      // HLS-specific
      let bitrate = "—";
      let bandwidth = "—";
      let level = "—";
      let codec = "—";
      if (hls) {
        const lvl = hls.levels?.[hls.currentLevel];
        if (lvl) {
          bitrate = formatBitrate(lvl.bitrate);
          level = `${hls.currentLevel + 1}/${hls.levels.length}`;
          codec = lvl.codecSet || lvl.videoCodec || "—";
        }
        // @ts-ignore
        const bw = hls.bandwidthEstimate;
        if (bw) bandwidth = formatBitrate(bw);
      } else {
        // Native playback (Safari/iOS) — estimate via webkit metrics if available
        // @ts-ignore
        const bytes = videoEl.webkitVideoDecodedByteCount;
        if (typeof bytes === "number") {
          // not super accurate, just show decoded total
          bandwidth = `${(bytes / 1_000_000).toFixed(1)} MB total`;
        }
      }

      setStats({ resolution, fps, bitrate, bufferAhead, droppedFrames, totalFrames, bandwidth, level, codec });
    }, 1000);

    return () => clearInterval(interval);
  }, [videoEl, hls]);

  return (
    <div ref={ref} className="absolute top-4 right-4 z-40 glass-panel p-4 min-w-[280px] animate-fade-in font-mono text-sm">
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-border">
        <span className="font-bold text-primary">📊 Estatísticas</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="space-y-1.5">
        <Row label="Resolução" value={stats.resolution} />
        <Row label="FPS" value={`${stats.fps}`} />
        <Row label="Bitrate" value={stats.bitrate} />
        <Row label="Banda estimada" value={stats.bandwidth} />
        <Row label="Buffer" value={stats.bufferAhead} />
        <Row label="Frames perdidos" value={`${stats.droppedFrames} / ${stats.totalFrames}`} />
        <Row label="Qualidade" value={stats.level} />
        <Row label="Codec" value={stats.codec} />
      </div>
    </div>
  );
});
StatsOverlay.displayName = "StatsOverlay";

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between gap-4">
    <span className="text-muted-foreground">{label}:</span>
    <span className="text-foreground font-semibold">{value}</span>
  </div>
);

export default StatsOverlay;
