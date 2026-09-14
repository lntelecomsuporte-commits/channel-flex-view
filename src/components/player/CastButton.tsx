import { useEffect, useState } from "react";
import { Cast, MonitorSmartphone } from "lucide-react";
import { toast } from "sonner";
import {
  hasCastDevices,
  isAirPlayCapable,
  isCasting,
  isChromecastCapable,
  isWebEnvironment,
  loadCastSdk,
  onCastStateChanged,
  showAirPlayPicker,
  startCast,
  stopCast,
} from "@/lib/cast";
import { resolveChannelStreamUrl } from "@/lib/stream";

interface CastButtonProps {
  channel: {
    id: string;
    name: string;
    stream_url: string;
    logo_url?: string | null;
    use_proxy_token?: boolean;
  } | null;
  /** <video> atual — usado pelo AirPlay no Safari. */
  getVideoElement: () => HTMLVideoElement | null;
  /** Avisa a página que a transmissão está ativa (para pausar localmente). */
  onCastingChange?: (casting: boolean) => void;
  visible?: boolean;
}

/**
 * Botão "transmitir para a TV" — aparece apenas no navegador/PWA.
 * No APK Android, Android TV, Tizen e Roku nada disso é renderizado.
 */
const CastButton = ({ channel, getVideoElement, onCastingChange, visible = true }: CastButtonProps) => {
  const [castReady, setCastReady] = useState(false);
  const [casting, setCasting] = useState(false);
  const [airplay, setAirplay] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isWebEnvironment()) return;
    setAirplay(isAirPlayCapable());
    if (!isChromecastCapable()) return;
    let cleanup = () => {};
    loadCastSdk().then((ok) => {
      if (!ok) return;
      const sync = () => {
        setCastReady(hasCastDevices());
        const active = isCasting();
        setCasting(active);
        onCastingChange?.(active);
      };
      sync();
      cleanup = onCastStateChanged(sync);
    });
    return () => cleanup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isWebEnvironment() || !visible) return null;
  if (!castReady && !airplay) return null;

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;

    if (casting) {
      stopCast();
      setCasting(false);
      onCastingChange?.(false);
      return;
    }

    if (!castReady && airplay) {
      showAirPlayPicker(getVideoElement());
      return;
    }

    if (!channel) return;
    setBusy(true);
    try {
      const url = await resolveChannelStreamUrl(
        channel.stream_url,
        channel.id,
        channel.use_proxy_token ?? false,
      );
      if (!url) throw new Error("URL do canal indisponível");
      if (!/^https:/i.test(url)) {
        toast.error("Este canal não pode ser transmitido para a TV");
        return;
      }
      await startCast({
        url,
        title: channel.name,
        subtitle: "LN TV",
        imageUrl: channel.logo_url || undefined,
      });
      setCasting(true);
      onCastingChange?.(true);
    } catch (err: any) {
      if (err?.code !== "cancel" && err !== "cancel") {
        console.warn("[cast] falha ao transmitir", err);
        toast.error("Não foi possível transmitir para a TV");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={casting ? "Parar transmissão na TV" : "Transmitir para a TV"}
      className={`absolute top-4 right-4 z-30 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card/80 backdrop-blur-sm transition-colors ${
        casting ? "text-primary border-primary" : "text-foreground"
      }`}
    >
      {castReady ? <Cast className="h-5 w-5" /> : <MonitorSmartphone className="h-5 w-5" />}
    </button>
  );
};

export default CastButton;
