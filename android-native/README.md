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
| Auto-update | Sim (lê `version.json`) | Opcional — só dispara se `version.json` tiver chaves `nativoVersionCode`/`nativoUrl` |
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
GitHub Release com tag `nativo-vX.Y.Z`.

## Status (v1.0)

- [x] Login (email/senha via Supabase Auth REST)
- [x] Lista de canais (respeita `user_category_access` + `category_includes`)
- [x] Filtro por categoria (tecla MENU/GUIDE cicla)
- [x] Favoritos (tecla ★ / Y no controle)
- [x] Player ExoPlayer com OSD (número + logo + nome + EPG agora/depois)
- [x] EPG via `/epg/lntv.xml` consolidado (cache 10min em memória)
- [x] Stall watchdog 8s + auto-retry exponencial (1s→8s, máx 6x)
- [x] Cache de logos via Coil
- [x] Auto-update **opt-in** via chaves `nativoVersionCode`/`nativoUrl` no `version.json`
- [ ] EPG grid (timeline)
- [ ] Busca
- [ ] PIN parental
- [ ] Sinopse modal
- [ ] Heartbeat de sessão / revogação global
- [ ] Device-announce / auto-login por device_id

## Controles (D-pad / controle TV)

| Tecla | Ação |
|---|---|
| ↑ / CH+ | Canal anterior |
| ↓ / CH− | Próximo canal |
| OK | Mostra OSD |
| ★ / Y / BOOKMARK | Toggle favorito do canal atual |
| MENU / GUIDE (lista) | Cicla filtro por categoria |
| BACK | Sai do player / fecha app |

## Ativar auto-update

Pra que o nativo se atualize sem mexer nos APKs atuais, atualize
`/usr/local/bin/sync-lntv-apk.sh` no servidor pra publicar também:

```json
{
  "versionCode": 123,                      // ← Capacitor, intocado
  "url": "https://.../lntv-release.apk",   // ← Capacitor, intocado
  "nativoVersionCode": 7,
  "nativoVersionName": "1.0.7",
  "nativoUrl": "https://tv2.lntelecom.net/downloads/lntv-nativo.apk"
}
```

Os APKs Capacitor continuam ignorando `nativo*` e vice-versa.

