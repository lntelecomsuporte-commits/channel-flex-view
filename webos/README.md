# LN TV — LG webOS

App web empacotado como `.ipk` para TVs LG (webOS 4.0 / 2018 em diante).
Reaproveita o fluxo do app Samsung: pareamento pelo painel, login por CPF/e-mail,
canais por categoria, canais adultos e categorias com PIN, EPG, favoritos e
desconexão remota pelo painel.

## Estrutura
- `appinfo.json` — manifesto (ID `net.lntelecom.tv`, versão, ícones, 1920x1080).
- `index.html`, `css/`, `js/` — app (ES5, sem build).
- `js/vendor/hls.min.js` — reserva quando o HLS nativo da TV recusar um canal.
- `icon.png` (80x80), `largeIcon.png` (130x130), `splash.png` (1920x1080).

## Controle
| Tecla | Ação |
|---|---|
| ▲ ▼ / CH+ CH− | Trocar canal |
| ◀ ▶ | Prévia do canal anterior/seguinte |
| OK | Informações · OK 2x = lista de canais · em canal bloqueado abre o PIN |
| Números | Ir direto ao canal |
| VERDE | Menu · VERMELHO favorito · AMARELO áudio · AZUL legenda |
| VOLTAR | Fecha o que estiver aberto; na tela principal pergunta se quer sair |
| Ponteiro (Magic Remote) | Botões Voltar / CH− / CH+ / Canais / Menu no rodapé |

## Instalar na TV (modo desenvolvedor)
1. Na TV: instale e abra o app **Developer Mode**, entre com a conta LG,
   ligue **Dev Mode Status** e **Key Server**. Anote o IP e a Passphrase.
2. No PC (Node.js instalado):
   ```bash
   npm install -g @webos-tools/cli
   ares-setup-device            # add → nome lg-tv → IP da TV → porta 9922 → usuário prisoner
   ares-novacom --device lg-tv --getkey   # digite a Passphrase
   ```
3. Na pasta do projeto:
   ```bash
   ares-package webos                       # gera net.lntelecom.tv_1.0.1_all.ipk
   ares-install --device lg-tv net.lntelecom.tv_1.0.1_all.ipk
   ares-launch --device lg-tv net.lntelecom.tv
   ares-inspect --device lg-tv --app net.lntelecom.tv --open   # depurar (opcional)
   ```
O modo desenvolvedor expira em 50 horas; renove no app Developer Mode (Extend).

## Vincular a TV a um usuário
Abra o app na TV, depois no painel: **Usuários › Dispositivos** do cliente.
A TV aparece em **Aparelhos aguardando login** como "LG <modelo> (webOS)" —
clique em **Vincular**. Ou use **Cadastrar manualmente** com plataforma
**LG (webOS)** e o código exibido na TV.

## Publicar na LG Content Store
Veja `PUBLISHING.md`.
