## Busca por voz no controle remoto

Adicionar reconhecimento de fala em pt-BR ativado pelo botão de microfone/voz do controle. O usuário poderá falar:

- **"canal 23"** ou **"23"** → sintoniza pelo número
- **"globo"**, **"ESPN"**, **"Band"** → fuzzy match pelo nome do canal
- **"áudio"** → abre menu de trilhas de áudio (se só houver uma, OSD informa "Sem áudio alternativo")
- **"legenda"** / **"caption"** → abre menu de legendas (mesmo fallback)
- **"desligar"** → fecha o app e tenta desligar receptor/TV via HDMI-CEC (KEYCODE_TV_POWER / standby intent)

Engine: SpeechRecognizer nativo do Android (pt-BR, sem custo, funciona offline em devices recentes). Roku usa o voice search nativo da plataforma via deep linking ECP — não captura voz dentro do app.

### Plataformas e gatilhos

**APK Nativo (Kotlin) — `PlayerActivity`**
- Interceptar `KEYCODE_VOICE_ASSIST` (231), `KEYCODE_ASSIST` (219), `KEYCODE_SEARCH` (84) e long-press do mic
- Abrir `SpeechRecognizer` com `RecognizerIntent.ACTION_RECOGNIZE_SPEECH`, locale `pt-BR`, `EXTRA_PARTIAL_RESULTS=true`
- Overlay translúcido com microfone animado + transcrição parcial
- Permissão `RECORD_AUDIO` adicionada no `AndroidManifest.xml` com runtime request no primeiro uso
- Parser de comandos compartilhado em Kotlin (`VoiceCommandParser.kt`)

**APK Release (WebView Capacitor) — novo plugin `VoicePlugin`**
- Java plugin que chama o mesmo `SpeechRecognizer` e devolve resultado via `notifyListeners("result", {...})`
- `LegacyMainActivity` e `MainActivity` interceptam mesmas keycodes e chamam `plugin.startListening()`
- Frontend (`src/plugins/voice.ts`) recebe transcrição e roteia pro mesmo parser TS
- Permissão `RECORD_AUDIO` no `AndroidManifest.xml`

**Roku — `PlayerScene.brs`**
- Roku não permite gravar áudio dentro do canal; apenas o voice search global do sistema
- Adicionar entradas `<contentNode>` no manifest pra deep link via ECP: `tv.lntelecom.net?contentId=<channelId>` 
- Documentar no README; sem mudança de UI dentro do app

### Parser de comandos (compartilhado)

`src/lib/voiceCommands.ts` (TS) e espelho `VoiceCommandParser.kt`:

```text
input normalizado (lowercase, sem acento)
├─ /^(canal\s+)?(\d{1,4})$/ → tuneByNumber(n)
├─ /^(audio|som|sap)$/      → openAudioMenu()
├─ /^(legenda|caption|cc|subtitulo)$/ → openSubtitleMenu()
├─ /^(desligar|sair|fechar)$/ → shutdown()
└─ fallback → fuzzy match em channels.name (Levenshtein ≤ 2 OU substring) → tuneById
```

### Integrações

- `tuneByNumber` reutiliza lógica do `ChannelSearch.tsx`
- `openAudioMenu`/`openSubtitleMenu` disparam o mesmo `TrackOSD` já existente (com flag "force show even if única faixa → mostra mensagem 'sem alternativa'")
- `shutdown`: nativo chama `finishAffinity()` + `sendBroadcast(Intent.ACTION_SHUTDOWN)` quando permitido; senão envia `KEYCODE_TV_POWER` via `InputManager.injectInputEvent` (requer permissão do sistema — em devices não-root, apenas fecha o app e exibe toast "Use o botão Power do controle pra desligar a TV")

### Feedback visual

Novo componente `VoiceListeningOverlay.tsx` (frontend + equivalente XML no nativo):
- Ícone de mic pulsando
- "Ouvindo…" → transcrição parcial em tempo real
- Após resultado: "Entendi: <texto>" + ação executada por 1,5s
- Erro/timeout (4s sem fala): "Não entendi, tente novamente"

### Arquivos a criar/editar

**Novos**
- `src/lib/voiceCommands.ts` — parser + fuzzy match
- `src/components/player/VoiceListeningOverlay.tsx`
- `src/plugins/voice.ts` — bridge Capacitor
- `android/app/src/main/java/tv/lntelecom/net/VoicePlugin.java`
- `android-native/app/src/main/java/tv/lntelecom/nativo/voice/VoiceCommandParser.kt`
- `android-native/app/src/main/java/tv/lntelecom/nativo/voice/VoiceRecognizer.kt`

**Editados**
- `src/pages/PlayerPage.tsx` — listener de keys voice + integração com parser/overlay
- `src/lib/remoteKeys.ts` — adicionar `isVoiceKey()`
- `src/components/player/TrackOSD.tsx` — aceitar `forceShow` pra mostrar mensagem "sem alternativa"
- `android/app/src/main/AndroidManifest.xml` — `RECORD_AUDIO`, registro do plugin
- `android/app/src/main/java/tv/lntelecom/net/MainActivity.java` + `LegacyMainActivity.java` — registrar plugin + interceptar keys
- `android-native/app/src/main/AndroidManifest.xml` — `RECORD_AUDIO`
- `android-native/app/src/main/java/tv/lntelecom/nativo/ui/player/PlayerActivity.kt` — keys + overlay
- `roku/README.md` — documentação do voice search via ECP

### Fora de escopo
- Wake word ("Ok LN TV") — exigiria mic sempre ligado
- iOS (projeto é Android+Roku+Web)
- Comandos de navegação extra ("próximo", "favoritos") — pode entrar em iteração futura
