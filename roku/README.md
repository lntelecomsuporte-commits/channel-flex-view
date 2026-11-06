# LN TV — Roku Channel

App Roku do LN TV (BrightScript + SceneGraph). Consome o mesmo backend do APK Android (Supabase em `https://tv2.lntelecom.net`).

## Funcionalidades (v1)

- Login com e-mail e senha (mesmos cadastros do APK / web)
- Sessão persistente em `roRegistry` (não pede login toda vez)
- Código completo do aparelho na tela de login (`GetChannelClientId`, sem símbolos, em maiúsculas).
- Enquanto o login estiver aberto, anuncia o Roku a cada 15 segundos em **Aparelhos aguardando login**; após vínculo pelo painel, faz login automático.
- Login manual usa `device-login` para registrar o Roku em **Dispositivos Vinculados**, respeitando bloqueios e limites do cadastro.
- Presença no Monitoramento via `session-heartbeat` a cada 30 segundos; registra o canal imediatamente e tenta novamente se a criação da sessão falhar.
- Logout remoto pelo painel interrompe o vídeo, limpa o login salvo e volta para a ativação sem esperar confirmação na TV.
- Lista de categorias respeitando `category_includes` (hierarquia) e `user_category_access` (Hubsoft + degustação)
- Lista de canais ordenada por `channel_number`
- Favoritos (★) — adicionar/remover com botão **info** do controle
- Player HLS via `roVideoNode` (com fallback pra `backup_stream_urls`)
- OSD com nome do canal e número
- Logout com botão **Voltar** na tela inicial

## Não inclui ainda (próximas iterações)

- EPG (programa atual + barra de progresso + sinopse)
- PIN adulto (`profiles.adult_pin`)
- Busca de canais
- Stats overlay
- Canais YouTube

## Sideload manual

1. Habilita developer mode no Roku: `Home×3, Up×2, Right, Left, Right, Left, Right`
2. Abre `http://<ip-do-roku>` no navegador (porta 80, login `rokudev` + senha que você definiu)
3. Faz upload do `lntv-roku.zip` em **Upload** → **Install**

Pronto, app aparece no menu inicial do Roku.

### Conferir a ativação no painel

Instale o pacote novo no Roku e abra a tela de login. No painel, atualize **Aparelhos aguardando login**, confira o código exibido na TV e vincule ao assinante. O Roku entra na conta no próximo ciclo (15 segundos, mais o tempo de resposta do servidor). Se o aparelho/conta estiver bloqueado, continua no login com o aviso. Após entrar, a tela para os anúncios. O login com e-mail e senha continua disponível e registra o mesmo código de aparelho.

Os serviços `device-announce`, `device-auto-login` e `device-login` já precisam estar disponíveis no servidor. Esta atualização não altera banco, painel nem aplicativos Android.

Testes da lógica de ativação (fora do aparelho, com respostas simuladas): `node scripts/test-roku.mjs`. O comando usa o interpretador `brs` via `bunx`; opcionalmente defina `BRS_BIN` para um interpretador já instalado. A instalação e o vínculo reais ainda precisam ser conferidos em um Roku.

### Conferir presença no Monitoramento

Após instalar o ZIP atualizado, reproduza um canal e clique em **Atualizar** no Monitoramento. Confira o usuário em **Online agora** (não em **Ativos no proxy**, pois o Roku normalmente reproduz direto da fonte). Se não aparecer, o console de desenvolvimento do Roku registra `[LNTV][heartbeat] action=... status=...` sem expor tokens. Status 0 indica falha de rede/tempo limite; 400 indica rejeição pelo servidor e requer conferir os logs de `session-heartbeat` no servidor. Os testes simulados não substituem essa validação no aparelho real.

Para testar o logout remoto, reproduza um canal e use **Deslogar usuário** no painel. Em até 30 segundos o Roku deve parar o vídeo, apagar a sessão salva e mostrar a tela de login com o aviso de sessão encerrada. O canal também deve deixar de aparecer em **Online agora** ao atualizar o painel.

## Build local

```bash
zip -r lntv-roku.zip manifest source components images
```

## Deploy automático (GitHub Actions)

Cada push em `main` gera um Release com `lntv-roku.zip` anexado.
Depois, no servidor, basta:

```bash
curl -L -o /opt/lntv-downloads/lntv-roku.zip \
  https://github.com/<seu-user>/<repo>/releases/latest/download/lntv-roku.zip
```

E adicionar no nginx (mesmo padrão do APK):

```nginx
location = /downloads/lntv-roku.zip {
    alias /opt/lntv-downloads/lntv-roku.zip;
    add_header Cache-Control "no-store" always;
}
```

URL pública pros clientes baixarem: `https://tv2.lntelecom.net/downloads/lntv-roku.zip`

## Imagens necessárias

Substitua os placeholders em `images/`:

- `icon_focus_hd.png` — 290×218 (ícone do canal)
- `splash_hd.jpg` — 1280×720 (splash de abertura)

## Controles

| Tela | Botão | Ação |
|---|---|---|
| Login | OK | Abre teclado virtual no campo ativo |
| Login | ▲▼ | Alterna e-mail / senha |
| Login | ▶ | Faz login |
| Login | ⏪ | Limpa o campo |
| Home | ◀ ▶ | Alterna coluna categorias / canais |
| Home | OK | Abre o canal |
| Home | info (★) | Adiciona/remove dos favoritos |
| Home | Voltar | Sai (logout) |
| Player | OK / info | Mostra OSD |
| Player | Voltar | Volta pra lista |
