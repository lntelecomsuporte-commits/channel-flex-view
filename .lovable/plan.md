# Plano: remover ExoPlayer + aplicar otimizações no hls.js

## 1. Remover ExoPlayer / plugin nativo (volta ao estado pré-ExoPlayer)

**Arquivos a deletar:**
- `android/app/src/main/java/tv/lntelecom/net/LntvPlayerPlugin.java`
- `src/components/player/NativeVideoPlayer.tsx`
- `src/lib/native/lntvPlayer.ts`

**Arquivos a reverter:**
- `android/app/build.gradle` — remover dependências `androidx.media3:*` (exoplayer, exoplayer-hls, ui).
- `android/app/src/main/java/tv/lntelecom/net/MainActivity.java` — remover `registerPlugin(LntvPlayerPlugin.class)` e o `SurfaceView` de composição que foi adicionado pra desbloquear o vídeo no FireTV. Volta ao estado original (só `PlaybackKeepAlivePlugin`, `KEEP_SCREEN_ON`, fundo preto, intercept de KEYCODE_MENU).
- `android/app/src/main/res/values/styles.xml` — remover overrides `android:windowBackground/colorBackground` adicionados na tentativa de fix.
- `src/index.css` — remover regras `.player-mode` com `background: transparent !important` (eram só pra TextureView aparecer).
- `src/pages/PlayerPage.tsx` — remover qualquer add/remove da classe `player-mode` ligada ao native renderer.
- `src/components/player/VideoPlayer.tsx` — remover branch `useNative` / `<NativeVideoPlayer>` e o import do wrapper.
- `src/components/player/ChannelPrefetch.tsx` — remover ramo `shouldUseNativePlayer()` que chama `LntvPlayer.prepareNext`.

Resultado: APK volta a ser exatamente o WebView com `<video>`+hls.js, igual antes da empreitada do ExoPlayer.

## 2. Aplicar otimizações que faltavam no hls.js

### 2a. Reusar instância de `Hls` entre zaps  *(ganho ~200-400ms)*

Refatorar `HlsVideoPlayer` em `src/components/player/VideoPlayer.tsx`:

- Quebrar o `useEffect` grande em dois:
  - **Setup once** (mount): cria `Hls` com a config low-latency atual, `attachMedia(video)`, registra todos os listeners (erro, freeze, watchdog, FRAG_LOADED).
  - **On URL change**: só `hls.stopLoad()` + `hls.loadSource(novaUrl)` + reset de contadores (`networkErrorRetries`, `frag404ReloadAttempts`, `mediaErrorRecoveryAttempts`).
- Destruir só quando: engine muda (HLS↔MPEG-TS↔native), unmount, ou troca de modo de proxy/token.
- MPEG-TS continua destruindo (lib não suporta hot-swap).

### 2b. Stack de 2 `<video>` invisíveis com swap  *(zap ~50-100ms em vizinho prefetched)*

```text
<div class="player-stack">
  <video ref=videoA />   ← visível, tocando canal atual
  <video ref=videoB />   ← oculto (opacity 0), com hls preparado no próximo
</div>
```

- Duas instâncias `Hls` paralelas (`hlsA`, `hlsB`), cada uma anexada ao seu `<video>`.
- `ChannelPrefetch` já recebe `nextStreamUrl` — vou usar pra carregar no slot inativo (`loadSource` + `startLoad(0)`, sem `play()` pra decoder não rodar).
- Quando o usuário troca e a URL nova == `nextStreamUrl` prefetchada: **swap de slot** (toggle de classe + `play()` no novo + `pause()` no antigo). Latência ~ 1 frame.
- URL nova ≠ prefetchada (busca, salto, favoritos): slot ativo recebe `loadSource` normal. Como A1 já está aplicado, sem destruir.
- Em devices fracos (`getDeviceProfile().weak`): manter stack mas parar o `Hls` oculto após 2 segmentos baixados (não decodifica vídeo, só aquece buffer/cache).

### 2c. Eliminar tela preta entre zaps

- Remover `key={streamUrl}` do `<video>` (linha 541) — força remount visual desnecessário.
- Manter o `<video>` antigo no DOM com último frame congelado até o novo emitir `playing`. Com a stack do 2b isso fica natural: o swap só promove o slot novo depois do `playing`.
- Spinner discreto continua só após 500ms (já existe).

## 3. Confirmação rápida

CORS no `hls-proxy` já está OK (`Access-Control-Allow-Origin: *` em todas as respostas). Prefetch é cacheável. Nada a fazer.

---

## Arquivos tocados (resumo)

**Deletar (3):**
- `android/app/src/main/java/tv/lntelecom/net/LntvPlayerPlugin.java`
- `src/components/player/NativeVideoPlayer.tsx`
- `src/lib/native/lntvPlayer.ts`

**Reverter (5):**
- `android/app/build.gradle`
- `android/app/src/main/java/tv/lntelecom/net/MainActivity.java`
- `android/app/src/main/res/values/styles.xml`
- `src/index.css`
- `src/pages/PlayerPage.tsx`

**Editar (2):**
- `src/components/player/VideoPlayer.tsx` — refatorar HlsVideoPlayer (setup once + loadSource on change), adicionar stack de 2 `<video>` com swap, remover `key={streamUrl}`, remover branch nativo.
- `src/components/player/ChannelPrefetch.tsx` — remover ramo nativo, comunicar `nextStreamUrl` ao `VideoPlayer` (via prop / context simples) pra carregar no slot oculto. Mantém o fetch de manifest+segmento como fallback pra MP4 e DNS warm.

## Não vou mexer

Lista de canais, OSD, EPG, favoritos, PIN, login Hubsoft, sync de logos, edge functions, branding, layout, MPEG-TS, YouTube, foreground service de keep-alive.

## Validação

- Web preview: trocar canal várias vezes; log `[Player] engine=hls` deve aparecer só 2x (mount), não a cada zap.
- Cronômetro no controle: zap em vizinho < 150ms (hoje ~600-900ms).
- APK rebuild: instalar e confirmar que voltou ao comportamento antes do ExoPlayer (sem tela preta/branca, vídeo dentro do WebView).

## Riscos

- 2 `<video>` simultâneos consomem ~1 segmento extra de banda (vizinho). O `ChannelPrefetch` já gastava isso.
- Em smart TVs muito velhas (Tizen 2017) pode haver limite de instâncias de `Hls` simultâneas — mitigado mantendo o slot oculto sem `play()`.

Confirma que sigo?
