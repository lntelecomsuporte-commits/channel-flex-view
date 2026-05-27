## Problema
No APK Android, após vincular o dispositivo, a tela continua preta quando o player nativo ExoPlayer/TextureView é ativado.

## Solucao
Desativar o player nativo Android por padrão e voltar o APK para o player HTML5/HLS dentro do WebView, que é o caminho mais seguro para evitar tela preta nesses TV boxes.

## Arquivo alterado
- `src/components/player/VideoPlayer.tsx`

## Validacao
- Gerar novo APK release, instalar e testar login/vinculação até abrir o primeiro canal.
