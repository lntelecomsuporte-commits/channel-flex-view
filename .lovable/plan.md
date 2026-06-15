# Troca de Legenda e Áudio em Todas as Plataformas

## Objetivo
Permitir que o usuário troque a faixa de legenda e a faixa de áudio do canal em execução, quando o stream oferece múltiplas opções. A escolha persiste apenas durante a sessão (ao fechar e reabrir o app, volta ao padrão).

## Controles
- **Legendas (CC):** tecla `CC` / `Closed Caption` ou tecla **azul** do controle remoto.
  - Ciclo: `Desligado → Faixa 1 → Faixa 2 → ... → Desligado`.
- **Áudio:** tecla `SAP` / `Audio` / `MTS` ou tecla **amarela** do controle remoto.
  - Ciclo entre as faixas de áudio disponíveis.

Cada troca mostra um OSD curto (ex.: "Legenda: Português" / "Áudio: Inglês (5.1)") por ~2s.

## Plataformas e arquivos

### 1. Web / PWA — HLS.js (`src/components/player/VideoPlayer.tsx`)
- Adicionar handlers para teclas: `c`, `C`, `Subtitle`, `ColorF0Blue` (azul), `MediaAudioTrack`, `ColorF1Yellow` (amarelo), além de keycodes 403 (vermelho), 404 (verde), 405 (amarelo), 406 (azul) usados em TVs.
- Usar `hls.subtitleTracks` + `hls.subtitleTrack` para legendas; `hls.audioTracks` + `hls.audioTrack` para áudio. Fallback para `<video>.textTracks` e `audioTracks` quando não-HLS.
- Pequeno componente OSD reaproveitando estilo existente.
- Resetar seleção ao trocar de canal (sessão = vida do app já que é SPA; recarga do app = padrão).

### 2. Plugin Android nativo do app Capacitor (`android/app/src/main/java/tv/lntelecom/net/NativePlayerPlugin.java`)
- Adicionar métodos `cycleSubtitle()` e `cycleAudio()` usando `ExoPlayer.trackSelectionParameters` (TrackSelectionOverride por TrackGroup).
- Expor via plugin call para o JS.
- `src/plugins/native-player.ts`: adicionar `cycleSubtitle()` / `cycleAudio()` retornando rótulo da faixa atual.
- `NativeAndroidPlayer.tsx`: capturar teclas globais e chamar plugin.

### 3. Activities legadas (`MainActivity.java`, `LegacyMainActivity.java`)
- Em `dispatchKeyEvent`/`onKeyDown`, interceptar `KEYCODE_CAPTIONS` (saiba), `KEYCODE_PROG_BLUE`, `KEYCODE_PROG_YELLOW`, `KEYCODE_TV_AUDIO_DESCRIPTION` e enviar via JS bridge `window.dispatchEvent(new KeyboardEvent(...))` para que o `VideoPlayer` web reaja.

### 4. App Android nativo (`android-native/.../PlayerActivity.kt`)
- ExoPlayer já em uso. Adicionar:
  - `cycleSubtitle()` e `cycleAudio()` usando `player.trackSelectionParameters` + `TrackSelectionOverride`.
  - Em `onKeyDown`: `KEYCODE_CAPTIONS`, `KEYCODE_PROG_BLUE`, `KEYCODE_PROG_YELLOW`, `KEYCODE_TV_AUDIO_DESCRIPTION`, `KEYCODE_MEDIA_AUDIO_TRACK`.
  - OSD usando o padrão de Toast/overlay já presente.
- Resetar a cada troca de canal; ao fechar app, padrão.

### 5. Roku (`roku/components/PlayerScene.brs` + `PlayerScene.xml`)
- Roku Video node expõe `availableSubtitleTracks`, `subtitleTrack`, `availableAudioTracks`, `currentAudioTrack`.
- Em `onKeyEvent`:
  - Azul (`"blue"`) ou Captions → ciclar `subtitleTrack` entre `""` (off) e índices disponíveis.
  - Amarelo (`"yellow"`) → ciclar `currentAudioTrack` entre faixas disponíveis.
- Mostrar OSD usando label existente.
- Resetar ao trocar de canal.

## Persistência
Apenas em memória (variável de instância no componente/Activity/Scene). Nada gravado em disco — ao fechar o app, volta ao padrão automaticamente.

## Detalhes técnicos
- HLS.js: ouvir `Hls.Events.SUBTITLE_TRACKS_UPDATED` / `AUDIO_TRACKS_UPDATED` para popular lista.
- ExoPlayer (ambos Android): usar `Player.getCurrentTracks()` para enumerar `TrackGroup` de tipo `C.TRACK_TYPE_TEXT` e `C.TRACK_TYPE_AUDIO`. Aplicar via `trackSelectionParameters.buildUpon().setOverrideForType(...)`. Para desligar legenda: `setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)`.
- Roku: KeyCodes específicos não existem para CC/SAP — usamos azul/amarelo como padrão (mesma convenção do app oficial Roku).

## Keycodes Android
| Função | Keycodes |
|---|---|
| Legenda | `KEYCODE_CAPTIONS` (175), `KEYCODE_PROG_BLUE` (186) |
| Áudio | `KEYCODE_TV_AUDIO_DESCRIPTION` (252), `KEYCODE_MEDIA_AUDIO_TRACK` (222), `KEYCODE_PROG_YELLOW` (185) |

## Entrega
Frontend (web) → build + rsync no servidor.  
Android nativo + legacy → GitHub Actions (APK).  
Roku → GitHub Actions (channel).

Comandos pro servidor serão fornecidos ao final.
