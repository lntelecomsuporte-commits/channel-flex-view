
## Problema

Na build 50, UP/DOWN ignora auto-repeat (bom) mas ainda sintoniza cada canal imediatamente — logo `loadCurrent()` bloqueia a main thread por dezenas/centenas de ms e o próximo toque só responde depois. Se aplicarmos o `zapDelay = 500L` reto (opção "debounce puro"), **todo** zap fica com 500ms de espera perceptível — pior ainda pra troca casual.

O ideal é o comportamento de TV clássica: **toque solto sintoniza na hora; rajada só sintoniza o final**.

## Solução: zap adaptativo (janela curta)

Em `PlayerActivity.kt`, mudar `changeChannel(delta)`:

1. **Sempre atualiza o índice + OSD imediatamente** (feedback visual instantâneo — igual LEFT/RIGHT).
2. Guarda `lastZapMs = event.eventTime` (tempo do KeyEvent, não do processamento).
3. Se o toque atual está **dentro de ~250ms** do anterior → considera "rajada": cancela qualquer `loadCurrent` pendente e agenda um novo pra **~350ms depois do último toque** (usando o handler já existente do preview, ou um novo `Runnable zapPending`).
4. Se está **fora dos 250ms** (toque isolado) → chama `loadCurrent()` **imediatamente**. Zap único responde na hora.
5. Ao chegar em `loadCurrent` do debounce, também limpa o pending.

### Parâmetros propostos

- `zapBurstWindowMs = 250L` — dentro disso vira rajada.
- `zapCommitDelayMs = 350L` — tempo de silêncio pra confirmar canal final.
- Total percebido em rajada: ~350ms após soltar. Curto o bastante pra sentir natural, longo o bastante pra absorver 2-3 toques rápidos.

Valores ajustáveis se ficarem curtos/longos demais na prática.

### Consistência com o resto

- `onKeyDown` continua ignorando `event.repeatCount > 0` (auto-repeat).
- Overlay de stats: mesma regra (adaptativo).
- LEFT/RIGHT (`previewChannel`/`commitPending` com 1500ms) fica intocado — é preview explícito, propósito diferente.
- Remove a constante `zapDelay = 500L` órfã e substitui pelas duas novas.

## Arquivos

- `android-native/app/src/main/java/tv/lntelecom/nativo/ui/player/PlayerActivity.kt` — única alteração de código.
- `.lovable/plan.md` — atualizar o diagnóstico com o novo comportamento aplicado.

## Detalhes técnicos

```text
UP pressionado
   │
   ├─ atualiza índice + OSD           (sempre, instantâneo)
   │
   ├─ agora - lastZapMs > 250ms ?
   │     SIM → loadCurrent() já       (toque isolado)
   │     NÃO → cancela zapPending
   │           agenda loadCurrent()
   │           pra 350ms depois       (rajada, só o último tune)
   │
   └─ lastZapMs = event.eventTime
```

Usa `event.getEventTime()` (relógio do KeyEvent) em vez de `System.currentTimeMillis()` — imune ao atraso de processamento na main thread, que era o buraco do dedup antigo.

## Fora do escopo

- Não mexer no `NativePlayerPlugin.java` (WebView).
- Não mexer no player web (`NativeAndroidPlayer.tsx`) — este bug é só do app nativo Kotlin.
- Não mudar o preview LEFT/RIGHT.
