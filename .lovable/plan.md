## Análise honesta do comparativo

A outra IA fez uma análise **superficial baseada em nomes de arquivos XML** dentro do APK do concorrente — sem ver o que o nosso APK realmente faz. Vou separar o que é mito do que vale aplicar.

### O que é mito (já temos ou não se aplica)

1. **"ExoPlayer"** — Nem o nosso nem o do concorrente "rodam" no ExoPlayer no sentido que ela descreveu. O concorrente parece ser app nativo Android (layouts XML do ExoPlayer UI). O **nosso é Capacitor + WebView** rodando hls.js / mpegts.js. São arquiteturas diferentes; comparar `pane_loading.xml` com o nosso React não faz sentido técnico.

2. **"Skeletons / loading"** — Já temos: `Skeleton` component, `ChannelOSD`, fallback do `<video>`. O flash cinza que você viu na Smart TV é exatamente o que vamos resolver agora com o overlay preto.

3. **"Auto-reconnect / backup automático"** — **Já implementado e bem mais robusto** do que um `pane_stopped.xml` sugere: `backupStreamUrls`, `tryNextBackup()`, `corsFallback`, `recoverMediaError`, `swapAudioCodec`, watchdog de 30s, freeze recovery de 4s, retries (8x frag / 6x manifest). Veja `VideoPlayer.tsx`.

4. **"Pre-fetching de canal"** — **Já temos**: `ChannelPrefetch.tsx` faz prefetch do próximo manifest m3u8 / primeiros bytes do MP4.

5. **"Zap rápido"** — **Já temos**: `startLevel: 0`, `startFragPrefetch: true`, ABR conservador, e o ajuste recente (último chat) que faz APK pular o proxy em HTTPS direta — exatamente para reduzir latência de zap.

6. **"layout-v26 / layout-watch"** — Isso só indica que o concorrente é app **nativo Leanback** com layouts pra Android Wear. Não é vantagem pra TV box. Nosso `AndroidManifest` já declara `android.software.leanback` + `LEANBACK_LAUNCHER` + `tv_banner`.

7. **"Tamanho do APK / .so libs"** — Apps WebView (Capacitor) carregam o runtime do Android System WebView, não bibliotecas .so de codec. Não dá pra "enxugar" como app ExoPlayer nativo. Trade-off conhecido — ganhamos PWA + APK do mesmo código.

### O que tem fundo de verdade e vale revisitar

1. **Foco/D-Pad em controle remoto** — vale auditar visibilidade do foco em `ChannelList`, `FavoritesBar`, `ChannelSearch`, modais. Hoje usamos foco padrão do browser (outline azul fininho). Em TVs, isso some no fundo escuro.

2. **Feedback visual durante o zap** — o flash do player nativo da WebView (problema reportado na Smart TV). É o que vamos resolver agora.

### Mudanças neste plano

Foco no **único item acionável que combinamos**: eliminar o flash do ícone de player nativo no zap.

#### `src/components/player/VideoPlayer.tsx`

1. Adicionar estado `firstFrameReady` (boolean), reseta para `false` toda vez que `playableStreamUrl` muda.
2. Marcar como `true` no listener `playing` (primeiro frame renderizado).
3. Renderizar uma **camada preta absoluta** sobre o `<video>` enquanto `!firstFrameReady`. Sem spinner — só preto puro pra dar percepção de "switch instantâneo" tipo TV cabo. (Se quiser depois, dá pra adicionar o logo do canal centralizado, mas começamos com preto puro pra não atrapalhar zap rápido.)
4. Adicionar `style={{ backgroundColor: "#000" }}` direto no `<video>` como reforço pra ele não desenhar o placeholder cinza da WebView.
5. Adicionar `poster=""` explícito (impede a WebView de tentar mostrar um poster default em algumas versões antigas).

#### Não vou mexer

- Lógica de proxy / engines / retries / backups — tudo ok.
- Layouts XML Android — não são o problema.
- AndroidManifest — já está correto pra Leanback/Fire TV.

### Próximos passos (para outra mensagem, se quiser)

- Auditoria de foco visual D-Pad nos componentes de listagem (anel vermelho mais grosso, ex: `ring-2 ring-primary`).
- Revisar `ChannelList` pra garantir scroll automático ao item focado.

### Comandos pro servidor (depois de aplicar)

```bash
cd /opt/lntv-frontend && git pull && npm run build && rsync -a --delete --exclude logos dist/ /var/www/lntv/
```

APK: rebuildar via GitHub Actions.