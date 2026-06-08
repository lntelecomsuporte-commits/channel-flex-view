Ajustes no APK nativo (`android-native/`) — todos em Kotlin/XML, sem mexer no legacy/Roku/PWA.

## 1. Zap pulando canais (UP repetido)
Causa provável: `KeyEvent` com `repeat > 0` quando a tecla fica pressionada e múltiplos `changeChannel(±1)` são processados antes do player estabilizar.

Correção em `PlayerActivity.onKeyDown`:
- Ignorar eventos com `event.repeatCount > 0` para `DPAD_UP/DOWN/CH_UP/CH_DOWN`.
- Adicionar throttle mínimo de 250ms entre `changeChannel` (timestamp da última troca; se delta < 250ms, ignora).

## 2. Player travado após canal off / queda (nenhum canal abre)
Causa: depois de esgotar `maxRetries`, o `ExoPlayer` fica em estado de erro permanente e novos `setMediaItem` não recuperam.

Correção em `loadCurrent()`:
- Antes de `setMediaItem`, se `player.playerError != null` ou se `retries >= maxRetries` da carga anterior, chamar `player.stop()` + `player.clearMediaItems()` antes de carregar o novo.
- Em `attemptRetry`, ao atingir `maxRetries`, registrar flag `playerNeedsReset = true`; `loadCurrent` checa e faz reset.

## 3. Stats overlay consome 1/2 da tela
Causa: `LinearLayout` com `wrap_content` + padding/minWidth — fundo escuro acompanha o widget mas a largura efetiva fica grande.

Correção em `activity_player.xml` + `PlayerActivity.showStats`:
- Trocar `android:layout_width="wrap_content"` por largura fixa calculada em runtime = 1/3 da largura da tela (via `resources.displayMetrics.widthPixels / 3`).
- Manter altura `wrap_content`, posição top|end, margem 16dp.

## 4. APK não fecha ao desligar receptor (standby)
Causa: `PlayerActivity` não tem listener de `ACTION_SCREEN_OFF` (o legacy `MainActivity.java` tem, mas o nativo não).

Correção em `PlayerActivity`:
- Registrar `BroadcastReceiver` dinâmico para `Intent.ACTION_SCREEN_OFF` em `onCreate`, desregistrar em `onDestroy`.
- Ao receber: parar heartbeat, `player.release()`, `finishAffinity()`, `System.exit(0)` (mesmo padrão do legacy).

## 5. Canal não abre, troca e volta abre
Mesma raiz do item 2 — player não reseta sozinho após erro/stall. O fix do item 2 resolve este também.

Adicional: em `checkStall()`, se já estamos em retry e ainda buffering, fazer `player.stop()` + `prepare()` ao invés de só `setMediaItem`.

## 6. ABR começar/migrar para resolução mais alta
Atualmente `ExoPlayer.Builder(this).build()` usa `DefaultTrackSelector` com parâmetros padrão (escolhe baseado em bandwidth medida — começa baixa).

Correção em `initPlayer()`:
- Construir `DefaultTrackSelector` com `setParameters(buildUponParameters().setMaxVideoSizeSd().clearVideoSizeConstraints().setForceHighestSupportedBitrate(false))` — na verdade queremos `setMinVideoSize(1280, 720)` quando disponível e remover cap superior.
- Setar `setInitialBitrateEstimate(4_000_000)` no `DefaultBandwidthMeter` para o ABR não começar achando que a banda é baixa.
- Usar `ExoPlayer.Builder(this).setTrackSelector(trackSelector).setBandwidthMeter(bandwidthMeter).build()`.

## 7. Streams Amagi param após ~5min e travam o app
Causa típica: live HLS com janela deslizante; quando a posição fica fora da janela (atrás demais), o player dá "BehindLiveWindowException" e não recupera; também pode ser token de proxy expirando.

Correção:
- No `Player.Listener.onPlayerError`, detectar `error.errorCode == ERROR_CODE_BEHIND_LIVE_WINDOW` e fazer `player.seekToDefaultPosition()` + `player.prepare()` (sem contar como retry).
- Configurar `LoadControl` com buffers maiores (min 15s, max 60s) e `DefaultLivePlaybackSpeedControl` com `setFallbackMinPlaybackSpeed(0.97f)` e `setFallbackMaxPlaybackSpeed(1.03f)` para o player ajustar velocidade e ficar dentro da janela live.
- Em `MediaItem.Builder()` para HLS live, setar `setLiveConfiguration(MediaItem.LiveConfiguration.Builder().setTargetOffsetMs(8000).build())`.
- Stall-check: se ficar buffering > 8s em live, reset completo (`stop`+`prepare`) em vez de `attemptRetry` exponencial.

## Arquivos a editar

```text
android-native/app/src/main/java/tv/lntelecom/nativo/ui/player/PlayerActivity.kt
android-native/app/src/main/res/layout/activity_player.xml
```

Nenhuma migration de banco. Apenas novo build do APK nativo (workflow `.github/workflows/android-nativo.yml` já existente).

## Validação
Após o build:
- Item 1: segurar tecla UP — deve avançar de 1 em 1 com pausa.
- Item 2/5: forçar erro (canal off conhecido) e trocar — deve voltar a tocar.
- Item 3: ativar Konami — moldura ocupa ~1/3 da largura.
- Item 4: desligar receptor — app deve fechar (verificar pelo `adb shell ps | grep lntelecom` se houver acesso).
- Item 6: abrir canal com múltiplas qualidades — Konami deve mostrar resolução ≥ 720p após poucos segundos.
- Item 7: deixar canal Amagi tocando > 10 min — não deve travar.
