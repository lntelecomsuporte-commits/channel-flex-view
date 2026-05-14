# App LN TV para Roku

Roku **não roda APK, JS ou WebView**. A plataforma usa BrightScript + SceneGraph (XML), então o app é um projeto totalmente novo num **repositório separado** — não dá pra reusar nada do React/Capacitor. A boa notícia: o backend (Supabase + nginx + HLS aberto) já está pronto e o app Roku consome as mesmas APIs REST.

## Repositório novo

`channel-flex-view-roku` (separado do projeto Lovable). Lovable não edita BrightScript — você vai precisar manter esse repo no GitHub manualmente ou via outro editor. Posso gerar o código completo aqui em texto pra você commitar.

```
channel-flex-view-roku/
├── manifest                    # metadados do channel (versão, nome, ícones)
├── source/
│   ├── main.brs                # entrypoint
│   ├── SupabaseAuth.brs        # POST /auth/v1/token + refresh
│   ├── SupabaseRest.brs        # GET channels, categories, favorites, EPG
│   ├── Heartbeat.brs           # session-heartbeat a cada 60s
│   └── Utils.brs
├── components/
│   ├── LoginScene.xml + .brs   # email + senha
│   ├── HomeScene.xml + .brs    # categorias + lista de canais + EPG
│   ├── PlayerScene.xml + .brs  # roVideo (HLS nativo)
│   ├── FavoritesRow.xml
│   ├── CategoryGrid.xml
│   ├── ChannelTile.xml         # com logo + número
│   ├── EpgOsd.xml              # programa atual + barra de progresso
│   ├── PinDialog.xml           # PIN adulto
│   └── SettingsScene.xml       # logout, info de versão
├── images/
│   ├── icon_focus_hd.png       # 290x218
│   ├── icon_side_hd.png        # 108x69
│   └── splash_hd.jpg           # 1280x720
└── .github/workflows/
    └── roku-package.yml        # zipa o channel a cada push
```

## Funcionalidades (paridade Android)

| Feature Android | Equivalente Roku |
|---|---|
| Login email/senha (Supabase Auth) | `LoginScene` faz POST `/auth/v1/token?grant_type=password` |
| Persistência de sessão | `roRegistrySection("LNTV")` salva access_token + refresh_token |
| Lista de canais | GET `/rest/v1/channels?is_active=eq.true` |
| Categorias hierárquicas (`category_includes`) | Resolvido client-side em BrightScript |
| Acesso por usuário (`user_category_access` + Hubsoft) | GET filtrado por `user_id`; respeita `is_trial`, `trial_expires_at`, `is_active` |
| Favoritos | GET/POST/DELETE `/rest/v1/user_favorites` |
| Player HLS | `roVideoNode` (suporte HLS nativo no Roku) |
| EPG (OSD com programa atual + barra) | Mesmo edge function `epg-proxy`, parse XMLTV |
| Sinopse | Modal `EpgSynopsisDialog` |
| PIN adulto | `PinDialog` lê `profiles.adult_pin` |
| Heartbeat / kick global | `session-heartbeat` a cada 60s; checa `force_signout_at` no profile |
| Bloqueio (`profiles.is_blocked`) | Heartbeat retorna 401 → volta pra login |
| Degustação | Mesma lógica do Android (filtro client-side por `trial_expires_at > now`) |
| Atualização automática do app | **Channel Store/Beta** atualiza sozinho — não precisa de `version.json` nem download manual de APK |
| Busca de canais | `KeyboardDialog` do Roku |
| Stats overlay | `roDeviceInfo` + métricas do `roVideoNode` |

Sem suporte: YouTube embed (iframe não existe no Roku — pra canais YouTube precisaria parsear o ID e chamar a API do YouTube ou pular esses canais), Capacitor APIs (irrelevantes).

## Autenticação reaproveitando cadastros atuais

```brightscript
' POST direto pra https://tv2.lntelecom.net/auth/v1/token?grant_type=password
' Headers: apikey + Content-Type
' Body: { "email": user, "password": pass }
' Resposta: { access_token, refresh_token, expires_in, user }
' Salva no roRegistry; usa Bearer em todas as chamadas REST
```

Mesmo email/senha do APK funciona — Supabase é o mesmo.

## Player

`roVideoNode` toca HLS direto (sem Hls.js). Stream URL vai com Bearer token nos headers se for proxy autenticado, ou aberto direto se for o caso. Mapeamento `stream_format`:
- `hls` / `auto` → `streamFormat = "hls"`
- `mp4` → `streamFormat = "mp4"`

Backup streams (`backup_stream_urls`) entram como `Content.streamUrls` array — Roku tenta sequencialmente em caso de falha.

## Distribuição via sideload (escolhido)

1. **Conta de developer Roku gratuita** (não precisa pagar): habilitar developer mode em qualquer Roku digitando `Home×3, Up×2, Right, Left, Right, Left, Right` no controle.
2. GitHub Action `roku-package.yml` zipa `manifest + source + components + images` em `lntv-roku.zip` a cada push pra `main`.
3. Cliente acessa `http://<ip-do-roku>` no navegador (porta 8060 do dev server), faz upload do zip → instala.
4. Pra atualizar: novo zip, mesmo upload. Roku substitui sem perder a sessão (registry persiste).
5. Hospedo o `lntv-roku.zip` em `https://tv2.lntelecom.net/downloads/lntv-roku.zip` (mesmo padrão do APK) — clientes baixam de lá.

Sem submissão pública, sem aprovação Roku, sem custo.

## Plano de execução

Como Lovable não compila BrightScript, eu entrego o código pronto em mensagens (você commita no novo repo). Ordem sugerida:

1. **Esqueleto + Login + lista de canais simples** (MVP que já toca canal) — uma resposta minha
2. **Categorias hierárquicas + favoritos + busca** — segunda iteração
3. **EPG + OSD + sinopse + PIN adulto** — terceira iteração
4. **Heartbeat + kick global + degustação** — quarta iteração
5. **GitHub Action de build + script de hospedagem do .zip no servidor** — última

Cada etapa testável no Roku em minutos via dev server.

## O que preciso de você antes de começar

- Confirmação pra eu seguir gerando o código BrightScript em texto (Lovable não tem suporte nativo a `.brs`/`.xml` Roku).
- Nome do novo repo no seu GitHub (sugestão: `channel-flex-view-roku`).
- Você tem um Roku físico pra testar, ou vai testar só nos clientes finais?
