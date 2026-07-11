Zap adaptativo aplicado em `android-native/.../PlayerActivity.kt` (build > 50).

## O que ficou

- `changeChannel(delta, eventTimeMs)` — sempre atualiza `index` + OSD na hora.
- Rajada: se `event.eventTime` cair a <250ms do toque anterior, cancela `zapPending` e agenda `loadCurrent()` pra 350ms depois. Absorve backlog e só sintoniza o canal final.
- Toque isolado (>250ms): `loadCurrent()` imediato — sem delay perceptível.
- `onKeyDown` continua ignorando `repeatCount > 0` (nada de auto-repeat).
- `cancelPending()` limpa `tunePending` + `zapPending` (evita tune fantasma após entrada numérica ou preview LEFT/RIGHT).
- Removidos os antigos `lastChannelChangeMs` / `channelChangeDedupMs` (dedup de 40ms medido na main thread — inútil pra auto-repeat).

## Constantes ajustáveis

- `zapBurstWindowMs = 250L`
- `zapCommitDelayMs = 350L`

Se ainda parecer travado numa passada rápida, baixar o commit delay pra ~250L. Se ainda pular canais, subir a janela de rajada pra ~350L.
