## Situação

Você confirmou que os Rokus dos clientes já estão com a versão nova (que tem `HeartbeatTask.brs`), e quer ver eles nas estatísticas **com canal atual**. O código do Roku no repo já chama `session-heartbeat` corretamente com `platform: "roku"`, `sessionToken`, `deviceId`, `channelId/Name`, etc. — e a edge function já aceita `"roku"` na whitelist.

Se mesmo assim eles não aparecem no painel, uma destas 3 coisas está acontecendo:

1. **Auth falhando** — token do Roku vencido/refresh quebrando → função devolve 401 silenciosamente e nada é gravado.
2. **Request não chega** — problema de rede/DNS/certificado no lado Roku.
3. **Grava mas o painel filtra fora** — improvável, o painel usa a mesma tabela.

Sem re-sideloadar Roku, o único caminho é **iluminar o server**: fazer a edge function `session-heartbeat` gritar nos logs sempre que algo com cara de Roku chegar (via `platform: "roku"` **ou** via User-Agent contendo "Roku"). Aí você olha `docker logs` no servidor e sabe em 30 segundos qual dos 3 casos é.

## O que vou alterar

### `supabase/functions/session-heartbeat/index.ts`

Adicionar logs condicionais no início do handler, só quando o request cheira a Roku:

- **Antes da checagem de auth**: se `User-Agent` bate `/roku/i` e vier sem `Authorization`, loga `[hb][roku] 401 sem Authorization ua=...`.
- **Após `auth.getUser()`**: se falhar e UA for Roku, loga o `error.message` e o UA.
- **Após ler o body**: se `platform === "roku"` **ou** UA-Roku, loga uma linha JSON com `action`, `user_id`, `hasSessionId`, `platform` bruto, `cleanPlatform`, `deviceId`, `userAgent` do body, `uaHeader`, `appVersion`, `ip`.

Nenhuma mudança na lógica de inserção — só instrumentação. Baixo risco, zero impacto em web/android (logs só disparam pra Roku).

## Como diagnosticar depois de deployar

No servidor, com a função nova rodando:

```bash
docker logs -f supabase-edge-functions 2>&1 | grep '\[hb\]\[roku\]'
```

Peça pra um cliente com Roku abrir o app. Em ~30s você vai ver uma dessas 3 saídas:

- **Nada** → o request nunca chega. Problema de rede/DNS no Roku (ou app antigo mesmo).
- **`401 sem Authorization` ou `auth.getUser falhou`** → token Roku ruim. Aí a correção é no fluxo de refresh do Roku (aí sim precisa update do app, sem escapatória).
- **JSON com `action: "start"` mas sessão não aparece no painel** → tem erro no insert, veremos o `error.message` logo abaixo no log (que já é logado hoje pelo `error` return).

Também vou te dar comandos pro servidor pra deploy da edge function + como filtrar os logs (padrão da memória `mem://preferences/deploy-commands`).

## Fora de escopo

- Não vou tocar em nenhum arquivo do Roku (`roku/**`).
- Não vou tocar no painel — a tabela `user_sessions` já aceita `platform="roku"` e o painel já lê ela.
- Se o diagnóstico apontar pra "app antigo" ou "refresh token quebrado no Roku", aí sim vamos precisar de um segundo passo mexendo em `roku/source/SupabaseAuth.brs` — mas só depois de confirmar pelos logs.
