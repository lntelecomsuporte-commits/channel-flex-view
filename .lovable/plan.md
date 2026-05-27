## Causa

O `NativePlayerPlugin` usa `PlayerView` do Media3, que por padrão renderiza num **SurfaceView**. A WebView (UI HTML) fica por cima, transparente, e o vídeo deveria aparecer por baixo. Em vários Androids (TV boxes Allwinner/Rockchip, Android 7-9, alguns Xiaomi/Huawei) a WebView do Chromium não deixa a imagem do SurfaceView atravessar — áudio toca, UI aparece, vídeo fica preto.

Solução: trocar a superfície de renderização do ExoPlayer de SurfaceView pra **TextureView**. Mesmo player, mesma lib, só muda a composição com a UI HTML. TextureView é uma View normal do toolkit, respeita z-order, compõe corretamente com WebView transparente em todos os Androids 6+.

## Mudanças

### 1. `android/app/src/main/res/layout/exo_texture_player_view.xml` (novo)

```xml
<androidx.media3.ui.PlayerView
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="#000000"
    app:surface_type="texture_view"
    app:use_controller="false"
    app:resize_mode="fit" />
```

### 2. `android/app/src/main/java/tv/lntelecom/net/NativePlayerPlugin.java`

Em `ensurePlayer()`, em vez de `playerView = new PlayerView(getContext())`, inflar o layout acima:

```java
playerView = (PlayerView) LayoutInflater.from(getContext())
    .inflate(R.layout.exo_texture_player_view, decor, false);
playerView.setPlayer(player);
```

Remover o bloco `if (videoSurface instanceof SurfaceView) setZOrderMediaOverlay(true)` — não se aplica a TextureView. Resto (addView no index 0, listeners, resize mode) fica igual.

### 3. Nada muda em JS/TS

`NativeAndroidPlayer.tsx`, bridge do plugin e WebView continuam idênticos.

## Validação

- Build APK pelo workflow GitHub Actions.
- Testar em dispositivo afetado (que estava preto) → vídeo aparece.
- Testar em TV box que já funcionava (Fire TV / Mi Box) → sem regressão.
- Logs `[NativePlayer] load url=... type=hls` continuam batendo.

## Riscos

- TextureView consome um pouco mais de GPU que SurfaceView — desprezível em 1080p, TV plugada na tomada.
- Sem DRM Widevine L1 no app (não usamos), então sem impacto de degradação.
