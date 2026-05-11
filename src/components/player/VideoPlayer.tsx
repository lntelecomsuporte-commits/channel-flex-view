import { useRef, useEffect, useState, forwardRef, useImperativeHandle } from "react";
import Hls from "hls.js";
import mpegts from "mpegts.js";
import { getPlayableStreamUrl, resolveChannelStreamUrl, buildProxyStreamUrl, isProxiedStreamUrl, resolveRedirects } from "@/lib/stream";
import { Capacitor } from "@capacitor/core";
import { extractYouTubeVideoId } from "@/lib/youtube";
import { getDeviceProfile } from "@/lib/deviceProfile";
import YouTubePlayer from "./YouTubePlayer";
import { LntvPlayer, isNativePlayerAvailable } from "@/lib/native/lntvPlayer";

/** Detecta o engine a usar com base na URL (extensão). */
const detectEngine = (url: string, sourceUrl = url, forcedContentType = ""): "hls" | "mpegts" | "native" => {
  const contentType = forcedContentType.toLowerCase();
  if (contentType.includes("video/mp2t") || contentType.includes("video/mpeg")) return "mpegts";
  const source = sourceUrl.toLowerCase();
  const playable = url.toLowerCase();
  if (/\.m3u8(\?|$)/.test(source) || /\.m3u8(\?|$)/.test(playable)) return "hls";
  if (/\.(ts|m2ts)(\?|$)/.test(source) || /\.(ts|m2ts)(\?|$)/.test(playable)) return "mpegts";
  return "native";
};

const isHlsManifestUrl = (url: string): boolean => {
  try {
    const pathname = new URL(url).pathname;
    return /\.m3u8$/i.test(pathname);
  } catch {
    return /\.m3u8(\?|$)/i.test(url);
  }
};

interface VideoPlayerProps {
  streamUrl: string;
  autoPlay?: boolean;
  /** Quando setado junto com `useProxyToken`, força o stream pelo hls-proxy
   *  com token assinado (esconde a URL real do provedor no F12). */
  channelId?: string | null;
  useProxyToken?: boolean;
  /** Quando true, força o stream pelo hls-proxy no APK (sem token assinado).
   *  Útil pra canais com cert ruim/HTTP/rotas instáveis. Ignorado na web. */
  forceProxyNative?: boolean;
  /** Lista ordenada de URLs de fallback. Quando o player esgota tentativas
   *  na URL principal (erro fatal não-recuperável), avança automaticamente
   *  para a próxima URL desta lista. */
  backupStreamUrls?: string[] | null;
}

export interface VideoPlayerHandle {
  getVideoElement: () => HTMLVideoElement | null;
  getHls: () => Hls | null;
}

// Lazy: só importa quando nativo ativa (evita custo no bundle web)
import NativeVideoPlayer from "./NativeVideoPlayer";

const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>((props, ref) => {
  // Branch nativo (APK Android com plugin LntvPlayer): ExoPlayer media3.
  // Latência ~80-150ms. Cai pra hls.js abaixo se o plugin não responder.
  const [useNative] = useState(() => isNativePlayerAvailable());
  if (useNative) {
    return <NativeVideoPlayer ref={ref} {...props} />;
  }
  return <HlsVideoPlayer ref={ref} {...props} />;
});

const HlsVideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(({ streamUrl, autoPlay = true, channelId = null, useProxyToken = false, forceProxyNative = false, backupStreamUrls = null }, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const mpegtsRef = useRef<mpegts.Player | null>(null);
  
  const [muted, setMuted] = useState(true);
  const [proxyTokenFailure, setProxyTokenFailure] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState<string>("");
  const [resolvedSourceUrl, setResolvedSourceUrl] = useState<string>("");
  const [resolvedContentType, setResolvedContentType] = useState<string>("");
  const [corsFallback, setCorsFallback] = useState(false);
  const [firstFrameReady, setFirstFrameReady] = useState(false);
  
  const [backupIndex, setBackupIndex] = useState(-1);
  const backups = backupStreamUrls?.filter((u) => !!u && u.trim().length > 0) ?? [];
  const activeStreamUrl = backupIndex < 0 ? streamUrl : (backups[backupIndex] ?? streamUrl);
  const youTubeVideoId = extractYouTubeVideoId(activeStreamUrl);

  useImperativeHandle(ref, () => ({
    getVideoElement: () => videoRef.current,
    getHls: () => hlsRef.current,
  }), []);

  // Resolve a URL de stream — pode ser async se canal usar token assinado.
  useEffect(() => {
    if (youTubeVideoId) {
      setResolvedUrl("");
      setResolvedSourceUrl("");
      return;
    }
    let cancelled = false;
    (async () => {
      let url: string;
      if (useProxyToken && channelId && !proxyTokenFailure && backupIndex < 0) {
        // Token assinado só faz sentido na URL principal (cadastrada no admin).
        // Em backup, vai direto/proxy normal.
        url = await resolveChannelStreamUrl(activeStreamUrl, channelId, true, forceProxyNative);
      } else if (corsFallback) {
        // Fallback genérico: URL HTTPS direta falhou por CORS/302/rede.
        // Tenta UMA vez via proxy antes de pular pro próximo backup.
        url = buildProxyStreamUrl(activeStreamUrl) ?? getPlayableStreamUrl(activeStreamUrl);
      } else {
        url = await resolveChannelStreamUrl(activeStreamUrl, channelId, false, forceProxyNative);
        // No APK: redirects (301/302) são resolvidos em BACKGROUND pelo
        // ChannelPrefetch — não bloqueamos o caminho crítico do zap aqui.
        // Se o ChannelPrefetch já populou redirectCache, resolveRedirects
        // devolve instantâneo do cache; senão, dispara em paralelo e o
        // hls.js usa a URL original (que segue redirect server-side via
        // hls-proxy ou via fetch nativo do WebView Android).
        if (
          Capacitor.isNativePlatform() &&
          !isProxiedStreamUrl(url) &&
          /^https:\/\//i.test(url)
        ) {
          // Best-effort: dispara mas só espera ~120ms. Se o cache já tem,
          // resolve imediato; senão, segue com a original sem travar o zap.
          const fast = await Promise.race([
            resolveRedirects(url),
            new Promise<string>((r) => setTimeout(() => r(url), 120)),
          ]);
          if (!cancelled && fast) url = fast;
        }
      }
      // Probe de content-type DEFERIDO: removido do caminho crítico.
      // Se a stream redirecionar pra MPEG-TS bruto, o hls.js vai dar
      // manifestParsingError no primeiro carregamento — aí o handler de erro
      // dispara o probe sob demanda (via setResolvedContentType abaixo).
      if (!cancelled) setResolvedContentType("");
      if (!cancelled) {
        setResolvedSourceUrl(activeStreamUrl);
        setResolvedUrl(url);
      }
    })();
    return () => { cancelled = true; };
  }, [activeStreamUrl, useProxyToken, forceProxyNative, channelId, youTubeVideoId, proxyTokenFailure, backupIndex, corsFallback]);

  const playableStreamUrl = resolvedSourceUrl === activeStreamUrl ? resolvedUrl : "";

  // Reset estado quando o canal (URL principal) muda.
  // Não zera resolvedUrl aqui: este effect roda após o effect de resolução.
  // Em URLs diretas/síncronas ele pode apagar a URL recém-resolvida e deixar
  // o canal sem src. O guard resolvedSourceUrl === activeStreamUrl já impede
  // anexar a URL do canal anterior no <video> novo.
  useEffect(() => {
    setProxyTokenFailure(false);
    setBackupIndex(-1);
    setCorsFallback(false);
    setResolvedContentType("");
    // Cobre o gap entre trocar de canal e a nova URL ser resolvida
    // (token assinado / resolveRedirects / probe de content-type são async).
    // Sem isso, o <video> vazio mostra o "play gigante" do WebView do Android.
    setFirstFrameReady(false);
  }, [streamUrl]);

  // Se mudar de backup dentro do mesmo canal, cada URL precisa recomeçar limpa.
  useEffect(() => {
    setCorsFallback(false);
    setResolvedContentType("");
  }, [backupIndex]);

  // Tenta avançar para a próxima URL de backup. Retorna true se houve avanço.
  const tryNextBackup = (): boolean => {
    const next = backupIndex + 1;
    if (next >= backups.length) return false;
    console.warn(`[HLS] Falha total — trocando para backup #${next + 1}/${backups.length}: ${backups[next]}`);
    setProxyTokenFailure(false);
    setCorsFallback(false);
    setResolvedContentType("");
    setBackupIndex(next);
    return true;
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playableStreamUrl) return;

    setFirstFrameReady(false);
    const onFirstPlaying = () => setFirstFrameReady(true);
    video.addEventListener("playing", onFirstPlaying);
    video.addEventListener("loadeddata", onFirstPlaying);

    video.pause();
    video.removeAttribute("src");
    video.load();

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (mpegtsRef.current) {
      mpegtsRef.current.destroy();
      mpegtsRef.current = null;
    }

    const handleVideoError = () => {
      if (
        !corsFallback &&
        !isProxiedStreamUrl(playableStreamUrl) &&
        !useProxyToken
      ) {
        console.warn("[Player] URL direta falhou — tentando via proxy genérico (1x)");
        setCorsFallback(true);
        return;
      }
      tryNextBackup();
    };
    video.addEventListener("error", handleVideoError);

    // On iOS/Safari, prefer native HLS for better AirPlay support
    const isAppleDevice = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent) &&
      video.canPlayType("application/vnd.apple.mpegurl");

    // Detecta engine pela extensão da URL: .m3u8 → hls.js, resto → tag <video>.
    const engine = detectEngine(playableStreamUrl, activeStreamUrl, resolvedContentType);
    console.log(`[Player] engine=${engine} url=${playableStreamUrl.slice(0, 80)}...`);

    if (engine === "hls" && !isAppleDevice && Hls.isSupported()) {
      const profile = getDeviceProfile();
      const hls = new Hls({
        enableWorker: true,
        // Buffer padrão, mas com folga do ao vivo para absorver oscilações
        lowLatencyMode: false,
        liveSyncDurationCount: 3,        // ~3 segmentos atrás do live edge (mais perto = abre mais rápido)
        liveMaxLatencyDurationCount: 10, // tolerância antes de re-sincronizar
        // === Otimizações de tempo de troca de canal (fast channel zap) ===
        // Começa pela qualidade mais baixa → 1º frame em ~500ms-1s.
        // ABR sobe pra qualidade ideal nos próximos segmentos.
        startLevel: 0,
        // Buffer dinâmico: 10s em devices fortes (zap rápido),
        // 30s em devices fracos (absorve underruns do decoder lento).
        maxBufferLength: profile.maxBufferLength,
        maxMaxBufferLength: Math.max(30, profile.maxBufferLength),
        maxBufferSize: 30 * 1000 * 1000, // 30MB
        // Pré-busca o primeiro fragmento enquanto o manifesto ainda processa
        startFragPrefetch: true,
        // Retries agressivos para fragmentos e manifestos.
        // OBS: o modo "Ocultar URL" (signed proxy) usa os MESMOS valores do modo
        // direto. Os retries baixos antigos (1x/1500ms) faziam o player desistir
        // a qualquer hiccup de rede, derrubando o canal "depois de um pouco" no PWA.
        // Reduzido de 8→3: 404 em segmento (live edge sliding / token expirado)
        // não se resolve repetindo o mesmo segmento — melhor recarregar o manifest
        // (handler abaixo) ou pular pro backup.
        fragLoadingMaxRetry: 3,
        fragLoadingRetryDelay: 500,
        fragLoadingMaxRetryTimeout: 6000,
        manifestLoadingMaxRetry: 4,
        manifestLoadingRetryDelay: 400,
        manifestLoadingTimeOut: 6000,
        manifestLoadingMaxRetryTimeout: 12000,
        levelLoadingMaxRetry: 4,
        levelLoadingRetryDelay: 400,
        levelLoadingMaxRetryTimeout: 12000,
        // ABR conservador na subida pra evitar reflickar logo após startLevel:0
        abrEwmaDefaultEstimate: 500000,
        abrBandWidthFactor: 0.85,
        abrBandWidthUpFactor: 0.6,
        // Aumenta tolerância a holes no buffer (evita stall por gap de 200ms)
        maxBufferHole: 0.5,
        nudgeMaxRetry: 5,
      });
      hlsRef.current = hls;
      hls.loadSource(playableStreamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        // Plano A+: cap de qualidade em devices fracos.
        // Procura o maior nível com altura <= maxHeight (ex: 720p).
        if (profile.maxHeight && hls.levels?.length) {
          let capIdx = -1;
          let capHeight = 0;
          hls.levels.forEach((lvl, idx) => {
            const h = lvl.height || 0;
            if (h <= profile.maxHeight! && h > capHeight) {
              capHeight = h;
              capIdx = idx;
            }
          });
          if (capIdx >= 0) {
            hls.autoLevelCapping = capIdx;
            console.log(`[HLS] Device fraco — cap em ${capHeight}p (level ${capIdx})`);
          } else {
            // Single-bitrate ou só tem qualidades acima do cap → força a menor
            const minIdx = hls.levels.reduce(
              (acc, lvl, idx) => (lvl.height < hls.levels[acc].height ? idx : acc),
              0,
            );
            hls.autoLevelCapping = minIdx;
            console.warn(`[HLS] Device fraco — sem nível <=${profile.maxHeight}p, forçando menor (${hls.levels[minIdx].height || "?"}p)`);
          }
        }
        if (autoPlay) video.play().catch(() => {});
      });

      // Recuperação automática de erros — em vez de travar, tenta continuar
      // tocando o que está no buffer (gera efeito "quadriculado" natural do H.264
      // em vez de imagem congelada).
      let mediaErrorRecoveryAttempts = 0;
      let networkErrorRetries = 0;
      let frag404ReloadAttempts = 0;
      let lastFrag404ReloadAt = 0;
      hls.on(Hls.Events.ERROR, (_event, data) => {
        // === Tratamento precoce de 404 em fragmento (NÃO-fatal) ===
        // Causa típica: live edge sliding ou token de segmento expirado entre
        // o load do manifest e o pedido do segmento. Repetir o mesmo segmento
        // não resolve — recarrega o manifest pra pegar a janela atualizada.
        if (
          !data.fatal &&
          data.details === "fragLoadError" &&
          (data.response?.code === 404 || data.response?.code === 410)
        ) {
          const now = Date.now();
          if (now - lastFrag404ReloadAt > 3000) {
            lastFrag404ReloadAt = now;
            frag404ReloadAttempts++;
            if (frag404ReloadAttempts > 2) {
              console.warn("[HLS] 404 persistente em fragmento — pulando pro backup");
              if (tryNextBackup()) return;
            } else {
              console.warn(`[HLS] 404 em fragmento (#${frag404ReloadAttempts}) — recarregando manifest`);
              try {
                hls.stopLoad();
                hls.startLoad(-1);
              } catch (e) {
                console.warn("[HLS] Falha ao recarregar manifest:", e);
              }
            }
          }
          return;
        }
        if (!data.fatal) return;
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR: {
            networkErrorRetries++;
            // Detecta falha de carregamento do manifesto numa URL HTTPS direta
            // (CORS, 302 cross-origin, ERR_FAILED). Tenta UMA vez via proxy
            // genérico antes de pular pro backup. Sem hardcode de host.
            const isManifestFail =
              data.details === "manifestLoadError" ||
              data.details === "manifestLoadTimeOut" ||
              data.details === "manifestParsingError";
            if (
              isManifestFail &&
              !corsFallback &&
              !isProxiedStreamUrl(playableStreamUrl) &&
              !useProxyToken
            ) {
              console.warn("[HLS] Manifesto direto falhou — tentando via proxy genérico (1x):", data.details);
              setCorsFallback(true);
              return;
            }
            // Após 2 retries do startLoad sem sucesso, considera URL morta
            // e parte para o próximo backup (failover ~3s).
            if (networkErrorRetries > 2) {
              if (tryNextBackup()) return;
              console.error("[HLS] Sem mais backups — desistindo:", data.details);
              hls.destroy();
              return;
            }
            console.warn(`[HLS] Erro de rede fatal (#${networkErrorRetries}) — tentando retomar:`, data.details);
            hls.startLoad();
            break;
          }
          case Hls.ErrorTypes.MEDIA_ERROR:
            mediaErrorRecoveryAttempts++;
            console.warn("[HLS] Erro de mídia fatal — recuperando:", data.details);
            if (mediaErrorRecoveryAttempts <= 3) {
              hls.recoverMediaError();
            } else {
              hls.swapAudioCodec();
              hls.recoverMediaError();
            }
            break;
          default:
            console.error("[HLS] Erro fatal não recuperável:", data);
            if (tryNextBackup()) return;
            hls.destroy();
            break;
        }
      });

      // Reset contador de recuperação quando voltar a tocar normalmente
      hls.on(Hls.Events.FRAG_LOADED, () => {
        mediaErrorRecoveryAttempts = 0;
        networkErrorRetries = 0;
        frag404ReloadAttempts = 0;
      });

      // === Plano C: auto-recovery quando travar imagem por >4s ===
      // Em devices fracos com decoder saturado, o vídeo congela mas hls.js
      // não dispara erro (segmentos continuam baixando). Detectamos via
      // evento `waiting` e, se persistir, derrubamos pro nível mínimo.
      let waitingTimer: number | null = null;
      let freezeRecoveryCount = 0;
      const onWaiting = () => {
        if (waitingTimer) return;
        waitingTimer = window.setTimeout(() => {
          waitingTimer = null;
          if (video.paused || video.ended) return;
          freezeRecoveryCount++;
          console.warn(`[HLS] Freeze detectado (>4s) — recovery #${freezeRecoveryCount}`);
          if (hls.levels?.length > 1) {
            // Força nível mínimo (qualidade mais baixa disponível)
            const minIdx = hls.levels.reduce(
              (acc, lvl, idx) => (lvl.height < hls.levels[acc].height ? idx : acc),
              0,
            );
            hls.currentLevel = minIdx;
            hls.autoLevelCapping = minIdx;
            console.warn(`[HLS] Forçado para nível ${minIdx} (${hls.levels[minIdx].height || "?"}p)`);
          }
          // Tenta retomar
          hls.startLoad();
          video.play().catch(() => {});
        }, 4000);
      };
      const onPlaying = () => {
        if (waitingTimer) {
          clearTimeout(waitingTimer);
          waitingTimer = null;
        }
      };
      video.addEventListener("waiting", onWaiting);
      video.addEventListener("playing", onPlaying);
      video.addEventListener("stalled", onWaiting);

      // Cleanup adicional desses listeners
      const origDestroy = hls.destroy.bind(hls);
      hls.destroy = () => {
        video.removeEventListener("waiting", onWaiting);
        video.removeEventListener("playing", onPlaying);
        video.removeEventListener("stalled", onWaiting);
        if (waitingTimer) clearTimeout(waitingTimer);
        origDestroy();
      };
    } else if (engine === "mpegts" && mpegts.isSupported()) {
      const tsPlayer = mpegts.createPlayer({
        type: "mpegts",
        url: playableStreamUrl,
        isLive: true,
        cors: true,
      }, {
        enableWorker: true,
        enableStashBuffer: false,
        isLive: true,
        liveBufferLatencyChasing: true,
        liveBufferLatencyMaxLatency: 3,
        liveBufferLatencyMinRemain: 1,
      });
      mpegtsRef.current = tsPlayer;
      tsPlayer.attachMediaElement(video);
      tsPlayer.load();
      tsPlayer.on(mpegts.Events.ERROR, (type, details) => {
        console.warn("[MPEGTS] Erro no stream — tentando backup:", type, details);
        tryNextBackup();
      });
      if (autoPlay) {
        const result = tsPlayer.play();
        if (result instanceof Promise) result.catch(() => {});
      }
    } else if (engine === "native" || (engine === "hls" && isAppleDevice && video.canPlayType("application/vnd.apple.mpegurl"))) {
      // Player nativo: MP4 progressivo ou HLS no Safari/iOS (AirPlay).
      video.src = playableStreamUrl;
      if (autoPlay) video.play().catch(() => {});
    }

    // === Watchdog global de playback ===
    // Em live, currentTime deve avançar continuamente. Se ficar parado por
    // >30s e o player não estiver pausado, força um reload completo do stream
    // (recria hls.js / mpegts.js / native). Cobre o caso "trava após horas
    // sem disparar erro" comum em devices fracos onde o decoder reinicializa
    // mal após GC.
    let lastTime = 0;
    let lastTimeCheckedAt = Date.now();
    const watchdog = window.setInterval(() => {
      if (!video || video.paused || video.ended) {
        lastTimeCheckedAt = Date.now();
        lastTime = video?.currentTime ?? 0;
        return;
      }
      const now = video.currentTime;
      if (Math.abs(now - lastTime) > 0.25) {
        lastTime = now;
        lastTimeCheckedAt = Date.now();
        return;
      }
      const stuckMs = Date.now() - lastTimeCheckedAt;
      if (stuckMs > 30_000) {
        console.warn(`[Watchdog] Playback travado por ${(stuckMs / 1000).toFixed(0)}s — recarregando stream`);
        lastTimeCheckedAt = Date.now();
        // Força reload: derruba engines atuais e re-dispara o effect via toggle no estado.
        if (hlsRef.current) {
          try { hlsRef.current.destroy(); } catch { /* ignore */ }
          hlsRef.current = null;
        }
        if (mpegtsRef.current) {
          try { mpegtsRef.current.destroy(); } catch { /* ignore */ }
          mpegtsRef.current = null;
        }
        // Trigger re-mount do effect mexendo no resolvedUrl (vai voltar ao mesmo valor logo depois).
        setResolvedContentType((c) => c + " ");
      }
    }, 5_000);

    return () => {
      clearInterval(watchdog);
      video.removeEventListener("error", handleVideoError);
      video.removeEventListener("playing", onFirstPlaying);
      video.removeEventListener("loadeddata", onFirstPlaying);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (mpegtsRef.current) {
        mpegtsRef.current.destroy();
        mpegtsRef.current = null;
      }
    };
  }, [playableStreamUrl, autoPlay, activeStreamUrl, proxyTokenFailure, resolvedContentType]);

  // Unmute after first user interaction
  useEffect(() => {
    const unmute = () => {
      setMuted(false);
      window.removeEventListener("click", unmute);
      window.removeEventListener("keydown", unmute);
      window.removeEventListener("touchstart", unmute);
    };
    window.addEventListener("click", unmute);
    window.addEventListener("keydown", unmute);
    window.addEventListener("touchstart", unmute);
    return () => {
      window.removeEventListener("click", unmute);
      window.removeEventListener("keydown", unmute);
      window.removeEventListener("touchstart", unmute);
    };
  }, []);

  if (youTubeVideoId) {
    return <YouTubePlayer videoId={youTubeVideoId} autoPlay={autoPlay} />;
  }

  const isLoadingNewChannel = !firstFrameReady || resolvedSourceUrl !== activeStreamUrl || !playableStreamUrl;

  return (
    <>
      <video
        key={streamUrl}
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-contain"
        style={{ backgroundColor: "#000" }}
        poster=""
        controls={false}
        controlsList="nodownload noplaybackrate noremoteplayback"
        disablePictureInPicture
        disableRemotePlayback
        playsInline
        muted={muted}
        x-webkit-airplay="allow"
        webkit-playsinline="true"
      />
      {isLoadingNewChannel && <DelayedSpinner />}
    </>
  );
});

/**
 * Spinner discreto que só aparece se a troca de canal demorar >500ms.
 * Em zaps rápidos (cache hit do prefetch) NÃO mostra nada — só a transição
 * natural do <video>, igual outros players de IPTV.
 */
const DelayedSpinner = () => {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 500);
    return () => clearTimeout(t);
  }, []);
  if (!show) return null;
  return (
    <div
      className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/40"
      aria-hidden="true"
    >
      <div className="w-10 h-10 border-2 border-white/30 border-t-white rounded-full animate-spin" />
    </div>
  );
};

VideoPlayer.displayName = "VideoPlayer";
HlsVideoPlayer.displayName = "HlsVideoPlayer";

export default VideoPlayer;
