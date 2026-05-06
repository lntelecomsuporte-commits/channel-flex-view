## Contexto

Você levantou 2 questões no APK em anexo (de um concorrente):

1. **Regressão**: canais SEM "Ocultar URL (proxy + token)" pararam de tocar.
2. **Experiência de zap**: o concorrente faz **pré-buffer real** do canal anterior e do próximo, então a troca aparece instantânea. Hoje no LN TV temos só `ChannelPrefetch` que faz `fetch()` do manifest — aquece DNS/manifest/cookies, mas NÃO decodifica vídeo. Por isso ainda há 300–800ms de tela preta.

## Plano

### Parte 1 — Investigar e corrigir regressão dos canais sem "Ocultar URL"

A correção anterior do "lampejo" adicionou no effect `[streamUrl]` (linhas 131–152 do `VideoPlayer.tsx`):
- `setResolvedUrl("")`
- `video.pause(); video.removeAttribute("src"); video.load()`
- destruir `hlsRef` e `mpegtsRef`

Suspeita: ao destruir o `hls.js` no reset, o effect de playback antigo ainda roda o cleanup (linhas 461–466 atuais) que tenta destruir DE NOVO e/ou re-attach. Para canais HTTPS direto isso pode deixar o `<video>` em estado "limpo" sem nunca receber o novo `src` quando a resolução é síncrona — porque o `setResolvedUrl("")` seguido de `setResolvedUrl(novaUrl)` no MESMO tick do React pode ser batched, e o effect playback não re-dispara (mesmo `playableStreamUrl` final).

**Investigação**:
- Confirmar via console do PWA se o effect de playback está rodando para o canal HTTPS direto após zap.
- Verificar se `engine=hls`/`native` aparece no log para esse canal pós-fix.

**Correção proposta**:
- Não destruir hls/mpegts manualmente no effect de reset — deixar o cleanup do effect de playback fazer isso naturalmente quando `playableStreamUrl` mudar.
- Substituir por: setar `resolvedUrl` para um sentinel diferente (ex.: `"about:blank-{streamUrl}"`) que garante que o effect de playback rode ao menos uma vez com URL "vazia" (early return + cleanup do hls antigo) e em seguida com a URL nova.
- OU: forçar chave de remount no `<video>` via `key={activeStreamUrl}` — limpa todo o estado interno do elemento sem mexer manualmente em src/load.

### Parte 2 — Pré-buffer real do canal anterior e próximo (como o concorrente)

Hoje `ChannelPrefetch` só faz `fetch(manifest)`. Para imitar o concorrente, vamos manter **2 `<video>` ocultos** (offscreen, `width:0;height:0`) com hls.js anexado e tocando mudo em background:

```
[ Video ATIVO (visível) ]    canal N
[ Video PRELOAD next ]        canal N+1  (mudo, hidden, paused após buffer)
[ Video PRELOAD prev ]        canal N-1  (mudo, hidden, paused após buffer)
```

**Como funciona**:
- Ao parar num canal, dispara prefetch dos vizinhos com hls.js real, deixa carregar 2–3s de buffer e dá `pause()` (mantém o buffer).
- No zap (UP/DOWN), faz **swap de instâncias hls.js**: o player ativo recebe o que era preload, e os preloads avançam um índice.
- Resultado: zap quase instantâneo (50–150ms) porque o segmento inicial já está decodificado/bufferizado.

**Detalhes técnicos**:
- Novo componente `<ChannelBuffer>` que monta um `<video muted hidden>` + hls.js para uma URL.
- Refatorar `VideoPlayer` pra aceitar uma instância hls.js "doada" via prop ou ref (alternativa mais simples: manter 3 `<video>` montados sempre e alternar qual está visível via CSS `display`/`visibility`).
- Cuidado com banda: 3x stream simultâneo. Mitigar com `autoLevelCapping` no nível mais baixo nos preloads + `pause()` após N segundos de buffer + cancelar preload se usuário ficar zapeando rápido (debounce 1.5s antes de iniciar).
- No APK Android com TV Box fraco: limitar a 1 preload (só o próximo), ou desabilitar via `deviceProfile` quando dispositivo fraco.
- Manter o `ChannelPrefetch` atual desativado (substituído pelo novo).

**Fora do escopo**:
- Não mexer em backend / edge functions / sign-stream-token.
- Não mexer em EPG, favoritos, login.

### Ordem de execução

1. Primeiro entregar **Parte 1** (regressão) — crítico, app travado pra alguns canais.
2. Depois **Parte 2** (pré-buffer real) — melhoria de UX.

Quer que eu já implemente as duas partes nessa ordem, ou só a Parte 1 primeiro pra você validar antes?
