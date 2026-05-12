# Análise: o que acontece hoje a cada troca de canal

Quando você aperta ↑ no controle, a sequência atual é:

```
keydown ↑ → setCurrentIndex(+1)
        → PlayerPage re-renderiza com novo currentChannel.stream_url
        → VideoPlayer recebe novo streamUrl
        → useEffect "reset" dispara: zera firstFrameReady, backupIndex,
          corsFallback, contentType, proxyTokenFailure (5 setStates)
        → useEffect "resolve URL" dispara em ASYNC (await mesmo no caminho
          simples HTTPS direto)
        → Em APK + HTTPS: ainda faz Promise.race com resolveRedirects
          (no-op porque Promise.resolve(null) ganha sempre)
        → setResolvedUrl → useEffect do <video> dispara
        → hot-swap (hls.stopLoad + loadSource) — bom, isso é rápido
        → hls.js baixa manifest + 1 segmento → evento "playing"
        → firstFrameReady = true → spinner some
```

## Diagnóstico dos problemas que você relatou

**1. Spinner aparece TODA troca** — o reset effect zera `firstFrameReady` na hora que `streamUrl` muda. Isso ativa `isLoadingNewChannel=true` imediatamente. O `DelayedSpinner` espera 500ms — mas como o tempo real até o 1º frame é ~600-1500ms (manifest + 1 segmento), ele quase sempre ultrapassa o limite e aparece. Resultado: spinner gigante no meio da tela em todo zap, ofuscando o frame anterior congelado que o hot-swap mantém.

**2. Delay de ~2s mesmo em canal local** — três custos pequenos somados:
- 1 microtask + render extra do `await resolveChannelStreamUrl` no caminho HTTPS direto (que poderia ser síncrono).
- O `Promise.race([resolveRedirects, Promise.resolve(null)])` é teatro: o `null` ganha sempre, então não economiza nada e ainda gasta 1 microtask.
- 5 setStates no reset effect causam 2-3 renders antes do <video> ser remontado.
- Hls.js precisa baixar manifest + 1 segmento HLS (4-6s de live edge) — esse é o piso real, ~400-800ms numa rede boa.

**3. "Segurando ↑↑↑ mostra canais, soltou abre"** — hoje, segurar ↑ já mostra preview (via `e.repeat`), mas **soltar não confirma** — você ainda precisa apertar OK. Após 5s o preview some sem trocar. Não existe handler de `keyup` que faça `confirmPreview()`.

**4. Excesso de regras** — sim, há duplicação:
- 5 setStates no reset que poderiam ser 1 ou nenhum (a maioria é "best-effort" que pode ser lazy).
- O `Promise.race` é morto.
- O `await` no caminho simples gasta render extra.

---

# O que vou fazer

## 1. Tirar o spinner do caminho do zap (mais visível pro usuário)

Em `VideoPlayer.tsx`:
- **Não zerar `firstFrameReady` no reset effect.** Deixar o frame anterior congelado até o novo dar `playing` — exatamente o comportamento do hot-swap. Spinner só aparece se a URL DEMORAR pra resolver de verdade (>800ms), não em todo zap.
- **Aumentar o threshold do `DelayedSpinner` de 500ms → 900ms.** Em zap normal (cache hit do prefetch), o frame troca antes — sem spinner. Só aparece se algo realmente travou.
- **Diminuir o spinner e mover pro canto inferior direito**, sem véu preto. Não cobre o conteúdo.

## 2. Eliminar o delay artificial no caminho síncrono

Em `VideoPlayer.tsx` (effect de resolução de URL):
- **Caminho simples (HTTPS direto, sem `useProxyToken`, sem `forceProxyNative`): roda síncrono**, sem `await`, sem effect com `Promise`. Calcula `getPlayableStreamUrl(streamUrl)` direto no `useMemo` e passa pro effect do <video>. Economiza 1-2 renders.
- **Remover o `Promise.race([resolveRedirects, Promise.resolve(null)])`** — é no-op. Manter apenas o disparo "fire-and-forget" do `resolveRedirects` em background pra popular cache pra próxima vez.
- **Consolidar os 5 setStates** do reset effect em 1 único `useReducer` (ou agrupar dentro do mesmo render via `unstable_batchedUpdates` implícito do React 18 — já vem batched, mas reordenar pra que o reset não dispare quando não precisa: só zerar `proxyTokenFailure`/`backupIndex` se eles estavam diferentes do default).

## 3. "Soltou ↑/↓ → abre o canal do preview"

Em `PlayerPage.tsx` (handler de keyup):
- Detectar `keyup` em `ArrowUp`/`ArrowDown` quando `showPreview` está ativo → chamar `confirmPreview()` automaticamente, com pequeno debounce de 120ms (pra não confirmar entre dois pulses do auto-repeat do controle).
- Comportamento final:
  - **Tap rápido em ↑** → troca direto pro próximo (igual hoje).
  - **Segurar ↑** → mostra preview do próximo, próximo, próximo… (igual hoje).
  - **Soltar** → confirma e abre o canal em foco no preview (NOVO — hoje precisa apertar OK).

## 4. Reaproveitar prefetch melhor

Em `ChannelPrefetch.tsx`:
- Já está bom — manifest + 1º segmento em cache. Vou apenas **pre-resolver o redirect** (`resolveRedirects`) imediatamente em paralelo (já está, mas garantir que o `next` E `prev` estejam sempre quentes). Sem mudanças grandes.

---

# Resultado esperado

- **Tap único em ↑/↓**: troca em ~300-600ms (limitado pelo download de 1 segmento HLS), **sem spinner aparecendo** — só o frame anterior congelando 1 instante antes do novo entrar.
- **Segurar ↑/↓**: vê os preview cards passando rapidamente; ao soltar, o canal selecionado abre automaticamente.
- **Spinner**: só aparece quando algo travou de verdade (>900ms), e mesmo assim discreto no canto, sem véu preto.
- **Sem mudanças de comportamento** em: lista de canais, OSD, favoritos, busca, PIN, backups, hot-swap, watchdog, EPG.

# Detalhes técnicos

Arquivos tocados:
- `src/components/player/VideoPlayer.tsx` — reset effect, async→sync no caminho simples, DelayedSpinner (threshold + visual).
- `src/pages/PlayerPage.tsx` — handler de keyup pra `ArrowUp`/`ArrowDown` + lógica `confirmPreviewOnRelease`.

Sem mudanças em: `ChannelPrefetch.tsx` (já otimizado), `stream.ts`, edge functions, banco, APK nativo.

Risco baixo — todas as mudanças são em código de UI/timing. Sem alteração de protocolo de stream nem de proxies.
