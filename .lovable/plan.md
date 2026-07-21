## Objetivo

Garantir que o app nativo encerre sozinho **em qualquer receptor** (Fire TV, TV Box genérica, Android TV, mini PC, etc.) quando o usuário desliga o aparelho — independentemente de o fabricante entregar `POWER`, `SLEEP`, `SCREEN_OFF` ou nada disso para o app.

## Estratégia: encerrar por perda de primeiro plano, não por tecla

Hoje dependemos de sinais que **cada fabricante entrega de um jeito**:

- Fire TV: aperta Power → desliga TV via HDMI-CEC, app continua rodando em background (nenhum evento chega).
- TV Box Android puro: manda `KEYCODE_POWER` pro app antes de dormir.
- Android TV oficial: manda `ACTION_SCREEN_OFF`.
- Alguns receptores só disparam `onUserLeaveHint` quando vão pro launcher.

Em vez de continuar caçando cada tecla, a regra passa a ser universal:

> **Se o app deixou de estar visível/ativo em primeiro plano, encerra.**

Isso cobre TODOS os cenários acima de uma vez só, porque em qualquer um deles o Android tira o app do foreground.

## Plano de implementação

1. **Criar um helper compartilhado** (`AppShutdown.kt` ou similar) com o `shutdownAndRelease()` atual — release do player, stop do heartbeat, `finishAndRemoveTask()` + `System.exit(0)` com 150 ms de delay, guard `shuttingDown` e suporte a "supressão temporária" (para instalador de update).

2. **Aplicar o encerramento por ciclo de vida nas 3 Activities do app nativo** (`LoginActivity`, `ChannelListActivity`, `PlayerActivity`):
   - Em `onStop()`, se a Activity saiu de primeiro plano e não é atualização em andamento, chamar `shutdownAndRelease("on_stop")`.
   - Manter os gatilhos atuais (Power/Sleep, `SCREEN_OFF`, `onUserLeaveHint`) como reforço — se qualquer um chegar antes, encerra mais rápido.

3. **Proteger contra falsos positivos**
   - Suprimir o shutdown enquanto o instalador de APK está aberto (flag já existe no legacy Capacitor — replicar).
   - Suprimir durante transição interna entre Activities do próprio app (flag simples: setada antes do `startActivity` interno, limpa em `onResume` da próxima tela).

4. **Não mexer no APK release (Capacitor)**
   - Ele já encerra via `onUserLeaveHint` + `ACTION_SCREEN_OFF` + Power e está funcionando nos seus testes. Só encostar se você reportar caso onde ele também fica aberto.

5. **Não mexer em Roku, Samsung/Tizen, frontend web nem backend.**

## Resultado esperado

- Fire TV: aperta Power, TV apaga via CEC, Android tira o app do foreground em segundos → `onStop` fecha o app.
- TV Box com Power: fecha na hora pela tecla (comportamento atual) — antes mesmo do `onStop`.
- Android TV: fecha via `SCREEN_OFF` (atual) ou `onStop` (fallback).
- Qualquer receptor futuro: mesma regra vale sem precisar mapear tecla específica.