## Objetivo

Transformar o APK em **shell remoto**, exatamente como já funciona no Legacy: o WebView carrega `https://tv2.lntelecom.net/` direto, sem empacotar `dist/` dentro do APK. Assim, qualquer mudança em `src/**` vai pro ar via `rsync` do frontend e o usuário **não precisa atualizar o APK**.

APK só será regenerado quando algo nativo mudar (Java, Manifest, ícones, Capacitor, gradle, plugins).

---

## Como vai funcionar

1. `MainActivity` (Capacitor) deixa de servir `file:///android_asset/public/index.html` e passa a apontar pra `https://tv2.lntelecom.net/` via `server.url` no `capacitor.config.ts`.
2. O bundle web (`dist/`) ainda é gerado, mas só é usado como **fallback offline** (ou nem isso — podemos remover).
3. O workflow do GitHub Actions passa a rodar **apenas** quando arquivos que afetam o APK mudam.
4. Auto-update do APK continua existindo, mas só dispara quando o `versionCode` no `version.json` aumenta — e isso só vai aumentar quando o workflow rodar (mudança nativa).

---

## Mudanças

### 1. `capacitor.config.ts` — apontar shell pro site remoto

Adicionar `server.url` apontando pro domínio de produção. O Capacitor passa a carregar a URL remota em vez do bundle local.

```ts
server: {
  url: 'https://tv2.lntelecom.net/',
  cleartext: false,
  androidScheme: 'https',
},
```

Trade-off: o app precisa de internet pra abrir (já é o caso hoje pra tudo funcionar — streams, EPG, login). Sem rede, mostra erro do WebView.

### 2. `.github/workflows/android-apk.yml` — filtrar paths

Remover `src/**` e `roku/**` (Roku tem o seu próprio ciclo) dos paths que disparam build. Ficar só com o que realmente muda o APK:

```yaml
on:
  push:
    branches: [main]
    paths:
      - 'android/**'
      - 'resources/**'
      - 'capacitor.config.ts'
      - 'package.json'
      - 'package-lock.json'
      - '.github/workflows/android-apk.yml'
  workflow_dispatch:
```

Roku continua sendo empacotado dentro deste mesmo workflow hoje. Opções:
- **(a)** mover Roku pra um workflow separado disparado por `roku/**`
- **(b)** manter junto e aceitar que quando Roku muda gera APK também

Recomendo **(a)** — workflow `roku-channel.yml` separado, só com os steps de Roku.

### 3. Plugin Capacitor "live reload" → "remote URL"

Quando `server.url` está setado, o `npx cap sync` já injeta isso no `capacitor.config.json` dentro do `android/app/src/main/assets/`. Não precisa mexer no Java do `MainActivity`.

### 4. Legacy APK

Já carrega `https://tv2.lntelecom.net/` direto (linha 113 do `LegacyMainActivity.java`). Nada muda — já é shell remoto desde sempre. ✅

### 5. Auto-update

`useAppUpdate.ts` continua igual. Como `versionCode` no `version.json` só sobe quando o workflow roda (e o workflow só roda em mudança nativa), o prompt de atualização só aparece pro usuário quando realmente precisa.

---

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| App não abre sem internet | Splash do Capacitor + tela "sem conexão" do WebView. Já é a realidade do legacy hoje. |
| Mixed content / CORS no WebView remoto | Site já é HTTPS, mesmo domínio. Sem problema. |
| Capacitor plugins nativos (PlaybackKeepAlive, etc.) | Continuam funcionando — `server.url` só muda **de onde** o HTML vem, não desabilita plugins. |
| Cache do WebView segurando versão antiga do frontend | `index.html` já tem cache-control adequado no nginx; service worker do PWA cuida do resto. |
| Cookies/localStorage (sessão Supabase) | Mesma origem (`tv2.lntelecom.net`) — sessão persiste igual. |

---

## Comandos pro servidor (depois de mergear)

Nenhum no servidor de frontend. Só rebuilds locais de quem quiser testar o APK:

```bash
# Localmente, pra testar o APK shell antes de publicar:
npm run build
npx cap sync android
cd android && ./gradlew assembleRelease
```

Próximo push em `android/**` ou `capacitor.config.ts` dispara o workflow e gera APK novo automaticamente. Pushes só em `src/**` **não** geram APK — usuário recebe a atualização via web normalmente.

---

## Pergunta antes de implementar

Quer que eu separe o build do Roku num workflow próprio (`roku-channel.yml` disparado por `roku/**`)? Ou mantenho tudo junto no `android-apk.yml`?