
# Plano — App Samsung Tizen (Smart TV) — paridade com APK Nativo

Começamos pela **Samsung Tizen** (compatível a partir do Tizen 4.0 / 2018+). O app será um **Tizen Web Application** novo, pasta `tizen/` na raiz do projeto, escrito em HTML/CSS/JS vanilla (sem React) — assim fica leve, roda em TVs antigas e usa diretamente o `AVPlay` nativo do Tizen pra player. Reaproveita 100% do backend já existente (Supabase self-hosted + edge functions).

## 1. Estrutura do projeto

```text
tizen/
├── config.xml                  # manifest Tizen (app id, privilégios, versão min)
├── icon.png                    # 117x117
├── index.html                  # SPA shell (login + canais + player)
├── css/
│   └── app.css                 # dark, primary #dc2626
├── js/
│   ├── config.js               # BACKEND host, anon key (igual stream.ts)
│   ├── keys.js                 # mapa VK_* Tizen → ação
│   ├── storage.js              # wrapper localStorage (tokens, prefs)
│   ├── device.js               # webapis.productinfo.getDuid()
│   ├── supabase.js             # REST + Auth (fetch puro, sem SDK)
│   ├── auth.js                 # device-announce / device-auto-login / device-login
│   ├── channels.js             # carrega categorias + canais + favoritos
│   ├── epg.js                  # fetch XMLTV + parse + cache 10min
│   ├── player.js               # webapis.avplay + retry/stall + tracks
│   ├── osd.js                  # OSD canal/EPG, lista, preview
│   ├── menu.js                 # menu lateral (senha, PIN, sobre, stats)
│   ├── voice.js                # Web Speech API (se disponível) + parser pt-BR
│   ├── heartbeat.js            # session-heartbeat 30s
│   ├── update.js               # version-tizen.json + tizen.package install
│   └── logos.js                # cache de logos em IndexedDB
└── README.md                   # instruções sideload + build
```

## 2. Features (paridade com APK nativo)

| Feature | Implementação Tizen |
|---|---|
| Login CPF/senha + auto-login por device pairing | `webapis.productinfo.getDuid()` formatado `XXXX-XXXX-XXXX` exibido na tela. Beacon 10s pra `device-announce` + `device-auto-login`. Botão manual chama `device-login`. |
| Splash/branding LN TV | Tela inicial com logo + código de pareamento + status |
| Lista de canais ordenada por `channel_number` ASC | Mesmo REST: `user_category_access` → `category_includes` → `categories` → `channels`. Inicia no menor canal (index 0). |
| Favoritos | Tabela `user_favorites`, tecla amarela ou ⭐ — ver mapa de teclas |
| Player HLS/MP4 | **`webapis.avplay`** (nativo Tizen, leve e acelerado). Suporta HLS direto. Fallback `<video>` HTML5 só pra MP4 se AVPlay falhar. |
| Proxy HLS | Mesmo `hls-proxy` quando `force_proxy_native=true` ou após erro HTTP |
| Retry/stall | Backoff 1→2→4→8s, sonda lenta 30s, hard reset após 8s buffering |
| OSD canal + EPG atual/próximo | Overlay HTML, 4s, com logo + número + nome + programas |
| Lista overlay (OK duplo <400ms) | `<ul>` com navegação D-PAD manual |
| Preview de canal (→/←) com commit 1500ms | Timer + sintoniza ao expirar ou no OK |
| Troca por número (0–9) com commit 2000ms ou OK | Buffer de até 4 dígitos |
| Cycle áudio (🟡 amarelo / `VK_AUDIO`) | `avplay.getTotalTrackInfo()` + `avplay.setSelectTrack('AUDIO', i)` |
| Cycle legenda (🔵 azul / `VK_CAPTION`) | `setSelectTrack('TEXT', i)` com estado off |
| Menu (tecla MENU) | Trocar senha (`PUT /auth/v1/user`), trocar PIN adulto (`PATCH profiles`), Sobre (versão + DUID + modelo via `tizen.systeminfo`) |
| Estatísticas (Konami →→→←←→ OK) | Overlay com resolução, bitrate, codec, buffer (`avplay.getCurrentStreamInfo()`) |
| Heartbeat 30s | Mesmo edge function `session-heartbeat`, `platform:"tizen"` |
| Auto-update | `GET /version-tizen.json` (novo arquivo no servidor) com `tizenVersionCode/Name/Url`. Download `.wgt` → `tizen.package.install()` com listener de progresso |
| Voz pt-BR | Tenta `webkitSpeechRecognition` (Tizen 5.5+); se ausente, mostra toast "Comando de voz indisponível nesta TV". Parser reaproveita lógica do `VoiceCommandParser.kt` (porta JS) |
| Logos com cache | Fetch + IndexedDB; fallback `logo_source_url`; SVG suportado nativamente |
| Screen OFF | `document.addEventListener('visibilitychange')` + `tizen.application.getCurrentApplication().exit()` |
| Keep awake | `tizen.power.request('SCREEN', 'SCREEN_NORMAL')` |
| Back 3× pra sair | Mesmo contador 1800ms |
| Bloqueio canal adulto (PIN) | Reaproveita `profiles.adult_pin` — modal HTML antes de sintonizar `is_adult=true` |

## 3. Mapeamento de teclas (Samsung VK_*)

| VK | Tecla controle | Ação |
|---|---|---|
| 38/40 (ArrowUp/Down) + 427/428 (`VK_CHANNEL_UP/DOWN`) | ↑↓ / CH+/− | Canal +/− imediato |
| 37/39 (ArrowLeft/Right) | ←/→ | Preview canal +/− |
| 13 (`VK_ENTER`) | OK | OSD / duplo abre lista / confirma preview |
| 10009 (`VK_BACK`) | ← (return) | Volta / 3× sai |
| 18 (`VK_MENU`) ou 457 (`VK_INFO`) | Menu/Info | Menu lateral |
| 48–57 | 0–9 | Buffer numérico |
| 403 (`VK_RED`) | 🔴 | Favorito |
| 404 (`VK_GREEN`) | 🟢 | (reservado p/ EPG grid futuro) |
| 405 (`VK_YELLOW`) | 🟡 | Cycle áudio |
| 406 (`VK_BLUE`) | 🔵 | Cycle legenda |
| 10225 (`VK_CC`) | CC | Cycle legenda |
| (controle Smart com mic) | 🎤 | Voz (se suportado) |

Observação: troquei o favorito pra **vermelho** (mais convencional em STBs/TVs) já que `STAR/BOOKMARK` não existem no controle Samsung. Você quer manter assim ou mover pra outro botão?

## 4. Backend — único arquivo novo

- Criar `version-tizen.json` em `/opt/lntv-downloads/` (mesmo padrão do APK) com `{tizenVersionCode, tizenVersionName, tizenUrl}` apontando pro `.wgt` mais recente.
- Servir `/downloads/lntv-tizen.wgt` (já cai no `location ^~ /downloads/` existente).
- Nenhuma migration de DB necessária — todas as tabelas (`channels`, `user_favorites`, `profiles`, `user_category_access`, etc.) e edge functions (`device-*`, `session-heartbeat`, `hls-proxy`, `epg-proxy`) já existem e respeitam RLS.
- `session-heartbeat` aceita `platform:"tizen"` (string livre, já passa pelo banco).

## 5. Build, assinatura e sideload (fase teste)

Tudo via **Tizen Studio CLI** (`tizen` e `sdb`), instalável no servidor de build (Linux) ou na máquina local.

```bash
# 1. Gerar perfil de assinatura uma vez (autor + distribuidor "Samsung TV Public")
tizen certificate -a LNTV -p lntv2026 -f LNTV
tizen security-profiles add -n LNTV -a ~/tizen-keys/LNTV.p12 -p lntv2026

# 2. Build do .wgt (a partir de tizen/)
tizen build-web -- tizen/
tizen package -t wgt -s LNTV -- tizen/.buildResult

# 3. Sideload via USB ou IP (Developer Mode da TV: 12345 no app Apps)
sdb connect <IP_DA_TV>:26101
sdb -s <IP_DA_TV>:26101 install lntv-tizen.wgt
sdb -s <IP_DA_TV>:26101 shell 0 vd_appcontrol launch tv.lntelecom.tizen
```

- USB stick: Samsung permite instalar `.wgt` colocando-o na raiz de um pendrive em TVs em Developer Mode (caminho varia por modelo).
- Workflow GitHub Actions opcional `.github/workflows/tizen-app.yml` (fase 2) pra rodar `tizen package` automaticamente no push e anexar `.wgt` ao Release — espelha o que já existe pro APK.

## 6. Distribuição final (Samsung Apps TV — depois da aprovação)

Após validar nas TVs em campo:
1. Conta Samsung Apps TV Seller Office (gratuita).
2. Submeter o mesmo `.wgt` assinado com perfil de distribuidor "Public".
3. Preencher metadados (PT-BR, screenshots 1920x1080, ícone 512x512, classificação livre).
4. Aprovação leva 2–4 semanas. Enquanto isso continua funcionando via Developer Mode.

## 7. O que NÃO entra nesta fase

- LG webOS (próxima rodada, depois que Tizen estiver estável).
- Grid de EPG visual (tecla verde) — fica como gancho mapeado mas sem UI ainda.
- Wake word de voz.
- Tradução pra outros idiomas (só pt-BR).

---

## Confirmações antes de começar a implementação

1. **Tecla de favorito** no Samsung: 🔴 **vermelho** (proposta) ou prefere outro botão?
2. **App ID Tizen**: posso usar `tv.lntelecom.tizen` (segue o padrão `tv.lntelecom.net` / `tv.lntelecom.nativo`)?
3. **Tizen Studio**: você instala localmente / na sua máquina pra rodar o `sdb install`, ou quer que eu prepare também o workflow GitHub Actions já nesta fase pra gerar o `.wgt` assinado automaticamente?
