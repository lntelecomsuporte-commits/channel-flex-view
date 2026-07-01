# Fix: canais com vídeo verde/faixas no Android (ex.: TV Senado)

## Diagnóstico

Áudio ok + vídeo verde com faixas apenas no APK Android (funciona no navegador) = bug do **decoder H.264 por hardware** (MediaCodec) do receptor com esse stream. Causas típicas: 1080i entrelaçado, perfil High incomum, ou SEI/B-frames que travam o decoder HW do chip (Amlogic/MTK/Fire TV). O navegador não sofre porque usa decoder de software.

Solução: permitir marcar canais problemáticos para o ExoPlayer preferir **decoder de software** (OMX.google.* / c2.android.*). Fica cirúrgico — só quem precisa paga o custo de CPU.

## Escopo

Aplicar nos dois APKs: `android/` (Capacitor release) e `android-native/`.

## Passos

### 1. Banco (migration)

- `ALTER TABLE public.channels ADD COLUMN prefer_sw_decoder boolean NOT NULL DEFAULT false;`

### 2. Admin UI

- Em `src/components/admin/` (form de canal): adicionar checkbox **"Preferir decoder de software (H.264)"** com dica "Marque se o vídeo aparece verde/com faixas no Android".
- Persistir `prefer_sw_decoder` junto com os outros campos.

### 3. Bridge JS → plugin nativo

- `src/plugins/native-player.ts`: adicionar `preferSoftwareDecoder?: boolean` em `NativePlayerLoadOptions`.
- `src/components/player/NativeAndroidPlayer.tsx`: aceitar prop `preferSoftwareDecoder` e repassar em `NativePlayer.load({...})`.
- `src/pages/PlayerPage.tsx` (ou onde o canal é resolvido pro player): passar `channel.prefer_sw_decoder` para o `NativeAndroidPlayer`.

### 4. Plugin nativo Capacitor (`android/`)

Em `android/app/src/main/java/tv/lntelecom/net/NativePlayerPlugin.java`:

- Ler `preferSoftwareDecoder` do call em `load(...)`.
- Se true, construir o `ExoPlayer.Builder` com um `DefaultRenderersFactory` configurado com:
  - `setEnableDecoderFallback(true)`
  - `setMediaCodecSelector(preferSoftwareSelector)` — selector customizado que reordena a lista de `MediaCodecInfo` para colocar antes os decoders cujo `name` começa com `OMX.google.`, `c2.android.` ou contém `.sw.` / `.software`.
- Se false (default), comportamento atual (HW).

### 5. android-native (`android-native/`)

Espelhar a mesma lógica no player Kotlin:
- Ler `channel.preferSwDecoder` do modelo `Channel`.
- Adicionar `preferSwDecoder: Boolean = false` no `data class Channel` e no mapeamento do repositório.
- Aplicar o mesmo `DefaultRenderersFactory` + selector custom ao montar o `ExoPlayer`.

### 6. Marcar TV Senado

Após deploy, o admin marca o canal TV Senado (e outros que apresentarem o mesmo sintoma) no painel.

## Detalhes técnicos

```java
// Selector: coloca SW decoders na frente
MediaCodecSelector preferSw = (mimeType, requiresSecure, requiresTunneling) -> {
    List<MediaCodecInfo> list = new ArrayList<>(
        MediaCodecSelector.DEFAULT.getDecoderInfos(mimeType, requiresSecure, requiresTunneling)
    );
    Collections.sort(list, (a, b) -> Boolean.compare(isHw(b.name), isHw(a.name))); // SW antes
    return list;
};
static boolean isHw(String n) {
    String s = n.toLowerCase();
    return !(s.startsWith("omx.google.") || s.startsWith("c2.android.") || s.contains(".sw."));
}

RenderersFactory rf = new DefaultRenderersFactory(ctx)
    .setEnableDecoderFallback(true)
    .setMediaCodecSelector(preferSw);

ExoPlayer player = new ExoPlayer.Builder(ctx, rf).build();
```

Observações:
- `setEnableDecoderFallback(true)` já faz o ExoPlayer tentar o próximo decoder se o primeiro falhar — dá robustez extra.
- Não mexer no HttpDataSource / User-Agent (mantém o fix anterior da Olé).
- Custo: decodificar 1080p H.264 em SW num Fire TV Stick é viável; se o receptor for muito fraco (Fire TV Stick 1ª gen), pode gaguejar — por isso a flag é por canal.

## Após aprovar

Migration → tipos regenerados → edito código → GitHub Actions gera APKs (release e android-native) porque mexe em `android/**` e `android-native/**`. No servidor:

```bash
cd /opt/lntv-frontend && git pull && npm run build && rsync -a --delete --exclude logos dist/ /var/www/lntv/
```

Depois o admin marca **TV Senado** com "Preferir decoder de software" e reabre no APK — vídeo deve normalizar.
