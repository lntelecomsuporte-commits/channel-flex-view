## Objetivo
Voltar o APK release para o estado da versão 216 (que estava 100% funcional) e isolar todos os experimentos de player nativo / SurfaceView / WebView transparente dentro da **Legacy Activity**, que já existe no projeto e tem poucos clientes, servindo como ambiente de teste para receptores problemáticos (TVSTICK / titan_p1, Allwinner/Rockchip, etc.).

## Mudanças

### 1. Reverter ao estado do APK 216 (main app)
Arquivos a restaurar para o comportamento de 216 (sem as tentativas de fix de tela preta):

- `android/app/src/main/res/layout/exo_texture_player_view.xml`
  - Voltar `surface_type="texture_view"` (como era em 216).
- `android/app/src/main/java/tv/lntelecom/net/NativePlayerPlugin.java`
  - Remover `setZOrderMediaOverlay(true)` e o import de `SurfaceView`.
  - Remover a lógica de WebView opaco/transparente baseada em `onRenderedFirstFrame` (voltar para o WebView sempre transparente, como 216).
- `src/components/player/NativeAndroidPlayer.tsx`
  - Remover watchdogs novos (10s timeout, 5s reload on error) que foram adicionados nas últimas iterações.
- `src/components/player/VideoPlayer.tsx`
  - Remover `ANDROID_NATIVE_PLAYER_DENYLIST` e helpers associados.
  - Voltar comportamento padrão do 216 (ExoPlayer ativo no Android nativo, sem denylist).

Resultado: APK release volta ao binário equivalente à v216, que o cliente já confirmou funcionar bem.

### 2. Canal Legacy para experimentar fix do TVSTICK
A `LegacyMainActivity` já existe no projeto (`android/app/src/main/java/tv/lntelecom/net/LegacyMainActivity.java`). Vamos transformá-la no nosso "canary" para receptores problemáticos:

- Garantir entrada separada no `AndroidManifest.xml` para `LegacyMainActivity` (ícone/atividade alternativa "LN TV Legacy") sem afetar a `MainActivity` principal.
- Criar uma flag de runtime `LEGACY_MODE` setada quando a atividade aberta for a Legacy. Pode ser exposta via:
  - parâmetro de query na URL do WebView (`?legacy=1`), ou
  - método nativo no plugin que devolve `legacy: true`.
- No `NativePlayerPlugin`, quando `LEGACY_MODE`:
  - Inflar layout alternativo `exo_legacy_player_view.xml` com `surface_type="surface_view"`.
  - Aplicar `setZOrderMediaOverlay(true)`.
  - Aplicar a lógica de WebView opaco até o primeiro frame.
- No frontend, quando `LEGACY_MODE`:
  - Habilitar watchdogs adicionais (10s startup, reload on error).
  - Marcar visualmente no canto que é build de teste (ex: badge "LEGACY" pequeno no menu).

Resultado: o APK principal fica idêntico ao 216. A versão Legacy carrega exatamente o mesmo frontend, mas com player configurado para tentar resolver tela preta em TVSTICK/titan_p1 e similares — exatamente o modelo que já usamos antes para Legacy.

### 3. Build e distribuição
- O workflow `.github/workflows/android-apk.yml` continua produzindo um único APK que contém **as duas atividades** (Main + Legacy). Cliente comum abre Main; cliente com receptor problemático abre o atalho Legacy.
- Atualizar `.lovable/plan.md` registrando a decisão.
- Atualizar a documentação interna (memória do projeto) marcando: "TVSTICK / titan_p1 / Allwinner kernel 4.9.170 → usar atalho Legacy".

## Detalhes técnicos
- `MainActivity` e `LegacyMainActivity` apontam para a mesma WebView/SPA; a diferença é só a flag passada.
- A flag pode ser lida no Java via `getIntent().getDataString()` ou um extra setado pela Activity, e exposta ao JS por um método simples do `NativePlayerPlugin` (`isLegacyMode`).
- O layout legacy fica em arquivo separado para não arriscar o caminho principal: `res/layout/exo_legacy_player_view.xml`.
- Nenhuma mudança em login, vinculação, EPG, OSD, listas, favoritos ou edge functions. Toda a alteração fica em código Android + condicional no `VideoPlayer.tsx` / `NativeAndroidPlayer.tsx`.

## O que NÃO muda
- Keystore release (continua a mesma — proibido gerar nova).
- Backend, Supabase, edge functions, nginx, sync-logos.
- Fluxo de auth, deviceId, hubsoft, EPG.

Após implementação: gerar novo APK pelo workflow, instalar no receptor bom (deve continuar perfeito via atalho Main) e no TVSTICK (testar via atalho Legacy).