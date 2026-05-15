## Objetivo

Levar o channel Roku (`roku/`) à paridade funcional com o APK Android, sem ainda mexer em submissão de loja. Foco: usuário final consegue usar no Roku exatamente como usa no Android.

## Escopo (paridade com APK)

1. **Login por CPF (Hubsoft)** além de e-mail/senha
   - Toggle na tela de login (CPF | E-mail)
   - CPF gera login interno `cpf+<digitos>@lntelecom.local` (mesma regra do APK)
2. **EPG**
   - Fetch via `epg-proxy` edge function (mesma fonte do APK)
   - Cache em `roRegistry` por canal (TTL 1h)
   - OSD do player mostra: programa atual + próximo + barra de progresso
   - Botão **▲** na Home abre grid de timeline (categorias × tempo) — versão simplificada (3h visíveis)
3. **PIN adulto**
   - Antes de abrir canal com `is_adult=true`, pede PIN (`profiles.adult_pin`)
   - Diálogo numérico nativo Roku (`PinPad` / `KeyboardDialog` numérico)
   - Cache de "PIN ok" por 30min na sessão
4. **Heartbeat / kick global**
   - Task em background (`roSGNode Task`) chama `session-heartbeat` a cada 60s
   - Se `force_signout_at > login_at` ou usuário bloqueado → logout imediato + tela "Sessão encerrada"
5. **Busca de canais**
   - Botão **search** (controle Roku tem tecla dedicada) → `KeyboardDialog`
   - Filtra `m.channels` por nome/número em tempo real
6. **Trial / degustação**
   - Mostra badge "Degustação até DD/MM" nas categorias `is_trial=true`
   - Bloqueia automaticamente quando `trial_expires_at` passa (já tratado em `ResolveAllowedCategories`, falta só UI)
7. **Canais YouTube**
   - Detecta `stream_format='youtube'` ou URL `youtube.com/watch`
   - Extrai videoId e usa `roVideoNode` com `streamFormat="hls"` apontando pro endpoint do youtube-dl/proxy existente (ou abre via deep link do app YouTube oficial — fallback)
8. **Stats overlay** (opcional, baixa prioridade)
   - Tecla **⏯** no player mostra: bitrate, dropped frames, buffer (`m.video.streamingSegment`, `m.video.measuredBitrate`)
9. **Splash + ícones reais**
   - Substituir placeholders em `roku/images/` por arte real LN TV (logo vermelho, fundo escuro)
   - Gerar via imagegen: `icon_focus_hd.png` 290×218, `splash_hd.jpg` 1280×720, `splash_fhd.jpg` 1920×1080

## Arquitetura nova no Roku

```text
roku/
  components/
    HomeScene.{xml,brs}       (+ EPG OSD, busca, badge trial)
    LoginScene.{xml,brs}      (+ toggle CPF/email)
    PlayerScene.{xml,brs}     (+ EPG OSD, stats overlay)
    PinDialog.{xml,brs}       NEW
    SearchOverlay.{xml,brs}   NEW
    EpgGrid.{xml,brs}         NEW
    HeartbeatTask.{xml,brs}   NEW (Task node)
  source/
    EpgClient.brs             NEW  (fetch + cache via epg-proxy)
    Heartbeat.brs             NEW  (chama session-heartbeat)
    SupabaseAuth.brs          (+ SbLoginCpf, força logout em kick)
    SupabaseRest.brs          (+ FetchProfile pra adult_pin)
```

## Backend

Nada novo no Supabase — todas as edge functions e tabelas já existem (`epg-proxy`, `session-heartbeat`, `profiles.adult_pin`, `user_category_access.trial_expires_at`).

## Build / Deploy

Sem mudança no workflow nem no script `sync-lntv-apk.sh` — já estão prontos. Cada push em `main` empacota, anexa no release, e o cron do servidor publica em `https://tv2.lntelecom.net/downloads/lntv-roku.zip`. Usuários com app instalado verão o banner de "nova versão disponível" via `UpdateCheck.brs`.

## Ordem de execução

1. EpgClient + OSD do player com programa atual (maior valor pro usuário)
2. PIN adulto (bloqueio de segurança)
3. Heartbeat + kick global (paridade de segurança)
4. Login CPF (cobertura dos clientes Hubsoft)
5. Busca + badge trial + EPG grid
6. YouTube + stats overlay
7. Splash/ícones reais (visual final)

Cada etapa é um commit independente — pode testar no Roku via sideload sem esperar tudo.

## Fora de escopo agora

- Deep linking, trick play, closed captions, política de privacidade, screenshots de marketing, Roku Pay → tudo isso fica pra fase de submissão na loja.

## Pergunta antes de começar

Faço **tudo de uma vez** (1 commit grande, ~7 arquivos novos + 4 editados) ou **etapa por etapa** (você sideload e testa cada uma antes da próxima)?
