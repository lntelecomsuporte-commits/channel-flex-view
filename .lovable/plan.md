# Zap UP/DOWN — paridade com o release/web

Aplicado em `android-native/.../PlayerActivity.kt` (build > 50).

## Comportamento (igual app release/web)

- **Toque solto** UP/DOWN (`repeatCount == 0`) → `changeChannel()` sintoniza **instantaneamente**. Sem debounce, sem burst window.
- **Segurando** UP/DOWN (`repeatCount > 0`) → `previewChannel(delta)` cicla índice pendente + OSD, **sem** sintonizar (reusa a máquina de LEFT/RIGHT).
- **Ao soltar** (`onKeyUp`) — se `pendingIndex >= 0`, cancela `tunePending` e comita na hora. Sem esperar os 1500ms.
- Se ficar parado com preview aberto, o `previewDelay = 1500L` do `tunePending` ainda comita sozinho (rede de segurança).

## Alterações

- `changeChannel(delta, eventTimeMs)` — removido todo o debounce adaptativo (`zapPending`, `zapBurstWindowMs`, `zapCommitDelayMs`, `lastZapEventMs` — ficaram declarados mas não usados). Agora só: atualiza `index`, mostra OSD, `loadCurrent()`.
- `onKeyDown` UP/DOWN/CH_UP/CH_DOWN — `repeatCount==0 ? changeChannel : previewChannel`.
- Novo `onKeyUp` — solta UP/DOWN/CH_UP/CH_DOWN e comita `pendingIndex` se houver.
- Stats overlay: mesma regra (solto sintoniza, segurando cicla preview).

## Fora de escopo

- LEFT/RIGHT continuam usando `previewChannel` + `previewDelay = 1500L` (sem mudanças).
- `NativePlayerPlugin.java` (Capacitor) e `NativeAndroidPlayer.tsx` (web) — este bug era só do nativo Kotlin.
