# APK "slim" experimental — sem tocar nos APKs em produção

Em vez de alterar `lntv-latest.apk` e `lntv-legacy.apk` direto, vamos gerar um **terceiro APK** chamado `lntv-slim.apk` no mesmo workflow do GitHub Actions, com as otimizações aplicadas. Assim você instala manualmente, testa em algumas TVs, e só depois decidimos promover.

## O que muda

### 1. Novo job/step no `.github/workflows/android-apk.yml`
Depois dos passos atuais que geram `lntv-latest.apk` (Android 6+) e `lntv-legacy.apk` (Android 5+), adicionar um **terceiro passo** que reusa o mesmo projeto Android mas aplica:

- **Limpar `android/app/src/main/assets/public/`** antes do `assembleRelease`, deixando só um `index.html` placeholder mínimo (o WebView nunca usa esses arquivos porque `capacitor.config.ts` tem `server.url` apontando pro site).
- **Ativar R8/minify/shrinkResources** sobrescrevendo o `build.gradle` apenas para esse build:
  ```gradle
  release {
    minifyEnabled true
    shrinkResources true
    proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
  }
  ```
- **Adicionar regras ProGuard** em `android/app/proguard-rules.pro` (`-keep`) para:
  - `com.getcapacitor.**` (Capacitor core + bridge)
  - `androidx.media3.**` (ExoPlayer)
  - `tv.lntelecom.net.NativePlayerPlugin`, `DeviceInfoPlugin`, `PlaybackKeepAlivePlugin`, `PlaybackKeepAliveService`, `MainActivity`, `LegacyMainActivity`, `TvLauncherActivity*`
  - Plugins Capacitor instalados (App, Filesystem se mantido, etc.)
- Manter mesmo `versionCode`/`versionName` dos outros dois (pra não bagunçar o auto-update).
- Output: `out/lntv-slim-${{ github.run_number }}.apk` + cópia `out/lntv-slim.apk`.
- Subir no GitHub Release junto com os outros, **sem alterar `version.json`** (auto-update continua apontando pro `lntv-latest.apk`).

### 2. Disponibilizar pra download manual
`lntv-slim.apk` fica disponível em:
- GitHub Release (anexo do release)
- `https://tv2.lntelecom.net/downloads/lntv-slim.apk` (depois do rsync no servidor, manual ou via cron)

### 3. O que NÃO muda nessa fase
- `lntv-latest.apk` e `lntv-legacy.apk` continuam **idênticos** ao que está hoje.
- Auto-update dos clientes existentes **não é afetado** — `version.json` segue apontando pro `lntv-latest.apk`.
- Frontend (`src/**`) **não muda nada nessa fase**. As otimizações da lista de canais (`content-visibility`, EPG em IndexedDB) ficam pra fase 2, só depois de você validar o slim.

## Como você vai testar
1. Esperar o GitHub Actions terminar o build (~5 min).
2. Baixar `lntv-slim.apk` do release ou do `/downloads/`.
3. Instalar manualmente em 1–2 TVs (a problemática + uma normal).
4. Verificar:
   - Tamanho do arquivo (esperado: ~4–4.5 MB vs ~9 MB atual).
   - App abre normalmente, login funciona.
   - Player toca canais (HLS e MP4).
   - Lista de canais abre.
   - EPG aparece.
   - Auto-update **não** dispara (porque o `versionCode` é o mesmo dos outros e o `version.json` aponta pro `latest`).

## Resultado esperado do slim
- Tamanho APK: **~4–4.5 MB** (de ~9 MB).
- Funcionalidade: idêntica ao `lntv-latest.apk`.
- Risco: se R8 quebrar algum plugin via reflection, descobrimos no slim sem afetar ninguém em produção.

## Próximos passos (só depois do seu OK no slim)
- Se slim funcionar perfeito → promover virando o novo `lntv-latest.apk`.
- Se funcionar mas algo quebrar → ajustar regras ProGuard e regerar.
- Depois disso, fase 2: otimizar lista de canais e EPG no frontend.

## Comandos pro servidor (depois do build)
```bash
# Baixar o APK slim do último release pro servidor:
cd /var/www/lntv/downloads
curl -L -o lntv-slim.apk https://github.com/<owner>/<repo>/releases/latest/download/lntv-slim.apk
ls -lh lntv-slim.apk
```
