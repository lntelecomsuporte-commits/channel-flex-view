## Diagnóstico — por que tem delay hoje

Mapeei o caminho completo entre apertar UP/DOWN e o 1º frame aparecer. Cada item abaixo soma alguns ms — juntos viram o "delayzinho" perceptível mesmo na rede local:

1. **Pre-cache atual é fraco.** O `ChannelPrefetch` usa `fetch` em `mode: "no-cors"` + `cache: "force-cache"`. Resposta vem **opaca** — o browser **não reaproveita** isso para a próxima requisição que o `hls.js` fizer (CORS + headers diferentes). Resultado: aquece DNS/TLS e mais nada. Os "uns segundos do canal próximo" que você pediu **nunca chegam a ser baixados**.
2. **Probe de content-type bloqueante.** Em todo canal proxiado com `.m3u8` o `VideoPlayer` faz um `fetch(url, { method: "GET" })` extra **antes** de instanciar o `hls.js` (linhas 113‑129 de `VideoPlayer.tsx`) só pra ler o header `x-lntv-final-content-type`. É uma rodada HTTP inteira no caminho crítico.
3. **`resolveRedirects` no caminho crítico (APK).** Em URLs HTTPS diretas no APK, espera um GET `Range: 0-0` resolver redirect antes de começar. Vai pro cache só na **2ª** vez que o canal aparece.
4. **`hls.js` é destruído e recriado a cada canal.** `hls.destroy()` + `new Hls(...)` + `attachMedia(video)` + `loadSource(...)` tem overhead fixo (~150‑300ms) que daria pra eliminar reaproveitando a instância.
5. **Tela preta forçada (`firstFrameReady`).** O overlay preto só sai no evento `playing`. Mesmo que o frame chegue rápido, a transição visual passa por preto → o cérebro percebe "demorou".
6. **`startFragPrefetch` + `startLevel: 0` ajudam, mas não substituem ter o segmento já em cache.** Quando o segmento já está no HTTP cache, o tempo cai pra "abrir = decodificar".

## O que vou fazer

### 1. Pre-cache real (manifest + 1 segmento) — o que vai dar o maior ganho
Reescrever `ChannelPrefetch.tsx` para, ao detectar canal vizinho:
- Resolver a URL final (proxy/token/redirect) **igualzinho** o `VideoPlayer` faz.
- Fazer `fetch` **com CORS** (mesmas credenciais/headers que o `hls.js` vai usar) do `.m3u8` → grava resposta no HTTP cache do browser.
- Parsear o manifest (regex simples nas linhas que não começam com `#`) e fazer `fetch` do **1º segmento `.ts`** (também com CORS, sem `Range`) → grava no cache.
- Para MP4 direto: `fetch` com `Range: bytes=0-524287` (≈512KB, suficiente pro `moov` + 1‑2s de vídeo).
- Quando o usuário apertar UP/DOWN, o `hls.js` puxa exatamente as mesmas URLs e **bate em cache local** → zap quase instantâneo.
- Cancelar o prefetch em curso quando o canal mudar (pra não competir banda com o canal que está abrindo).
- Throttle: só refazer quando `(currentIndex)` muda; não disparar prefetch enquanto o canal atual ainda está fazendo buffer inicial (`waiting`).

### 2. Eliminar o probe de content-type do caminho crítico
- Lazy: só rodar o probe **se** o `hls.js` retornar erro de parsing do manifest (raríssimo). Caso contrário, assume que `.m3u8` é HLS e segue direto.
- Isso remove uma viagem HTTP completa de **todo zap**.

### 3. Pular `resolveRedirects` quando já cacheado
- Verificar `redirectCache` **sem fazer fetch**: se já tem entrada válida, usa; senão, dispara `hls.js` na URL original em paralelo e atualiza o cache em background.

### 4. Reaproveitar a instância do `hls.js`
- Em vez de `destroy()` + `new Hls(...)`, manter uma instância "viva" e chamar `hls.detachMedia()` + `hls.loadSource(novaUrl)` + `hls.attachMedia(video)` quando dá pra reusar (mesmo engine HLS, sem mudar `useProxyToken`).
- Quando muda de engine (HLS↔MPEG-TS↔MP4 nativo) ou de modo de proxy, aí sim destrói.

### 5. Não mostrar preto entre canais
- Trocar o overlay preto por **manter o último frame do canal anterior** (CSS: o `<video>` antigo congela no último frame; cobrir só com um spinner discreto após 800ms se o novo ainda não tocou). Sensação subjetiva de troca cai pela metade mesmo sem mudar latência real.

### 6. Ajustes finos no `hls.js`
- `maxBufferHole: 0.5`, `nudgeMaxRetry: 5`, `manifestLoadingTimeOut: 6000` (mais agressivo).
- Reduzir `liveSyncDurationCount` de 3 → 2 quando o device é forte (`getDeviceProfile`).

## Arquivos que vou tocar

- `src/components/player/ChannelPrefetch.tsx` — reescrita do pre-cache (CORS real + manifest+segmento).
- `src/components/player/VideoPlayer.tsx` — remover probe sync de content-type, reaproveitar instância `hls.js`, trocar overlay preto por "frame congelado + spinner tardio", ajustar timeouts.
- `src/lib/stream.ts` — adicionar variante de `resolveRedirects` que não bloqueia se o cache estiver vazio (apenas dispara em background).

## Detalhes técnicos (referência)

```text
Antes:  [UP] → resolveRedirects(GET range) → contentType probe(GET) → new Hls() → loadManifest(GET) → loadSeg0(GET) → decode → 1º frame
                ~200ms                       ~150ms                  ~80ms       ~120ms              ~250ms          ~150ms     ≈ 950ms

Depois: [UP] → (cache hit do prefetch)        → reuseHls.loadSource → loadManifest(cache) → loadSeg0(cache) → decode → 1º frame
                                                ~30ms                  ~5ms                  ~5ms              ~150ms     ≈ 190ms
```

Ganho estimado: zap percebido cai de ~1s pra ~200‑300ms quando o vizinho já foi prefetched. Em zap "frio" (canal não vizinho) o ganho é menor mas ainda sensível pelos itens 2, 4, 5.

## Riscos / coisas que posso quebrar

- **Banda extra**: pre-cache real baixa o 1º segmento (~300‑800KB por canal vizinho). Em rede local é desprezível, mas vou cancelar agressivamente ao trocar de canal pra não competir.
- **CORS no `.ts`**: se o flussonic não devolver `Access-Control-Allow-Origin`, o `fetch` CORS falha. Fallback: tenta `no-cors` (não cacheia, mas pelo menos aquece TLS) — comportamento atual.
- **Reuso de `hls.js`**: alguns canais com configs muito diferentes (codec exótico) podem precisar de instância nova. Vou usar uma chave (`engine|useProxyToken|forceProxyNative`) e só reusar dentro da mesma chave.

## Não vou mexer

- Layout, OSD, lista de canais, navegação por teclas — só performance do player.
- `hls-proxy` edge function — o ganho está no cliente.
- APK / Android nativo — todas as mudanças são JS, então atualizam só com `npm run build`.
