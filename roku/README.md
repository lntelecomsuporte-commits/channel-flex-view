# LN TV — Roku Channel

App Roku do LN TV (BrightScript + SceneGraph). Consome o mesmo backend do APK Android (Supabase em `https://tv2.lntelecom.net`).

## Funcionalidades (v1)

- Login com e-mail e senha (mesmos cadastros do APK / web)
- Sessão persistente em `roRegistry` (não pede login toda vez)
- Lista de categorias respeitando `category_includes` (hierarquia) e `user_category_access` (Hubsoft + degustação)
- Lista de canais ordenada por `channel_number`
- Favoritos (★) — adicionar/remover com botão **info** do controle
- Player HLS via `roVideoNode` (com fallback pra `backup_stream_urls`)
- OSD com nome do canal e número
- Logout com botão **Voltar** na tela inicial

## Não inclui ainda (próximas iterações)

- EPG (programa atual + barra de progresso + sinopse)
- PIN adulto (`profiles.adult_pin`)
- Heartbeat / kick global (`session-heartbeat`, `force_signout_at`)
- Busca de canais
- Stats overlay
- Canais YouTube

## Sideload manual

1. Habilita developer mode no Roku: `Home×3, Up×2, Right, Left, Right, Left, Right`
2. Abre `http://<ip-do-roku>` no navegador (porta 80, login `rokudev` + senha que você definiu)
3. Faz upload do `lntv-roku.zip` em **Upload** → **Install**

Pronto, app aparece no menu inicial do Roku.

## Build local

```bash
zip -r lntv-roku.zip manifest source components images
```

## Deploy automático (GitHub Actions)

Cada push em `main` gera um Release com `lntv-roku.zip` anexado.
Depois, no servidor, basta:

```bash
curl -L -o /opt/lntv-downloads/lntv-roku.zip \
  https://github.com/<seu-user>/<repo>/releases/latest/download/lntv-roku.zip
```

E adicionar no nginx (mesmo padrão do APK):

```nginx
location = /downloads/lntv-roku.zip {
    alias /opt/lntv-downloads/lntv-roku.zip;
    add_header Cache-Control "no-store" always;
}
```

URL pública pros clientes baixarem: `https://tv2.lntelecom.net/downloads/lntv-roku.zip`

## Imagens necessárias

Substitua os placeholders em `images/`:

- `icon_focus_hd.png` — 290×218 (ícone do canal)
- `splash_hd.jpg` — 1280×720 (splash de abertura)

## Controles

| Tela | Botão | Ação |
|---|---|---|
| Login | OK | Abre teclado virtual no campo ativo |
| Login | ▲▼ | Alterna e-mail / senha |
| Login | ▶ | Faz login |
| Login | ⏪ | Limpa o campo |
| Home | ◀ ▶ | Alterna coluna categorias / canais |
| Home | OK | Abre o canal |
| Home | info (★) | Adiciona/remove dos favoritos |
| Home | Voltar | Sai (logout) |
| Player | OK / info | Mostra OSD |
| Player | Voltar | Volta pra lista |
