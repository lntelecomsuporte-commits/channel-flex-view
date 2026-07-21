# Paridade de encerramento em todas as Activities (app nativo)

Objetivo: garantir que apertar **Power** no controle (ou a TV entrar em stand-by / cabo HDMI cair) encerre o app em **qualquer tela**, não só na `PlayerActivity`.

**Sem tratamento de `onStop`/perda de foco** — o usuário prefere evitar risco de fechamento acidental durante update do app, diálogos do sistema, notificações, etc.

## Diagnóstico atual

Hoje o `shutdownAndRelease()` (Power key + `ACTION_SCREEN_OFF` + HDMI unplug) só existe na `PlayerActivity`. Se o Fire TV estiver na tela de login, splash, lista de canais fora do player, ou qualquer outra Activity, apertar Power desliga a TV mas o app fica vivo em background.

## O que fazer

1. **Criar `ShutdownHelper.kt`** (novo, em `android-native/app/src/main/java/.../util/`)
   - Função `installGlobalShutdown(activity: Activity)`:
     - Registra `BroadcastReceiver` pra `Intent.ACTION_SCREEN_OFF` e `ACTION_HDMI_PLUG` (unplug).
     - Expõe `handleKeyDown(keyCode)` pra tratar `KEYCODE_POWER`, `KEYCODE_SLEEP`, `KEYCODE_SOFT_SLEEP`.
     - Método `shutdown()`: `finishAndRemoveTask()` + `Handler(mainLooper).postDelayed({ System.exit(0) }, 150)`.
     - `unregister()` chamado no `onDestroy` da Activity.
   - **Não** trata `onStop`, `onPause`, `onUserLeaveHint` nem foco de janela.

2. **Aplicar em todas as Activities do app nativo** (Splash, Login, ChannelList, Settings, e qualquer outra que herde de `AppCompatActivity`):
   - `onCreate`: `shutdown = ShutdownHelper.install(this)`
   - `onKeyDown`: delega pro helper antes do `super`
   - `onDestroy`: `shutdown.unregister()`

3. **Refatorar `PlayerActivity`** pra usar o mesmo helper, removendo a duplicação atual (mantendo o comportamento idêntico ao de hoje).

## Fora do escopo

- Fechamento por `onStop` / perda de foco → **descartado** por risco de fechar durante update ou diálogos.
- APK Capacitor (release) → já encerra corretamente, sem mudanças.
- Roku / Tizen / frontend web → não afetados.

## Detalhes técnicos

- Arquivos alterados: `android-native/app/src/main/java/.../PlayerActivity.kt` + cada Activity do módulo + novo `util/ShutdownHelper.kt`.
- Não mexe em manifest, permissões ou dependências.
- Bump de `versionCode` no `build.gradle` pra gerar nova release no GitHub Actions.

## Como testar

1. Instalar o APK no Fire TV.
2. Em cada tela (splash, login, lista, player), apertar Power → TV apaga e app encerra (verificar via `adb shell dumpsys activity | grep lntv` que o processo sumiu).
3. Abrir o app, ir pra lista de canais (fora do player), tirar o HDMI → app encerra.
4. Deixar o app aberto e mandar uma notificação do sistema / abrir Quick Settings → app **continua rodando** (garantia de que foco não fecha).
