---
name: tizen-app
description: Samsung Tizen Web App pra Smart TVs — paridade com APK nativo, em tizen/
type: feature
---

# LN TV Tizen (Samsung Smart TV)

App nativo Tizen Web em `tizen/` — HTML/CSS/JS vanilla, sem React, sem build step.
Usa `webapis.avplay` (nativo Samsung) pra HLS/MP4. Reaproveita o backend self-hosted (`https://tv2.lntelecom.net`).

- Compat: Tizen 4.0+ (TVs 2018+).
- App ID: `LNTVtizen0.LNTV` (package `LNTVtizen0`).
- Ícone: 117x117 em `tizen/icon.png`.
- Auto-update: lê `/version-tizen.json` (campos `tizenVersionCode/Name/Url`).
- Sideload: Tizen Studio CLI (`tizen build-web` + `tizen package -t wgt -s LNTV`) → `sdb install` via Developer Mode (porta 26101) ou USB.
- Distribuição final: Samsung Apps TV Seller Office (mesmo `.wgt` assinado com perfil de distribuidor público).

## Servidor — depois do primeiro build

```bash
# Publicar .wgt + manifest
sudo cp LNTVtizen0.wgt /opt/lntv-downloads/lntv-tizen.wgt
sudo tee /opt/lntv-downloads/version-tizen.json >/dev/null <<'JSON'
{"tizenVersionCode":1,"tizenVersionName":"1.0.0","tizenUrl":"https://tv2.lntelecom.net/downloads/lntv-tizen.wgt"}
JSON
sudo chown www-data:www-data /opt/lntv-downloads/lntv-tizen.wgt /opt/lntv-downloads/version-tizen.json

# nginx: adicionar location pro version-tizen.json (igual ao version.json)
sudo nginx -t && sudo systemctl reload nginx
```

## Build NÃO interfere no Vite

A pasta `tizen/` é só assets estáticos — não tem `.ts/.tsx` e fica fora de `src/`, então o `npm run build` do frontend a ignora. Não copiar pra `/var/www/lntv/`.
