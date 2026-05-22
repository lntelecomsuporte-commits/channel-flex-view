## Objetivo

Hoje, quando o APK abre, ele só tenta `device-auto-login` uma vez. Se falhar, fica parado na tela de login e o admin não sabe que aquele aparelho existe (a menos que o cliente leia o código manualmente).

Quero que **enquanto o usuário estiver na tela de login**, o APK envie um "beacon" periódico ao servidor anunciando seu `device_id` + modelo + IP. No painel admin, em **Dispositivos vinculados**, vai aparecer uma seção nova **"Aparelhos aguardando login"** com botão **Atualizar** para puxar a lista. Um clique vincula o aparelho ao usuário aberto. Quando o cliente loga, o APK para de mandar beacon.

## Mudanças

### 1. Banco — nova tabela `pending_devices`
- `device_id` (texto, UPPERCASE) + `platform` → chave única
- `device_name`, `app_version`, `last_ip`, `last_seen_at`, `first_seen_at`
- RLS: só admin lê. Insert/upsert via edge function (service role).
- Cleanup: registros com `last_seen_at < now() - 5 min` são considerados offline (filtrados na listagem; um cron simples ou DELETE quando ficar > 1 dia).

### 2. Edge function `device-announce` (nova)
- POST `{ device_id, platform, device_name, app_version }`
- Faz UPSERT em `pending_devices` (atualiza `last_seen_at`, `last_ip`).
- Se o device já estiver cadastrado em `user_devices`, **remove** o registro de `pending_devices` (não polui a lista).
- Resposta leve: `{ ok: true, registered: boolean }` — se `registered=true`, o APK pode parar o beacon e tentar `device-auto-login` de novo.

### 3. Frontend — `LoginPage.tsx`
- Após o `device-auto-login` inicial falhar (APK não cadastrado), inicia `setInterval` a cada **15s** chamando `device-announce`.
- Se a resposta indicar `registered=true`, dispara `device-auto-login` automaticamente e entra no app.
- Para o interval quando: login manual com sucesso, componente desmonta, ou app vai pra background.

### 4. Admin — `UserDevicesDialog.tsx`
- Nova seção **"Aparelhos aguardando login"** (acima dos já cadastrados), com botão **Atualizar**.
- Lista lê de `pending_devices` (últimos 5 min). Para cada item: modelo, IP, código mascarado, "visto há Xs", botão **Vincular a este usuário**.
- Vincular = INSERT em `user_devices` (com `device_id` já UPPERCASE) + DELETE em `pending_devices`.
- Filtro de plataforma igual ao card "online não cadastrados".

## Detalhes técnicos

- `pending_devices` é **global** (não tem `user_id`) — qualquer admin abrindo qualquer usuário vê os mesmos aparelhos. Isso é intencional: o admin escolhe a qual conta vincular.
- O beacon é mais barato que `device-auto-login` (sem geração de magiclink). É só upsert.
- Não criamos sessão nem token — o aparelho continua deslogado até o admin vincular.
- O frontend usa o mesmo padrão de `getLocalFunctionUrl()` que já existe.

## Fora do escopo

- Notificação push pro admin quando um novo aparelho aparece (pode ser realtime futuramente).
- Tela admin global de "todos os aparelhos aguardando" (vai ficar dentro do dialog por usuário por enquanto, conforme pedido).
