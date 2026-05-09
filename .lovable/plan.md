## Melhorias de ícone/banner para Fire TV

Aplicar 4 etapas para reduzir o problema do ícone sumir após update no Fire TV.

### Etapa 1 — AndroidManifest.xml
Em `android/app/src/main/AndroidManifest.xml`, adicionar no `<application>`:
- `android:logo="@drawable/tv_banner"` (fallback usado por algumas telas do Fire OS)
- `android:appCategory="video"` (categoriza na trilha "Vídeo" do launcher)

### Etapa 2 — Banner xxxhdpi (Fire TV 4K)
Criar `android/app/src/main/res/drawable-xxxhdpi/tv_banner.png` em **640x360**, redimensionado a partir do banner existente (`drawable-xxhdpi/tv_banner.png` 960x540 ou do PNG fonte).

### Etapa 3 — Mipmap 432x432
Substituir em `android/app/src/main/res/mipmap-xxxhdpi/`:
- `ic_launcher.png` → 432x432
- `ic_launcher_round.png` → 432x432 (mesmo PNG, máscara redonda já é aplicada via XML adaptive)
- `ic_launcher_foreground.png` → 432x432

Gerados a partir de `resources/icon.png` (1024x1024) via redimensionamento.

### Etapa 4 — Workflow GitHub Actions
Em `.github/workflows/android-apk.yml`, após o passo `Generate Android icons & splash from resources/` (que roda `@capacitor/assets generate` e sobrescreve mipmaps), adicionar passo que **regrava** os arquivos xxxhdpi 432x432 e o banner xxxhdpi 640x360 — para que a otimização do Capacitor não os volte a 192x192.

Implementação: adicionar um step com Python+Pillow (já disponível no runner) que:
1. Pega `resources/icon.png` e gera `mipmap-xxxhdpi/{ic_launcher,ic_launcher_round,ic_launcher_foreground}.png` em 432x432
2. Pega o banner fonte e gera `drawable-xxxhdpi/tv_banner.png` em 640x360

Esse step roda **depois** do `cap sync` e **antes** do `gradlew assembleRelease`, tanto no build principal quanto no LEGACY.

---

### Resultado esperado
- APK novo com ícone e banner em alta resolução para Fire TV 4K
- Menor incidência de "ícone genérico" após update (não elimina 100% — é bug do Fire OS launcher; workaround manual continua sendo "Forçar parar" o app nas configurações)
- Sem mudança em backend, frontend web, ou banco

### Comandos pro servidor após o build
Nenhum no servidor — o GitHub Actions gera o APK automaticamente. Usuário baixa via auto-update do app ou manualmente em `https://tv2.lntelecom.net/downloads/lntv-latest.apk`.
