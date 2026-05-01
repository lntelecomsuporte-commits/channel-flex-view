---
name: apk-downloads-location
description: APK auto-update — pasta downloads e version.json fora do webroot, em /opt/lntv-downloads/
type: feature
---

# Auto-update do APK Android

## Localização (FORA do webroot — imune ao rsync --delete do build)
- Pasta: `/opt/lntv-downloads/`
- Arquivos: `lntv-release.apk`, `version.json`, `lntv-release.json`
- Owner: `www-data:www-data`

## Script
- `/usr/local/bin/sync-lntv-apk.sh` — cron 0 3 * * * (diário 3h)
- Log: `/var/log/sync-lntv-apk.log`
- Baixa último GitHub Release de `lntelecomsuporte-commits/channel-flex-view`
- `DEST_DIR="/opt/lntv-downloads"`, `PUBLIC_VERSION="/opt/lntv-downloads/version.json"`

## nginx (`/etc/nginx/sites-enabled/tv2.lntelecom.net`)
```nginx
location = /version.json {
    alias /opt/lntv-downloads/version.json;
    add_header Cache-Control "no-store" always;
    add_header Access-Control-Allow-Origin "*" always;
    add_header Access-Control-Allow-Methods "GET, OPTIONS" always;
    default_type application/json;
}

location ^~ /downloads/ {
    alias /opt/lntv-downloads/;
    add_header Cache-Control "no-store" always;
    add_header Access-Control-Allow-Origin "*" always;
    autoindex off;
}
```

## ⚠️ ARMADILHAS

### 1. alias + try_files
NUNCA adicionar `try_files $uri =404;` em location com `alias` — bug clássico do nginx que retorna 404 mesmo com arquivo presente.

### 2. CORS obrigatório
APK Capacitor roda em `https://localhost` (WebView). Fetch pra `https://tv2.lntelecom.net/version.json` é **cross-origin** → bloqueia sem `Access-Control-Allow-Origin`. Sem isso o auto-update silenciosamente falha (`useAppUpdate` loga "fetch falhou").

## URLs públicas
- https://tv2.lntelecom.net/version.json
- https://tv2.lntelecom.net/downloads/lntv-release.apk

## Forçar sync manual
```bash
sudo /usr/local/bin/sync-lntv-apk.sh
```
