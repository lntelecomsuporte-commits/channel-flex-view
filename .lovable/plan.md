## Objetivo
Exibir o codec nas estatísticas de forma legível (ex.: `H.264 (avc1.64001F)` ou `H.265 (hvc1.1.6.L93.B0)`) em vez do código bruto, e mostrar o container/formato do vídeo separadamente.

## Mudanças

**`src/components/player/StatsOverlay.tsx`**
- Criar helper `prettyCodec(raw)` que mapeia prefixos:
  - `avc1` / `avc3` → `H.264 (AVC)`
  - `hev1` / `hvc1` → `H.265 (HEVC)`
  - `vp09` → `VP9`
  - `vp08` → `VP8`
  - `av01` → `AV1`
  - `mp4a` → `AAC` (áudio, se aparecer)
  - fallback: retorna o raw
- Formato final exibido: `H.264 · avc1.64001F` (nome amigável + código técnico).
- Criar helper `prettyContainer(mimeType, streamUrl)`:
  - Se `mimeType` existir (native): `video/mp4` → `MP4`, `video/mp2t` → `MPEG-TS (HLS)`, `application/vnd.apple.mpegurl` → `HLS`.
  - Senão, deduzir do `streamUrl`: `.m3u8` → `HLS`, `.mp4` → `MP4`, `.ts` → `MPEG-TS`.
- Adicionar nova linha **Formato** logo abaixo de **Codec** em ambos modos (HTML5 e Native).
- No HTML5: passar `videoEl.currentSrc` e usar `hls?.levels[hls.currentLevel].videoCodec` no helper.
- No Native: usar `s.codec` e `s.mimeType` do plugin.

## Detalhes técnicos
- O ExoPlayer já retorna `codec` (codecs string RFC 6381) e `mimeType` (`video/avc`, `video/hevc`, etc.) — então o mapeamento também funciona a partir do `mimeType` quando o `codecs` vier vazio.
- HLS.js expõe `level.videoCodec` (mesmo formato RFC 6381) e `level.codecSet`.
- Nada de mudanças em backend/plugin nativo — só apresentação.

## Arquivos
- `src/components/player/StatsOverlay.tsx`

## Comandos pro servidor (após implementar)
```bash
cd /opt/lntv-frontend && git pull && npm run build && rsync -a --delete --exclude logos dist/ /var/www/lntv/
```
