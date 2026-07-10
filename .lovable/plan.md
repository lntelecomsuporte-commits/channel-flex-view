Corrigir o "pula 10-15 canais" no zap UP/DOWN do app nativo Android aplicando as duas melhorias mais efetivas juntas: ignorar auto-repeat + debounce do load pesado.

## Arquivo alterado
`android-native/app/src/main/java/tv/lntelecom/nativo/ui/player/PlayerActivity.kt`

## Mudanças

### 1. `onKeyDown` — ignorar auto-repeat em UP/DOWN
Nos dois pontos onde UP/DOWN/CH_UP/CH_DOWN chamam `changeChannel()` (linha ~717 dentro do stats overlay e linha ~760 no player principal), descartar eventos com `event?.repeatCount ?: 0 > 0`. Efeito: segurar a tecla não vira rajada de zaps; cada toque físico = 1 avanço.

### 2. `changeChannel(delta)` — virar debounce ao invés de load imediato
Refatorar para o mesmo padrão de `previewChannel()`, mas mais rápido:

- Adicionar `zapPending` (Runnable) e `zapDelay = 500L`.
- Cada `changeChannel(delta)`:
  - Incrementa `pendingIndex` (ou `index` de preview) na hora e chama `showOsd(pendingIndex)` — feedback visual instantâneo.
  - `previewHandler.removeCallbacks(tunePending)` e reagenda `postDelayed(tunePending, 500)`.
- `commitPending()` já existe e faz exatamente o `loadCurrent()` no canal final — reaproveitado.
- Dedup atual de 40 ms cai (fica redundante com o debounce + filtro de repeat).

### 3. Confirmar imediato com OK
`handleOkPress()` (linha 653) já detecta `pendingIndex >= 0` e chama `commitPending()`. Continua funcionando de graça — se o usuário quiser pular o debounce, aperta OK.

### 4. Digitação numérica e list overlay
Sem impacto — usam caminhos separados (`digitBuffer` / `listAdapter`).

## Comportamento resultante
- 1 toque em UP → OSD mostra próximo canal na hora, sintoniza 500 ms depois.
- Segurar UP → OSD anda visualmente (só na primeira pressão, auto-repeat ignorado), sintoniza no canal final.
- Zap rápido (vários toques em sequência) → OSD acompanha, main thread livre, sem backlog de `setMediaItem`/`prepare`, sintoniza só o canal onde o usuário parou.
- OK durante preview → commit instantâneo.
- LEFT/RIGHT continua com 1500 ms (comportamento de "preview lento" preservado).

## Fora do escopo
- Nenhuma mudança no app Capacitor (`android/`) — o sintoma foi relatado só no nativo, e a arquitetura de zap ali é diferente (WebView + React).
- Sem mudança de UI/admin, sem migration.

## Deploy
Como mexe em `android-native/**`, o GitHub Actions gera novo APK automaticamente. Frontend não muda, então não precisa rebuild do `/opt/lntv-frontend`.
