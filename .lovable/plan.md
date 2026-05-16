# Plano: Player Nativo ExoPlayer no APK Android

## Objetivo
Eliminar o ícone/flash do WebView entre zaps e padronizar a reprodução entre Fire TV, Android TV e Mobile usando **ExoPlayer (Media3)** nativo embutido no APK via plugin Capacitor customizado.

## Arquitetura

```text
┌─────────────────────────────────────────┐
│  React (VideoPlayer.tsx)                │
│  - Detecta isAndroidNative              │
│  - Se Android → usa NativePlayer plugin │
│  - Se Web/iOS → usa Video.js atual      │
└────────────────┬────────────────────────┘
                 │ Capacitor Bridge
┌────────────────▼────────────────────────┐
│  Plugin: NativePlayer (Kotlin)          │
│  - load(url, headers, type)             │
│  - play() / pause() / stop()            │
│  - destroy()                            │
│  - eventos: playing, error, ended       │
└────────────────┬────────────────────────┘
                 │
┌────────────────▼────────────────────────┐
│  ExoPlayer/Media3 (SurfaceView)         │
│  - HLS via HlsMediaSource               │
│  - MP4 via ProgressiveMediaSource       │
│  - SurfaceView posicionado atrás do     │
│    WebView (WebView transparente)       │
└─────────────────────────────────────────┘
```

## Etapas

### 1. Plugin Capacitor `NativePlayer`
Criar em `android/app/src/main/java/app/lntv/nativeplayer/`:
- `NativePlayerPlugin.kt` — métodos `load`, `play`, `pause`, `stop`, `setBounds`
- `PlayerView` (SurfaceView) montado no `decorView` da Activity, abaixo do WebView
- ExoPlayer com `DefaultHlsMediaSource.Factory` + `DefaultHttpDataSource.Factory` (suporta headers `Referer`/`User-Agent`)
- Emite eventos: `playing`, `buffering`, `error`, `ended`

### 2. Configuração Android
- `app/build.gradle`: adicionar `androidx.media3:media3-exoplayer`, `media3-exoplayer-hls`, `media3-ui` (v1.4.x)
- `MainActivity.kt`: registrar plugin e tornar WebView **transparente** (`setBackgroundColor(Color.TRANSPARENT)`) para SurfaceView aparecer por baixo
- `styles.xml`: `windowBackground` preto (já está)

### 3. Bridge TypeScript
Criar `src/plugins/native-player.ts`:
```ts
export interface NativePlayerPlugin {
  load(opts: { url: string; headers?: Record<string,string>; type: 'hls'|'mp4' }): Promise<void>;
  play(): Promise<void>;
  stop(): Promise<void>;
  addListener(event: 'playing'|'error'|'ended', cb: (data:any)=>void): Promise<PluginListenerHandle>;
}
```

### 4. Integração no `VideoPlayer.tsx`
- Detectar `Capacitor.getPlatform() === 'android'`
- Se nativo: ocultar `<video>` do Video.js, chamar `NativePlayer.load(streamUrl, {Referer, 'User-Agent'}, type)`
- Manter UI (controles, EPG, OSD) sobre o SurfaceView via WebView transparente
- Eventos `playing` → `setFirstFrameReady(true)`; `error` → fallback ou retry
- Cleanup em unmount: `stop()`

### 5. Build APK
- `npx cap sync android`
- GitHub Actions roda build automático com keystore release (já configurado, mem://security/android-keystore)

## Detalhes técnicos
- **Headers**: ExoPlayer aceita Referer/UA via `DefaultHttpDataSource.Factory().setDefaultRequestProperties(headers)`
- **Posicionamento**: SurfaceView preenche tela toda (`MATCH_PARENT`), `setZOrderMediaOverlay(false)` para ficar atrás
- **WebView transparente**: necessário no `MainActivity.onCreate` após `super.onCreate`
- **Zap rápido**: ExoPlayer libera Surface ao trocar `MediaSource`, sem flash do WebView
- **Compatibilidade**: Media3 requer minSdk 21 (já atende)

## Riscos / Notas
- Aumenta tamanho do APK em ~3-4 MB (Media3)
- Controles do Video.js (HTML overlay) continuam funcionando pois WebView fica por cima transparente
- Airplay/Chromecast: não cobertos nesta fase (separado)
- iOS: não afetado (continua Video.js)

## Comandos pro servidor (após build)
```bash
cd /opt/lntv-frontend && git pull
npm install
npx cap sync android
# GitHub Actions gera APK assinado automaticamente
```

Posso prosseguir com a implementação?