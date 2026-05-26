## Objetivo

Mudar o comportamento do APK Android pra **fechar e liberar memória** quando o usuário:
1. Aperta o botão **Home** (casinha) do controle
2. Aperta o botão **Power** do controle (entra em stand-by)

Hoje o app fica vivo em background via foreground service — vamos reverter isso pra esses dois casos específicos.

## Mudanças

### 1. `android/app/src/main/java/tv/lntelecom/net/MainActivity.java`

Adicionar lifecycle hooks pra detectar quando a Activity vai pra background:

- **`onUserLeaveHint()`** — chamado quando o usuário aperta Home explicitamente (não quando abre notificação ou recebe ligação). É o sinal mais limpo pra distinguir "Home" de outras causas de pausa.
- **`onStop()`** — chamado quando a tela apaga / stand-by / app sai de foco totalmente.

Em ambos os casos:
1. Parar o foreground service (`PlaybackKeepAliveService`)
2. Chamar `finishAndRemoveTask()` pra remover da lista de apps recentes e encerrar a Activity
3. Em `onStop()` adicionar `System.exit(0)` após `finishAndRemoveTask()` pra garantir que o processo morra e libere RAM (em TV boxes de 1GB isso importa)

### 2. `BroadcastReceiver` pra detectar stand-by (tela apaga)

Registrar um receiver pro `Intent.ACTION_SCREEN_OFF` dentro da `MainActivity` (registro dinâmico, não no manifest — `ACTION_SCREEN_OFF` só funciona com receiver dinâmico). Quando a tela apaga (power do controle em Android TV/Fire TV), o receiver dispara o mesmo fluxo de "fechar e liberar memória".

### 3. `src/components/player/NativeAndroidPlayer.tsx` e `VideoPlayer.tsx`

Garantir cleanup do ExoPlayer / hls.js quando a página perde visibilidade definitivamente (já existe parcialmente — só validar que `release()` é chamado).

## Detalhes técnicos

- **`onUserLeaveHint` vs `onPause`**: usamos `onUserLeaveHint` porque ele só dispara em ações intencionais do usuário (Home, Recents). `onPause` também dispara quando aparece um diálogo do sistema, o que fecharia o app indevidamente.
- **`finishAndRemoveTask()`** remove da lista de "apps recentes" — quando o usuário reabre pelo launcher, é boot do zero (splash → login auto via device → home).
- **`System.exit(0)`** é agressivo mas necessário em TV boxes com pouca RAM: sem isso o processo Java fica residente mesmo após `finish()`.
- **Auto-login** já existe (device-auto-login) então reabrir o app não pede credencial — vai direto pro último canal/home.
- **Trade-off**: cold start fica ~2-3s mais lento ao reabrir (vs <200ms instantâneo de hoje), em troca de zero consumo de RAM em background.

## Fora de escopo

- Não muda comportamento web/PWA (só nativo Android).
- Não muda Roku (que já tem ciclo de vida próprio gerenciado pelo SO).
- Não remove o `PlaybackKeepAliveService` — ele continua útil enquanto o app está em foreground (impede LMK durante uso ativo). Só paramos ele ao sair.

## Validação

Após deploy do APK novo, testar no Fire TV / TV box:
1. Abrir app, tocar canal, apertar Home → app some da lista de recentes, RAM liberada (verificar via `adb shell dumpsys meminfo tv.lntelecom.net`).
2. Abrir app, apertar Power do controle → tela apaga + app encerra.
3. Reabrir pelo launcher → boot limpo, auto-login, último canal.
