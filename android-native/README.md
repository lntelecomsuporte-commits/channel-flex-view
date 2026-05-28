# LN TV Nativo (Kotlin)

APK **nativo Kotlin** experimental, gerado em paralelo aos APKs atuais
(`lntv-latest`, `lntv-legacy`, `lntv-slim`). **Não afeta** os APKs em produção,
o `version.json` de auto-update, o frontend web nem o servidor.

## Por que existe

O APK Capacitor atual tem ~9MB porque carrega WebView + bundle web. Concorrentes
(Olé TV, IBO, Smarters) ficam <3MB porque são Kotlin/Java nativos com
XML Views + ExoPlayer. Esse projeto bate esse padrão.

## Diferenças

| | Capacitor (`tv.lntelecom.net`) | Nativo (`tv.lntelecom.nativo`) |
|---|---|---|
| UI | WebView (React) | XML Views + Leanback |
| Player | ExoPlayer via plugin nativo | ExoPlayer direto |
| Backend | REST via supabase-js no WebView | OkHttp direto em `tv2.lntelecom.net/rest/v1` |
| Tamanho esperado | ~9MB | ~3-4MB |
| Auto-update | Sim (lê `version.json`) | Não nesta fase |
| Package | `tv.lntelecom.net` | `tv.lntelecom.nativo` (instala lado-a-lado) |

## Build local

```bash
cd android-native
gradle wrapper --gradle-version 8.9
./gradlew assembleRelease
ls -lh app/build/outputs/apk/release/
```

## Build no CI

Push em `main` que toque `android-native/**` dispara
`.github/workflows/android-nativo.yml`, que gera `lntv-nativo.apk` e anexa ao
GitHub Release.

## Status

- [x] Login (email/senha via Supabase Auth REST)
- [x] Lista de canais (respeita user_category_access + category_includes)
- [x] Player ExoPlayer com OSD básico (número + logo + nome)
- [x] Stall watchdog + auto-retry exponencial
- [x] Cache de logos via Coil
- [ ] EPG OSD com programa atual
- [ ] EPG grid
- [ ] Categorias (filtro lateral)
- [ ] Favoritos
- [ ] Busca
- [ ] PIN parental
- [ ] Sinopse modal
- [ ] Auto-update via APK download
- [ ] Heartbeat de sessão / revogação global
- [ ] Device-announce / auto-login por device_id
```
