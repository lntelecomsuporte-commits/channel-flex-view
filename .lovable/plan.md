## Problema
O build do APK falhou no GitHub Actions por erro de compilação Java:
```
NativePlayerPlugin.java:272: error: cannot find symbol
    wv.setBackgroundColor(transparent ? Color.TRANSPARENT : Color.BLACK);
                                        ^
  symbol:   variable Color
```
O import `android.graphics.Color` foi removido acidentalmente na mudança de SurfaceView para TextureView, mas ainda é usado no método `setWebViewTransparent()`.

## Solucao
Adicionar o import `android.graphics.Color` de volta no topo do arquivo `NativePlayerPlugin.java`.

## Arquivo alterado
- `android/app/src/main/java/tv/lntelecom/net/NativePlayerPlugin.java`

## Validacao
- Re-run do workflow GitHub Actions — build deve passar sem erros de compilacao.
