
# Estatísticas no Android nativo (somente ExoPlayer)

No modo nativo (Android + `NativeAndroidPlayer`), o overlay vai mostrar **exclusivamente** dados vindos do ExoPlayer/Media3 via novo método `getStats()` no plugin. Tudo o que não vem do ExoPlayer (DNS/IP, host, device profile, reconexões em JS, último erro JS, estado JS) fica fora.

## Campos no modo `native`

Todos vindos do `ExoPlayer.getStats()`:

- **Resolução** — `player.getVideoFormat().width × height`
- **FPS** — `Format.frameRate`
- **Bitrate** — `Format.bitrate`
- **Codec** — `Format.codecs` / `sampleMimeType`
- **Banda estimada** — `DefaultBandwidthMeter.getBitrateEstimate()`
- **Total transferido** — bytes acumulados via `TransferListener.onBytesTransferred` (consumo de internet do canal atual)
- **Buffer** — `player.getTotalBufferedDuration()` em ms
- **Frames perdidos / total** — acumulados via `AnalyticsListener.onDroppedVideoFrames` + `onRenderedFirstFrame`/`VideoSize`

> Sem packet loss real (ExoPlayer não expõe). Frames perdidos é o proxy mais próximo.

## Modo `html5` (Web/iOS)
Sem mudanças. Continua como está.

## Implementação

### `android/app/src/main/java/tv/lntelecom/net/NativePlayerPlugin.java`
1. Criar `DefaultBandwidthMeter` compartilhado; passar para `HlsMediaSource.Factory` / `ProgressiveMediaSource.Factory` via `DataSource.Factory` configurada com `setTransferListener(bandwidthMeter)`.
2. Adicionar um `TransferListener` próprio que soma bytes (`onBytesTransferred`) em `totalBytesTransferred`.
3. Adicionar `AnalyticsListener` ao player com `onDroppedVideoFrames(count, elapsedMs)` → acumula `droppedFrames`.
4. Novo `@PluginMethod getStats(PluginCall call)`:
   ```json
   { "width": 1920, "height": 1080, "frameRate": 30,
     "bitrate": 4500000, "codec": "avc1.64001f", "mimeType": "video/avc",
     "bandwidthEstimateBps": 6200000, "totalBytesTransferred": 12456789,
     "bufferedMs": 8200, "droppedFrames": 3 }
   ```
   Lê em `runOnUiThread`.

### `src/plugins/native-player.ts`
Adicionar tipo `NativePlayerStats` e método `getStats(): Promise<NativePlayerStats>`.

### `src/components/player/StatsOverlay.tsx`
- Aceitar prop `mode: "native" | "html5"`.
- No modo `native`: ignorar `videoEl`/`hls`, fazer `setInterval(1000)` chamando `NativePlayer.getStats()`, renderizar somente os campos listados acima.
- No modo `html5`: comportamento atual sem mudanças.
- Adicionar `formatBytes` helper para "Total transferido".

### `src/pages/PlayerPage.tsx`
Passar `mode={isNativeAndroid ? "native" : "html5"}` ao `StatsOverlay` (mesma condição que decide usar `NativeAndroidPlayer`).

## Fora de escopo
- Packet loss real.
- IP destino, host, device profile, estado, último erro, reconexões no modo native.
- Mudanças no overlay HTML5.

## Comandos pro servidor
Mudança Java exige rebuild do APK no GitHub Actions (workflow **Build Android APK**).
Frontend:
```
cd /opt/lntv-frontend && git pull && npm run build && rsync -a --delete --exclude logos dist/ /var/www/lntv/
```
