## Objetivo
Permitir que cada integração Hubsoft tenha um **período de degustação** opcional. Quando ativado, novos usuários criados por aquela integração recebem acesso às **categorias de degustação** durante N dias. Ao expirar, o acesso volta automaticamente para as **categorias normais** da integração.

## Mudanças no banco

**`hubsoft_config`** — novas colunas:
- `trial_enabled boolean` (default false)
- `trial_days integer` (default 30)

**Nova tabela `hubsoft_config_trial_categories`** — espelho da `hubsoft_config_categories`, lista quais categorias compõem a degustação.

**`user_category_access`** — novas colunas:
- `is_trial boolean` (default false) — marca o registro como “acesso de degustação”
- `trial_expires_at timestamptz` — quando esse acesso expira

RLS continua só admin gerenciando. Todas as alterações via migration.

## UI — Editar Integração (`HubsoftIntegration.tsx`)

Dentro do form de edição, adicionar um bloco “Degustação”:
- Switch **Ativar degustação**
- Input numérico **Dias de degustação** (default 30)
- Grid de checkboxes **Categorias de degustação** (mesmo padrão das categorias normais)
- Texto explicando: “Novos usuários cadastrados por essa integração recebem essas categorias por X dias. Depois disso, voltam às categorias normais automaticamente.”

Salvar grava `hubsoft_config` + sincroniza `hubsoft_config_trial_categories`.

## Webhook (`supabase/functions/hubsoft-webhook/index.ts`)

Ao criar/ativar um usuário:
- Se `trial_enabled = true` na config: insere em `user_category_access` as **trial categories** com `is_trial=true`, `trial_expires_at = now() + trial_days`.
- Caso contrário (ou após expirar): insere as categorias normais (comportamento atual).

Para usuários que já existem e fazem login depois do período: ao receber webhook, se já existir trial expirado, garante que as categorias normais estão lá.

## Expiração automática

Função SQL `expire_trial_access()` que:
1. Para cada `user_category_access` com `is_trial=true` e `trial_expires_at < now()`: deleta esses registros.
2. Para cada `(user_id, hubsoft_config_id)` afetado: insere as categorias normais da integração (se ainda não tiver).

Como rodar:
- Função RPC chamada por edge function `expire-trials` (sem `verify_jwt`), agendada via cron do servidor a cada hora (já temos cron do `sync-logos` rodando).
- Adicionalmente, chamar a mesma função no início do webhook para limpar antes de aplicar regras.

## Botão manual “Aplicar a usuários existentes”

A função `syncCategoriesToExistingUsers` já existente passa a respeitar a flag de degustação:
- Se `trial_enabled`: aplica trial categories com expiração contada a partir de `now()` (ou opção “preservar data original”).
- Senão: comportamento atual (categorias normais).

Vou expor isso como **dois botões separados** na UI da integração:
- “Aplicar categorias normais” (atual)
- “Aplicar degustação aos existentes” (novo, só aparece se trial ativo)

## Detalhes técnicos

- Timezone: comparações em UTC, exibição em -3 (já é o padrão do projeto).
- `useChannels.ts` resolve canais por `user_category_access.is_active=true` — não precisa mexer; basta que a expiração delete/desative os registros de trial.
- Tipos do Supabase serão regenerados após a migration.

## Comandos pro servidor

Após aprovar: migration + build do frontend + deploy/cron da nova edge function `expire-trials`. Detalho na hora.

## Pergunta

Quando a degustação expira e a integração tem **zero categorias normais** cadastradas, qual o comportamento?
1. Bloqueia o usuário (sem canais).
2. Mantém as categorias da degustação (não expira até admin configurar).

Vou seguir com a opção **1** salvo se você responder o contrário.