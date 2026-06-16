# LN TV — Samsung Tizen Web App

App nativo do LN TV pra Smart TVs Samsung (Tizen 4.0+, modelos 2018 em diante).
Web App "puro" (HTML/CSS/JS vanilla) que usa diretamente `webapis.avplay` pra HLS/MP4 — sem React, sem bundler, sem dependências.

Reaproveita 100% do backend self-hosted do LN TV (Supabase em `https://tv2.lntelecom.net`).

## Estrutura

```
tizen/
├── config.xml        manifest Tizen (app id, privilégios, versão mínima 4.0)
├── icon.png          ícone 117x117 (substitua pelo definitivo)
├── index.html        SPA shell
├── css/app.css       dark theme primary #dc2626
└── js/               módulos vanilla
    ├── config.js     BACKEND, ANON_KEY, versão do app
    ├── keys.js       mapa Samsung VK_* → ação
    ├── storage.js    wrapper localStorage
    ├── device.js     DUID via webapis.productinfo
    ├── supabase.js   REST/Auth via fetch
    ├── auth.js       device-announce / device-auto-login / device-login
    ├── channels.js   carrega categorias, canais, favoritos
    ├── epg.js        XMLTV parser + cache 10min
    ├── heartbeat.js  session-heartbeat 30s
    ├── osd.js        OSD canal, lista, toast, buffer numérico
    ├── menu.js       menu lateral + modal + stats
    ├── voice.js      Web Speech API + parser pt-BR
    ├── update.js     version-tizen.json + tizen.package.install
    ├── player.js     AVPlay + retry/stall + audio/legenda
    └── app.js        bootstrap, screens, router de teclas
```

## Controle remoto

| Tecla | Ação |
|---|---|
| ↑ ↓ / CH+ CH− | Trocar canal |
| ← → | Preview canal (commit 1.5s) |
| OK | OSD (duplo abre lista, confirma preview) |
| 0–9 | Digitar número do canal |
| 🔴 vermelho | Favoritar canal atual |
| 🟢 verde | (reservado pra EPG grid) |
| 🟡 amarelo / AUDIO | Trocar trilha de áudio |
| 🔵 azul / CC | Trocar legenda |
| MENU / INFO / TOOLS | Abrir menu (senha, PIN, sobre, stats, sair) |
| VOLTAR 3× | Sair do app |
| EXIT | Sair do app |
| 🎤 (Smart remote) | Comando de voz pt-BR |

Konami → → → ← ← → OK (4s) abre overlay de estatísticas.

## Comandos de voz suportados

- "canal 23" / "vinte e três" / "23" → sintoniza
- "globo" / "esporte interativo" → fuzzy match por nome
- "áudio" / "som" / "trilha" → trocar áudio
- "legenda" / "cc" / "subtítulo" → trocar legenda
- "desligar" / "sair" → fecha o app

## Build local (Tizen Studio CLI)

```bash
# 1. Criar certificado uma vez
tizen certificate -a LNTV -p lntv2026 -f LNTV
tizen security-profiles add -n LNTV -a ~/tizen-keys/LNTV.p12 -p lntv2026

# 2. Build do .wgt a partir desta pasta
cd tizen/
tizen build-web -- .
tizen package -t wgt -s LNTV -- .buildResult

# Resultado: LNTVtizen0.wgt (ou similar)
```

## Sideload via IP (Developer Mode)

1. Na TV: app "Apps" → digite 12345 → ative Developer Mode → informe o IP do PC.
2. No PC:
   ```bash
   sdb connect <IP_DA_TV>:26101
   sdb -s <IP_DA_TV>:26101 install LNTVtizen0.wgt
   ```
3. Lançar:
   ```bash
   sdb -s <IP_DA_TV>:26101 shell 0 vd_appcontrol launch LNTVtizen0.LNTV
   ```

## Sideload via USB

Em modelos compatíveis (varia por ano):

1. Em Developer Mode habilitado, copie `LNTVtizen0.wgt` pra raiz de um pendrive (FAT32).
2. Plugue o pendrive na TV → app aparece para instalar.

## Auto-update

Ao abrir, o app busca `https://tv2.lntelecom.net/version-tizen.json`:

```json
{
  "tizenVersionCode": 2,
  "tizenVersionName": "1.0.1",
  "tizenUrl": "https://tv2.lntelecom.net/downloads/lntv-tizen.wgt"
}
```

Se `tizenVersionCode` > local OU `tizenVersionName` diferente → baixa via `tizen.download` e instala via `tizen.package.install`.

## Servidor — arquivos a publicar

```bash
sudo cp LNTVtizen0.wgt /opt/lntv-downloads/lntv-tizen.wgt
sudo tee /opt/lntv-downloads/version-tizen.json >/dev/null <<'JSON'
{
  "tizenVersionCode": 1,
  "tizenVersionName": "1.0.0",
  "tizenUrl": "https://tv2.lntelecom.net/downloads/lntv-tizen.wgt"
}
JSON
sudo chown www-data:www-data /opt/lntv-downloads/lntv-tizen.wgt /opt/lntv-downloads/version-tizen.json
```

E adicionar no nginx (`/etc/nginx/sites-enabled/tv2.lntelecom.net`):

```nginx
location = /version-tizen.json {
    alias /opt/lntv-downloads/version-tizen.json;
    add_header Cache-Control "no-store" always;
    add_header Access-Control-Allow-Origin "*" always;
    default_type application/json;
}
```

(O `location ^~ /downloads/` já existente cobre o `.wgt`.)

## Distribuição final (Samsung Apps TV Seller Office)

1. Cadastro gratuito em https://seller.samsungapps.com
2. Submeter `LNTVtizen0.wgt` assinado com perfil de **distribuidor público**.
3. Metadados PT-BR, screenshots 1920×1080, ícone 512×512.
4. Aprovação 2–4 semanas. Enquanto isso, segue via Developer Mode.
