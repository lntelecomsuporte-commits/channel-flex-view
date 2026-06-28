## Diagnóstico

Comparando o player do **android-native** (que abre os canais da Olé) com o plugin **release/Capacitor** (que não abre):

| | android-native (funciona) | release/Capacitor (bloqueia) |
|---|---|---|
| ExoPlayer.Builder | default | default |
| HttpDataSource.Factory | **não define nenhuma** — usa o `DefaultDataSource` interno do ExoPlayer | `DefaultHttpDataSource.Factory().setUserAgent("Dalvik/2.1.0 …")` |
| User-Agent enviado | UA default do Media3 (ex.: `media3/1.4.1 (Linux;Android 11) ExoPlayerLib/2.19`) | `Dalvik/2.1.0 (Linux; U; Android …; … Build/…)` |
| Headers extras | nenhum | os do JS (sem `User-Agent`) |

A origem da Olé está **bloqueando o UA Dalvik** (provavelmente whitelist que aceita só UAs estilo "ExoPlayer/Media3" ou Stagefright). Mudar o UA pro do "app oficial da Olé" também é caminho válido, mas o mais simples e que já sabemos que funciona é deixar o ExoPlayer mandar o **mesmo UA default do Media3** que o app android-native já usa.

## Mudança

Em `android/app/src/main/java/tv/lntelecom/net/NativePlayerPlugin.java`, no método `load(...)`:

1. Remover a chamada `.setUserAgent(defaultDeviceUserAgent())` do `DefaultHttpDataSource.Factory` — o Media3 já preenche um UA default próprio (`media3/<versão> …`) que é exatamente o que o android-native envia hoje e a Olé aceita.
2. Manter `.setAllowCrossProtocolRedirects(true)` e o `setDefaultRequestProperties(headers)` (sem `User-Agent`, que já filtramos do JS).
3. Aplicar a mesma remoção no segundo `DefaultHttpDataSource.Factory` (usado no auto-retry do stall watchdog).
4. Apagar o método `defaultDeviceUserAgent()` (vira código morto).

Trade-off pra confirmar com você antes de eu editar: isso **abre mão do UA Dalvik com modelo do receptor** (`AFTMM Build/NS6711` etc.) que você pediu antes. O servidor passa a ver `media3/1.x.x (Linux;Android 11) ExoPlayerLib/…` em vez do modelo do device. Se você precisa identificar o receptor no log do Flussonic E ao mesmo tempo destravar a Olé, a alternativa é:

- **Opção A (recomendada):** UA default do ExoPlayer pra todo mundo, igual ao android-native. Resolve a Olé. Perde o modelo no log.
- **Opção B:** Adicionar uma flag por canal no admin (`exoplayer_default_ua boolean`) e só nesses canais da Olé pular o UA Dalvik. Mantém Dalvik nos outros, usa default só onde precisa. Mais código (migration + UI admin + passar a flag JS→plugin), mas preserva o UA Dalvik nos demais canais.
- **Opção C:** Trocar o UA pro UA real do app oficial da Olé (se você capturar). Resolve, mas todo receptor manda o mesmo UA fixo.

Me diga qual opção seguir (ou se prefere A direto) que eu implemento.

## Após o build

Como mexe em `android/**`, o GitHub Actions gera o APK release. No servidor:

```bash
cd /opt/lntv-frontend && git pull
```
