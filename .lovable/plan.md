## Diagnóstico

O stack do erro mostra:
```
openAndSendXhr → load → _doFragLoad → _loadFragForPlayback → loadFragment
```
+ `onFragBuffered` aparece no stack (segmentos anteriores passaram).

**Conclusão:** o manifest `.m3u8` carregou OK, vários segmentos passaram, e então um segmento específico devolveu 404. Padrões típicos do upstream `s2.micineovs.com`:
- **Live edge sliding**: a playlist ainda lista um segmento que o servidor já apagou da janela.
- **Token de segmento expirado** entre o load do manifest e o pedido do segmento.
- **Balanceador inconsistente** no upstream.

## Comportamento atual

`VideoPlayer.tsx` (linhas 234-340):
- `fragLoadingMaxRetry: 8`, `fragLoadingRetryDelay: 500` → hls.js tenta o **mesmo segmento** 8x com backoff (~16s gastos no pior caso).
- Só dispara o handler de ERROR quando vira **fatal**, e aí cai em `networkErrorRetries`.
- O watchdog separado de freeze (4s) acaba disparando `recoverMediaError` antes do erro virar fatal — mas isso não resolve 404 de segmento, só mexe no buffer.

Resultado: a TV congela uns segundos, o usuário vê freeze, e só depois recupera (ou pula pro backup).

## Mudança proposta

Adicionar **handler para erros NÃO-fatais de fragmento** no listener `Hls.Events.ERROR` em `VideoPlayer.tsx` (perto da linha 285). Antes do `if (!data.fatal) return;`, interceptar:

```text
data.details === "fragLoadError"
&& data.response?.code === 404
```

Ação:
1. Logar uma vez (com cooldown de 3s pra não floodar).
2. Chamar `hls.trigger(Hls.Events.LEVEL_LOADED, ...)` não — usar a abordagem oficial: `hls.nextLoadLevel = hls.loadLevel` e `hls.startLoad(-1)` para forçar **recarregamento do manifest** (pega janela live atualizada / token novo).
3. Limitar a 2 tentativas por canal; se persistir, escalar pra `tryNextBackup()`.

Também reduzir `fragLoadingMaxRetry` de 8 → 3 para não desperdiçar 16s tentando o mesmo segmento morto.

## Arquivo afetado

- `src/components/player/VideoPlayer.tsx` — adicionar bloco antes do `if (!data.fatal) return;` no listener de ERROR e ajustar config inicial.

## Não vou mexer

- `hls-proxy` edge function: ela já está repassando corretamente o 404 do upstream; mudar para devolver 200+JSON quebraria o contrato com hls.js (ele espera segmento binário).
- Watchdog de freeze de 4s: continua útil pra outros cenários (decoder travado).
- Lógica de backup / corsFallback: já funciona, só vamos acioná-la mais cedo nesse caso.

## Resultado esperado

- 404 isolado de segmento: recuperação em ~500ms (reload do manifest) em vez de 4s de freeze.
- 404 persistente: failover pro backup em ~1.5s em vez de ~16s.

## Comandos pro servidor (depois de aplicar)

```bash
cd /opt/lntv-frontend && git pull && npm run build && rsync -a --delete --exclude logos dist/ /var/www/lntv/
```
