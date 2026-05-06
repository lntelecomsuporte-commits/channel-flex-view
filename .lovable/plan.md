## Problema

Ao trocar de canal, o `<video>` segue tocando o canal anterior por algumas centenas de ms até a resolução assíncrona do novo URL terminar (token assinado em `sign-stream-token` e/ou `resolveRedirects` no APK). Só depois que `resolvedUrl` atualiza é que o effect de playback derruba o hls.js antigo e carrega o novo. Por isso aparece "um lampejo do canal atual antes de aparecer o novo".

## Correção

Em `src/components/player/VideoPlayer.tsx`:

1. **Cortar o stream antigo imediatamente quando `streamUrl` muda**, antes da resolução async terminar:
   - No effect de reset (que depende de `[streamUrl]`):
     - `setResolvedUrl("")` — invalida o URL atual.
     - Pausar e limpar o `<video>` (`pause()`, `removeAttribute("src")`, `load()`).
     - Destruir `hlsRef.current` e `mpegtsRef.current` se existirem.
   - Resultado: tela fica preta por ~100–500ms em vez de mostrar o canal antigo (comportamento esperado de zap).

2. **Garantir que o effect async de resolução não escreva URL "atrasado"**:
   - Já existe `cancelled` guard, mas vamos garantir que ele dispare ao trocar `streamUrl` zerando `resolvedUrl` na mesma leva (passo 1).

3. **Manter o `ChannelPrefetch`** intocado — ele já pré-aquece o próximo canal, então a resolução do novo URL costuma ser quase instantânea quando vem do prefetch.

## Detalhes técnicos

- O effect de playback (`[playableStreamUrl, ...]`) já roda quando `resolvedUrl` muda — então setar `resolvedUrl=""` faz o effect rodar uma vez com URL vazio (early return em `if (!video || !playableStreamUrl) return;`), e em seguida com o URL novo. Sem regressão.
- A destruição manual do hls/mpegts no reset evita que o cleanup do effect anterior ainda esteja segurando frames decodificados na tela do canal antigo.
- Não muda nenhuma lógica de backup, proxy, CORS fallback, watchdog, prefetch ou EPG.

## Fora do escopo

- Não altero lógica de `sign-stream-token` nem `resolveRedirects` (a latência deles é a causa raiz do gap, mas otimizar é outra mudança).
- Não mexo no `ChannelPrefetch`.
- Não mexo em backend/edge functions.
