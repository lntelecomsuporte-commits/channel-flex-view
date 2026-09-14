/**
 * Suporte a "transmitir para a TV" — SOMENTE web/PWA (navegador).
 * Nada aqui roda no APK Android nativo, Android TV, Tizen ou Roku.
 *
 * Dois caminhos:
 *  - Chromecast (Chrome/Edge desktop e Android) via Google Cast Sender SDK.
 *  - AirPlay (Safari iOS/macOS) via webkitShowPlaybackTargetPicker no <video>.
 *
 * O Chromecast busca a URL sozinho, então precisa de uma URL pública HTTPS
 * (a mesma que o player já resolve via `resolveChannelStreamUrl`).
 */
import { Capacitor } from "@capacitor/core";

const CAST_SDK_SRC =
  "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";

type AnyWindow = Window & {
  chrome?: any;
  cast?: any;
  __onGCastApiAvailable?: (available: boolean) => void;
  WebKitPlaybackTargetAvailabilityEvent?: unknown;
};

const w = (): AnyWindow => window as unknown as AnyWindow;

export const isWebEnvironment = () =>
  typeof window !== "undefined" && !Capacitor.isNativePlatform();

/** Chromecast só existe em navegadores Chromium (desktop e Android). */
export const isChromecastCapable = () => {
  if (!isWebEnvironment()) return false;
  const ua = navigator.userAgent;
  const isChromium = /Chrome|CriOS|Edg/.test(ua) && !/OPR\//.test(ua);
  return isChromium && window.location.protocol === "https:";
};

export const isAirPlayCapable = () =>
  isWebEnvironment() && typeof w().WebKitPlaybackTargetAvailabilityEvent !== "undefined";

let sdkPromise: Promise<boolean> | null = null;

/** Carrega o SDK do Google Cast uma única vez. */
export const loadCastSdk = (): Promise<boolean> => {
  if (!isChromecastCapable()) return Promise.resolve(false);
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise<boolean>((resolve) => {
    const win = w();
    if (win.cast?.framework) return resolve(true);

    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    win.__onGCastApiAvailable = (available: boolean) => {
      if (!available) return done(false);
      try {
        const ctx = win.cast.framework.CastContext.getInstance();
        ctx.setOptions({
          receiverApplicationId: win.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
          autoJoinPolicy: win.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
        });
        done(true);
      } catch (e) {
        console.warn("[cast] falha ao iniciar SDK", e);
        done(false);
      }
    };

    const script = document.createElement("script");
    script.src = CAST_SDK_SRC;
    script.async = true;
    script.onerror = () => done(false);
    document.head.appendChild(script);

    setTimeout(() => done(!!win.cast?.framework), 8000);
  });

  return sdkPromise;
};

export interface CastMediaInfo {
  url: string;
  title: string;
  subtitle?: string;
  imageUrl?: string;
}

/** Existe algum dispositivo Chromecast disponível na rede? */
export const hasCastDevices = (): boolean => {
  const win = w();
  try {
    const state = win.cast?.framework?.CastContext.getInstance().getCastState();
    return state === "NOT_CONNECTED" || state === "CONNECTED";
  } catch {
    return false;
  }
};

export const isCasting = (): boolean => {
  const win = w();
  try {
    return !!win.cast?.framework?.CastContext.getInstance().getCurrentSession();
  } catch {
    return false;
  }
};

/** Abre o seletor de dispositivos e manda o canal pra TV. */
export const startCast = async (media: CastMediaInfo): Promise<void> => {
  const win = w();
  const ctx = win.cast.framework.CastContext.getInstance();

  if (!ctx.getCurrentSession()) {
    await ctx.requestSession();
  }
  const session = ctx.getCurrentSession();
  if (!session) throw new Error("Nenhuma sessão de transmissão");

  const contentType = /\.m3u8(\?|$)/i.test(media.url)
    ? "application/x-mpegURL"
    : "video/mp4";

  const mediaInfo = new win.chrome.cast.media.MediaInfo(media.url, contentType);
  mediaInfo.streamType = win.chrome.cast.media.StreamType.LIVE;
  const metadata = new win.chrome.cast.media.GenericMediaMetadata();
  metadata.title = media.title;
  if (media.subtitle) metadata.subtitle = media.subtitle;
  if (media.imageUrl) {
    try {
      metadata.images = [new win.chrome.cast.Image(media.imageUrl)];
    } catch {
      /* imagem é opcional */
    }
  }
  mediaInfo.metadata = metadata;

  const request = new win.chrome.cast.media.LoadRequest(mediaInfo);
  request.autoplay = true;
  await session.loadMedia(request);
};

export const stopCast = () => {
  const win = w();
  try {
    win.cast?.framework?.CastContext.getInstance().endCurrentSession(true);
  } catch {
    /* ignore */
  }
};

/** Observa mudanças de estado (conectado / desconectado / disponível). */
export const onCastStateChanged = (cb: () => void): (() => void) => {
  const win = w();
  try {
    const ctx = win.cast.framework.CastContext.getInstance();
    const evt = win.cast.framework.CastContextEventType.CAST_STATE_CHANGED;
    ctx.addEventListener(evt, cb);
    return () => {
      try {
        ctx.removeEventListener(evt, cb);
      } catch {
        /* ignore */
      }
    };
  } catch {
    return () => {};
  }
};

/** Abre o seletor de AirPlay do Safari para o elemento de vídeo atual. */
export const showAirPlayPicker = (video: HTMLVideoElement | null) => {
  if (!video) return;
  const v = video as HTMLVideoElement & {
    webkitShowPlaybackTargetPicker?: () => void;
  };
  try {
    v.webkitShowPlaybackTargetPicker?.();
  } catch (e) {
    console.warn("[cast] AirPlay indisponível", e);
  }
};
