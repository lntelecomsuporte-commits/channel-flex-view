Nenhuma alteração de código nesta rodada — o usuário só queria entender o comportamento.

## Diagnóstico do "pula 10-15 canais" no app nativo Android

Arquivo: `android-native/app/src/main/java/tv/lntelecom/nativo/ui/player/PlayerActivity.kt`

### Fluxo atual de UP/DOWN (e CH_UP/CH_DOWN)

1. `onKeyDown` mapeia `KEYCODE_DPAD_UP | KEYCODE_CHANNEL_UP` → `changeChannel(+1)` (linha 760).
2. `changeChannel(delta)` (linha 577):
   - Dedup de **40 ms** via `System.currentTimeMillis()` (só filtra duplicata de driver IR).
   - `cancelPending()` (zera preview de LEFT/RIGHT).
   - `index = (index + delta) mod N` — **incrementa imediatamente**.
   - Chama `loadCurrent()` na hora.
3. `loadCurrent()` (linha 358), tudo na main thread:
   - cancela retries pendentes,
   - se `retries>0` / erro / flag: `player.stop()` + `clearMediaItems()`,
   - resolve URL (string, sem rede),
   - `setMediaItem` + `prepare` + `playWhenReady=true`,
   - `showOsd(index)` — Coil carrega logo,
   - `heartbeat.updateChannel(...)`.
4. Não checa `event.repeatCount` — auto-repeat do Android (~50 ms segurando) passa direto.

### Por que salta vários canais quando o usuário para

Duas causas somadas:

- **Backlog de KeyEvents na main thread.** `setMediaItem+prepare` + inflar OSD/logo bloqueiam a UI por dezenas/centenas de ms. Enquanto isso, o Android continua enfileirando eventos de auto-repeat. Ao liberar, a fila é drenada em rajada e `index` avança várias vezes antes do OSD refletir. O usuário solta achando estar em 202, mas a fila ainda tem N eventos que serão processados → cai em 230.
- **Auto-repeat residual pós-release.** Alguns controles/receivers (Fire TV, caixinhas Android) mandam 1-2 `DOWN` extras depois do `ACTION_UP`.

O dedup de 40 ms não protege: é menor que o intervalo do auto-repeat (~50 ms) e é medido pelo tempo de processamento, não por `event.eventTime`. Eventos enfileirados quase todos passam.

### Por que LEFT/RIGHT não sofre

`previewChannel()` (linha 593) só atualiza o índice de preview + OSD e agenda `commitPending()` em **1500 ms**. Enquanto o usuário anda, nenhum `setMediaItem`/`prepare`. Só o canal final é sintonizado. Main thread livre → sem backlog.

### Melhorias possíveis (não aplicadas agora)

1. Ignorar `event.repeatCount > 0` em UP/DOWN — 1 toque = 1 canal.
2. Dedup maior (~150-200 ms) medido por `event.getEventTime()` em vez de `System.currentTimeMillis()`.
3. Aplicar padrão do preview no UP/DOWN: OSD imediato, `loadCurrent()` só depois de ~600 ms de silêncio (debounce). Elimina o backlog.
4. Mover custo pesado do `loadCurrent` pra fora da main (Coil já é async; `prepare` precisa da main — daí (3) ser o mais efetivo).

## Próximo passo

Quando o usuário quiser atacar o problema, escolher entre (a) debounce estilo LEFT/RIGHT, (b) ignorar auto-repeat + dedup mais forte, ou (c) as duas coisas juntas.
