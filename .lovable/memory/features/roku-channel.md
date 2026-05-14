---
name: roku-channel
description: App Roku do LN TV em BrightScript, integrado ao mesmo workflow/release do APK Android
type: feature
---

# Roku Channel (LN TV)

App em BrightScript/SceneGraph dentro do mesmo repo do APK, na pasta `roku/`. Usa o mesmo backend Supabase via `https://tv2.lntelecom.net`.

## Build & Deploy

- Workflow: `.github/workflows/android-apk.yml` (compartilhado com APK).
- Trigger inclui `roku/**`.
- A cada push em `main`:
  - Bake do `build_version` no `roku/manifest` com `github.run_number`.
  - Empacota `roku/` em `out/lntv-roku.zip`.
  - Anexa no mesmo GitHub Release do APK.
  - `version.json` ganha campos `rokuVersionCode`, `rokuVersionName`, `rokuUrl`, `rokuNotes`.

## Servidor

`/usr/local/bin/sync-lntv-apk.sh` foi atualizado pra também baixar `lntv-roku.zip` do release pra `/opt/lntv-downloads/`. Cron 0 3 * * * já existente atende.

URL pública: `https://tv2.lntelecom.net/downloads/lntv-roku.zip` — mesma `location ^~ /downloads/` do nginx.

## Auto-update

Roku **não permite que app sideloaded se auto-instale** (limitação da plataforma). `roku/source/UpdateCheck.brs` fetch `/version.json` no boot da Home, compara `rokuVersionCode` com `roAppInfo.GetVersion()`, e mostra banner amarelo "Nova versão disponível — peça pro provedor". Atualização real exige re-upload manual via `http://<ip-do-roku>/`.

## Sideload

1. Roku dev mode: `Home×3, Up×2, Right, Left, Right, Left, Right`
2. http://<ip-roku>/ → Upload → seleciona `lntv-roku.zip` → Install
