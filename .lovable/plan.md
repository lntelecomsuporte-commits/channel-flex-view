# Lista de canais vazia em WebView antiga

## Diagnóstico

Na TV com WebView antiga (a mesma onde adicionamos o polyfill `crypto.randomUUID`), ao apertar OK 2x:

- O **cabeçalho** da lista aparece ("Canais · ↑↓ navegar/solte abre · ←→ ±5 · OK selecionar · segure OK favoritar · ESC fechar") — então o componente `ChannelList` monta e o keyboard listener funciona (por isso ←→ e troca de canal funcionam).
- A **área da lista virtualizada** (`FixedSizeList` do `react-window`) fica em branco.

A lista só é renderizada quando `listSize.height > 0` (em `src/components/player/ChannelList.tsx`, linha 565). Esse valor vem de `containerRef.current.clientHeight`, medido em `useLayoutEffect` com `ResizeObserver`.

Na WebView antiga (Chromium < 92), o cálculo `flex: 1 1 0% + min-height: 0` dentro de um pai `absolute inset-0 flex flex-col` pode retornar `clientHeight = 0` no primeiro paint. Como o tamanho fica em 0 "estável", o `ResizeObserver` nunca dispara de novo — a lista fica permanentemente escondida.

## Plano de correção

Tornar a medição de altura robusta para WebViews antigas, mantendo o comportamento atual nas modernas. Mudanças apenas em `src/components/player/ChannelList.tsx`:

1. **Fallback de altura via `window.innerHeight`** — se após a primeira medição o container reportar `clientHeight === 0`, usar `window.innerHeight - alturaDoHeader` como altura efetiva da lista. Garante que algo renderize mesmo com layout flex quebrado.

2. **Retry com `requestAnimationFrame`** — re-medir no próximo frame e em um `setTimeout(100ms)` depois do mount, cobrindo o caso em que o layout do flex só estabiliza depois do paint inicial na WebView antiga.

3. **Altura mínima explícita no container da lista** — adicionar `style={{ minHeight: 0, height: '100%' }}` ao wrapper que recebe o `containerRef`, reforçando o cálculo da altura em layouts flex problemáticos.

4. **Polling defensivo enquanto altura == 0** — se após 3 tentativas o `clientHeight` continuar 0, parar de tentar e usar o fallback de `window.innerHeight` permanentemente naquela sessão.

Nada na lógica de teclado, EPG, favoritos ou navegação muda. É puramente medição de layout.

## Verificação

Após o build e instalação do APK na TV problemática:
- Apertar OK 2x → lista de canais deve aparecer preenchida.
- Confirmar que TVs modernas (Fire TV, etc.) continuam com o mesmo comportamento (a medição via `ResizeObserver` segue como caminho preferencial).
