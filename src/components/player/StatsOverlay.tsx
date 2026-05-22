import { forwardRef, useEffect, useState } from "react";
import type Hls from "hls.js";
import { X } from "lucide-react";
import { NativePlayer, type NativePlayerStats } from "@/plugins/native-player";

interface StatsOverlayProps {
  videoEl: HTMLVideoElement | null;
  hls: Hls | null;
  streamUrl?: string;
  mode?: "html5" | "native";
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

interface DestIp {
  family: "IPv4" | "IPv6" | null;
  address: string;
  host: string;
}

const formatBitrate = (bps: number) => {
  if (!bps || !isFinite(bps)) return "—";
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`;
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(0)} kbps`;
  return `${bps.toFixed(0)} bps`;
};

const formatBytes = (b: number) => {
  if (!b || !isFinite(b)) return "—";
  if (b >= 1_073_741_824) return `${(b / 1_073_741_824).toFixed(2)} GB`;
  if (b >= 1_048_576) return `${(b / 1_048_576).toFixed(2)} MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${b} B`;
};

const NativeStatsBody = () => {
  const [s, setS] = useState<NativePlayerStats>({});
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const next = await NativePlayer.getStats();
        if (alive) setS(next);
      } catch { /* plugin pode não estar pronto */ }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const resolution = s.width && s.height ? `${s.width}x${s.height} (${s.height}p)` : "—";
  const fps = s.frameRate && s.frameRate > 0 ? `${Math.round(s.frameRate)}` : "—";
  const bitrate = s.bitrate ? formatBitrate(s.bitrate) : "—";
  const bandwidth = s.bandwidthEstimateBps ? formatBitrate(s.bandwidthEstimateBps) : "—";
  const transferred = formatBytes(s.totalBytesTransferred ?? 0);
  const buffer = typeof s.bufferedMs === "number" ? `${(s.bufferedMs / 1000).toFixed(1)}s` : "—";
  const dropped = typeof s.droppedFrames === "number" ? `${s.droppedFrames}` : "—";
  const codec = s.codec || s.mimeType || "—";

  return (
    <div className="space-y-1.5">
      <Row label="Resolução" value={resolution} />
      <Row label="FPS" value={fps} />
      <Row label="Bitrate" value={bitrate} />
      <Row label="Banda estimada" value={bandwidth} />
      <Row label="Total transferido" value={transferred} />
      <Row label="Buffer" value={buffer} />
      <Row label="Frames perdidos" value={dropped} />
      <Row label="Codec" value={codec} />
    </div>
  );
};

const StatsOverlay = forwardRef<HTMLDivElement, StatsOverlayProps>(({ videoEl, hls, streamUrl, mode = "html5", onClose }, ref) => {
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
  const [destIp, setDestIp] = useState<DestIp>({ family: null, address: "resolvendo...", host: "" });

  useEffect(() => {
    if (mode === "native") return;
    if (!videoEl) return;

    let lastTime = performance.now();
    let lastFrames = 0;

    const interval = setInterval(() => {
      const w = videoEl.videoWidth;
      const h = videoEl.videoHeight;
      const resolution = w && h ? `${w}x${h} (${h}p)` : "—";

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

      let bufferAhead = "—";
      try {
        const buf = videoEl.buffered;
        if (buf.length > 0) {
          const end = buf.end(buf.length - 1);
          const ahead = Math.max(0, end - videoEl.currentTime);
          bufferAhead = `${ahead.toFixed(1)}s`;
        }
      } catch {}

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
        // @ts-ignore
        const bytes = videoEl.webkitVideoDecodedByteCount;
        if (typeof bytes === "number") {
          bandwidth = `${(bytes / 1_000_000).toFixed(1)} MB total`;
        }
      }

      setStats({ resolution, fps, bitrate, bufferAhead, droppedFrames, totalFrames, bandwidth, level, codec });
    }, 1000);

    return () => clearInterval(interval);
  }, [videoEl, hls, mode]);

  // DoH só faz sentido no modo HTML5 (no nativo o foco é o ExoPlayer).
  useEffect(() => {
    if (mode === "native") return;
    if (!streamUrl) return;
    let cancelled = false;
    let host = "";
    try {
      host = new URL(streamUrl).hostname;
    } catch {
      setDestIp({ family: null, address: "—", host: "" });
      return;
    }

    const queryDoh = async (type: "A" | "AAAA"): Promise<string | null> => {
      const typeNum = type === "A" ? 1 : 28;
      const providers = [
        {
          url: `https://dns.google/resolve?name=${encodeURIComponent(host)}&type=${type}`,
          headers: { accept: "application/json" } as Record<string, string>,
        },
        {
          url: `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`,
          headers: { accept: "application/dns-json" } as Record<string, string>,
        },
      ];
      for (const p of providers) {
        try {
          const r = await fetch(p.url, { headers: p.headers, signal: AbortSignal.timeout(4000) });
          if (!r.ok) continue;
          const j = await r.json();
          const ans = (j.Answer ?? []).find((a: any) => a.type === typeNum);
          if (ans?.data) return ans.data;
        } catch { /* tenta próximo */ }
      }
      return null;
    };

    setDestIp({ family: null, address: "resolvendo...", host });
    Promise.all([queryDoh("A"), queryDoh("AAAA")]).then(([v4, v6]) => {
      if (cancelled) return;
      if (v6) setDestIp({ family: "IPv6", address: v6, host });
      else if (v4) setDestIp({ family: "IPv4", address: v4, host });
      else setDestIp({ family: null, address: "não resolvido", host });
    });

    return () => { cancelled = true; };
  }, [streamUrl, mode]);

  return (
    <div ref={ref} className="absolute top-4 right-4 z-40 glass-panel p-4 min-w-[280px] animate-fade-in font-mono text-sm">
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-border">
        <span className="font-bold text-primary">📊 Estatísticas</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>
      {mode === "native" ? (
        <NativeStatsBody />
      ) : (
        <div className="space-y-1.5">
          <Row label="Resolução" value={stats.resolution} />
          <Row label="FPS" value={`${stats.fps}`} />
          <Row label="Bitrate" value={stats.bitrate} />
          <Row label="Banda estimada" value={stats.bandwidth} />
          <Row label="Buffer" value={stats.bufferAhead} />
          <Row label="Frames perdidos" value={`${stats.droppedFrames} / ${stats.totalFrames}`} />
          <Row label="Qualidade" value={stats.level} />
          <Row label="Codec" value={stats.codec} />
          <Row
            label={`Destino ${destIp.family ?? ""}`.trim()}
            value={destIp.host ? `${destIp.address}` : "—"}
          />
          {destIp.host && (
            <Row label="Host" value={destIp.host} />
          )}
          {(() => {
            const p = getDeviceProfile();
            const cap = hls?.autoLevelCapping ?? -1;
            const capLabel = cap >= 0 && hls?.levels?.[cap]
              ? `${hls.levels[cap].height || "?"}p`
              : "none";
            return (
              <>
                <Row label="Device" value={`${p.weak ? "weak" : "strong"} (${p.reason})`} />
                <Row label="Level cap" value={capLabel} />
              </>
            );
          })()}
        </div>
      )}
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
