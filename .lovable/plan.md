## Diagnóstico

Você está certo: o preto acontece **antes da lista de canais**, então não é o player. O fluxo após `navigate("/")` é:

```
LoginPage.doLogin() → setSession() → navigate("/")
  → ProtectedRoute (useAuth.getSession + has_role RPC)
    → Index → PlayerPage (useChannels + useEPG + useFavorites + …)
```

Qualquer erro JS não tratado em qualquer ponto desse pipeline deixa a tela preta sem feedback nenhum — exatamente o que você descreve.

**Hipóteses prováveis** nos receptores pirata (Android TV box 5/6/7 com Chromium velho):

1. **Bundle ES2017 sem polyfills** — `vite.config.ts` está em `target: "es2017"` e o plugin legacy **só roda com `BUILD_LEGACY=1`**. O `lntv-latest.apk` hoje **não** usa legacy, então features modernas (top-level await em chunks dinâmicos, certas APIs) podem quebrar no WebView antigo.
2. **Erro silencioso em algum hook do boot** (useChannels, useEPG, useFavorites, session-heartbeat) — qualquer throw síncrono no render mata a árvore React e gera tela preta.
3. **Capacitor Preferences** travando além do timeout em algum modelo específico.

Sem um overlay de erro visível, é cego — por isso a v216 "parecia funcionar": pode ter sido coincidência de qual chunk o WebView aguentou.

## Plano

### 1. Overlay global de erro (instalado no `index.html`, antes do bundle React)
Captura `window.onerror` + `unhandledrejection` + erro de carregamento de `<script>` e mostra **na tela** (não só no console, que ninguém vê no APK). Inclui também um indicador "boot step" que vai mudando (`auth-storage → session → channels → ready`) — se travar, sabemos exatamente onde.

### 2. Forçar build legacy no APK principal
Mudar o workflow `android-apk.yml` pra rodar `BUILD_LEGACY=1 npm run build` **antes** de gerar o `lntv-latest.apk` (não só o legacy). Custo: build ~2min mais lento. Benefício: o mesmo APK roda em Chrome 49+ (Android 5+) sem precisar de APK separado.

### 3. Error Boundary React no topo
Envelopar `<App/>` num ErrorBoundary que renderiza a mensagem do erro + stack na tela em vez de retornar `null` (que vira preto).

### 4. Pedir info do device (próxima mensagem)
Pra fechar o diagnóstico: marca/modelo do receptor + versão Android (Configurações → Sobre). Com o overlay instalado, você manda print da tela e a gente vê o erro real.

## Arquivos afetados

- `index.html` — script inline de captura de erros + boot stepper visível
- `src/main.tsx` — emite eventos de boot step + ErrorBoundary
- `src/App.tsx` — wrap em ErrorBoundary
- `src/components/ErrorBoundary.tsx` — novo
- `.github/workflows/android-apk.yml` — `BUILD_LEGACY=1` no build do APK principal

## Sem mudanças

- Player nativo, fluxo de login, edge functions, RLS — nada disso é tocado. É puramente instrumentação + compat de build.

## Resultado esperado

Próximo APK que você instalar: se travar de novo, **aparece texto vermelho na tela** com o erro exato (ex: "TypeError: Object.hasOwn is not a function at chunk-XYZ.js:42") em vez de preto. Com isso fechamos o problema em 1 iteração.
