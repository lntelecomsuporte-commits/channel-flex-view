# App Assets

Substitua os arquivos abaixo para personalizar o ícone e splash do APK Android.

## Arquivos

- **`icon.png`** — Ícone do app, **1024x1024 px**, PNG. Será redimensionado automaticamente para todas as densidades Android (mdpi, hdpi, xhdpi, xxhdpi, xxxhdpi).
- **`splash.png`** — Tela de abertura, **2732x2732 px**, PNG. O conteúdo central deve estar dentro de um círculo de ~1200 px (área segura).

## Como atualizar

1. Substitua `resources/icon.png` e/ou `resources/splash.png` pelos seus arquivos
2. Faça commit e push para a branch `main`
3. O GitHub Action `Build Android APK` vai gerar automaticamente todas as variações e produzir um APK novo
4. Baixe o APK em **Actions → último run → Artifacts → lntv-debug-apk**

## Geração local (opcional)

Se quiser testar localmente antes de subir:

```bash
npx capacitor-assets generate --android
npx cap sync android
cd android && ./gradlew assembleDebug
```

O APK fica em `android/app/build/outputs/apk/debug/app-debug.apk`.
