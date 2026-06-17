# App Assets

Substitua os arquivos abaixo para personalizar o ícone e splash do APK Android.

## Arquivos

- **`icon.png`** — Ícone do app, **1024x1024 px**, PNG. Fundo branco com a logo centralizada. Será redimensionado automaticamente para todas as densidades Android (mdpi, hdpi, xhdpi, xxhdpi, xxxhdpi).
- **`icon-foreground.png`** — Foreground transparente do ícone adaptativo, **1024x1024 px**, PNG. Usado pelo Android 8+ para máscaras de ícone.
- **`splash.png`** — Tela de abertura, **2732x2732 px**, PNG. Fundo branco com a logo centralizada dentro da área segura.

## Como atualizar

1. Substitua `resources/icon.png`, `resources/icon-foreground.png` e/ou `resources/splash.png` pelos seus arquivos
2. Faça commit e push para a branch `main`
3. O GitHub Action `Build Android APK` vai gerar automaticamente todas as variações e produzir um APK novo
4. Baixe o APK em **Actions → último run → Artifacts → lntv-release-apk**

## Geração local (opcional)

Se quiser testar localmente antes de subir:

```bash
npm install --no-save @capacitor/assets
npx @capacitor/assets generate --android --assetPath resources
npx cap sync android
cd android && ./gradlew assembleDebug
```

O APK fica em `android/app/build/outputs/apk/debug/app-debug.apk`.

