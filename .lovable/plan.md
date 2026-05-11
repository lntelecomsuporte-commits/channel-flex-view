# Plano: zap rápido — A para web/TV, B para APK

Combinação dos dois caminhos: o APK Android passa a usar **ExoPlayer nativo** (latência ~50-150ms igual aos concorrentes), e a versão web/Smart TV recebe as **otimizações dentro de hls.js** (latência ~250-400ms, melhor que hoje mas limitado pelo WebView).

Detecção: `Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'` → tenta ExoPlayer; cai em hls.js se o plugin falhar ao carregar (segurança).

---

## Parte A — Otimizações hls.js (web, Smart TV, fallback do APK)

Aplica ao `VideoPlayer.tsx` e `ChannelPrefetch.tsx`. Nenhuma mudança de UI.

### A1. Reusar a instância de `Hls`
Hoje cada zap faz `hls.destroy() + new Hls() + attachMedia()` (~200-400ms fixos). Vou manter a instância viva e, quando o engine/modo de proxy não muda, só chamar `hls.loadSource(novaUrl)`. Destroi só quando troca engine (HLS↔MPEG-TS↔native) ou flag de proxy.

### A2. Config agressiva de baixa latência
```ts
{
  lowLatencyMode: true,
  maxBufferLength: 6,           // hoje varia 10-30
  maxMaxBufferLength: 30,
  backBufferLength: 0,
  maxBufferHole: 0.5,
  startFragPrefetch: true,
  startLevel: 0,                // já existe
  manifestLoadingTimeOut: 6000,
  fragLoadingTimeOut: 8000,
  liveSyncDurationCount: 2,     // se device forte
  nudgeMaxRetry: 5,
}
```
Em devices fracos (`getDeviceProfile().weak`) mantém `maxBufferLength: 20` e `liveSyncDurationCount: 3`.

### A3. Remover probe de content-type do caminho crítico
Hoje todo `.m3u8` faz um GET extra antes de instanciar o `Hls`. Vou pular: assume HLS direto e só roda o probe se o `Hls` emitir `MANIFEST_PARSING_ERROR`.

### A4. `resolveRedirects` não-bloqueante
Se `redirectCache` tem entrada válida, usa. Se não, instancia o `Hls` na URL original em paralelo e atualiza o cache em background (em vez de esperar o GET `Range: 0-0`).

### A5. Pre-cache real de vizinhos (corrigir CORS)
`ChannelPrefetch.tsx` já está reescrito (manifest + 1º segmento com CORS), mas o `hls-proxy` precisa devolver `Access-Control-Allow-Origin: *` consistentemente para que o cache seja reaproveitado. Vou conferir/ajustar a edge function.

### A6. Não voltar pra preto entre zaps
Trocar o overlay preto (`firstFrameReady`) por: manter o último frame congelado do canal anterior (CSS `opacity` no `<video>` antigo) e mostrar spinner discreto só após 600ms se o novo ainda não tocou.

**Ganho estimado web/TV:** ~950ms → ~250-400ms por zap (vizinho prefetched).

---

## Parte B — ExoPlayer nativo no APK Android

Plugin Capacitor próprio que renderiza vídeo via ExoPlayer numa `SurfaceView` por cima do WebView. O React continua dono da UI (OSD, lista, EPG); só o `<video>` vira uma "janela" controlada pelo plugin.

### B1. Plugin nativo `LntvPlayer`
`android/app/src/main/java/tv/lntelecom/net/LntvPlayerPlugin.java`:
- Métodos JS: `load({url, headers})`, `play()`, `pause()`, `setVolume(v)`, `setMuted(b)`, `release()`, `setRect({x,y,w,h})`, `prepareNext({url})`, `swapToNext()`.
- Eventos: `playing`, `waiting`, `ended`, `error`, `firstFrame`, `levelSwitched`.
- Usa `ExoPlayer` (media3) com `HlsMediaSource.Factory` + `DefaultHttpDataSource.Factory` (custom UA, headers).
- `LoadControl` igual ao OleTV: `bufferForPlaybackMs=0`, `bufferForPlaybackAfterRebufferMs=0`, `minBufferMs=4000`, `maxBufferMs=60000`.
- **Trio de instâncias** (`prev`, `current`, `next`): `prepare()` nas três, `setPlayWhenReady(true)` só na atual; `swapToNext()` é instantâneo (~50ms).
- Surface: `SurfaceView` adicionada à `decorView`, posicionada por `setRect` que o React calcula a partir do bounding box do `<video>` placeholder (z-index acima do WebView mas abaixo do OSD).

### B2. Wrapper TS
`src/lib/native/lntvPlayer.ts`: `registerPlugin<LntvPlayerPlugin>('LntvPlayer')` + tipos.

### B3. Integração no `VideoPlayer.tsx`
- Detecta `Capacitor.getPlatform() === 'android'` no mount.
- Se nativo: render `<div ref=videoRef />` placeholder (mesma posição/tamanho que o `<video>`), usa `ResizeObserver` pra `setRect` no plugin a cada layout.
- Mapeia eventos do plugin nos mesmos handlers que hoje escutam no `<video>` (playing → `setFirstFrameReady`, error → fallback de URL etc.).
- Se `LntvPlayer` não registrado (caiu na atualização, build velha): `Capacitor.isPluginAvailable('LntvPlayer')` falso → cai pra hls.js (Parte A).

### B4. Pre-cache no APK
Como ExoPlayer baixa direto, `ChannelPrefetch` no APK chama `LntvPlayer.prepareNext({url})` em vez de `fetch`. O ExoPlayer carrega manifest + 1-2 segmentos no slot `next`, e `swapToNext()` é trivial.

### B5. Build
- `android/app/build.gradle`: adicionar `implementation "androidx.media3:media3-exoplayer:1.4.1"`, `media3-exoplayer-hls:1.4.1`, `media3-ui:1.4.1`.
- `MainActivity.java`: `registerPlugin(LntvPlayerPlugin.class)`.
- `npm run build && npx cap sync android` + APK signed pelo workflow existente (keystore release, ver `mem://security/android-keystore`).

**Ganho estimado APK:** ~950ms → ~80-150ms (paridade com OleTV).

---

## Arquivos tocados

**Parte A (JS, deploy via `npm run build` + rsync):**
- `src/components/player/VideoPlayer.tsx` — reuso de Hls, config low-latency, sem probe, redirect não-bloqueante, sem overlay preto.
- `src/components/player/ChannelPrefetch.tsx` — pequeno ajuste pra chamar `LntvPlayer.prepareNext` quando nativo.
- `src/lib/stream.ts` — variante não-bloqueante de `resolveRedirects`.
- `supabase/functions/hls-proxy/index.ts` — garantir CORS `*` em todas as respostas (manifest + segmentos).

**Parte B (nativo Android, requer rebuild de APK):**
- `android/app/src/main/java/tv/lntelecom/net/LntvPlayerPlugin.java` (novo).
- `android/app/src/main/java/tv/lntelecom/net/MainActivity.java` — `registerPlugin`.
- `android/app/build.gradle` — deps media3.
- `src/lib/native/lntvPlayer.ts` (novo) — wrapper Capacitor.
- `src/components/player/VideoPlayer.tsx` — branch nativo vs. hls.js.

## Não vou mexer

Lista de canais, OSD, EPG, favoritos, PIN, login Hubsoft, sync de logos, edge functions de auth/webhooks, layout/branding.

## Riscos

- **ExoPlayer + SurfaceView sob WebView**: posicionamento exige `ResizeObserver` confiável; em fullscreen é trivial (100vw/100vh).
- **Plugin novo no APK**: usuários precisam atualizar o APK para ter o ganho — antes da atualização, cai pra hls.js (Parte A).
- **media3 aumenta tamanho do APK** em ~3-5MB (aceitável).
- **CORS no hls-proxy**: se algum upstream rejeitar, fallback `no-cors` (atual) continua funcionando, só sem cache reaproveitado.

## Validação

- Web (preview): trocar canal várias vezes, medir tempo até 1º frame no console (já existe log).
- APK: `adb logcat | grep LntvPlayer` mostra latência de cada `load → firstFrame`.
- Comparar zap antes/depois com cronômetro no controle remoto da TV.

Posso começar pela Parte A (rápida, atinge web/TV imediato) e depois Parte B (precisa rebuild de APK), ou ambos em paralelo. Confirma que sigo nesse plano?
