# Publicação LG (Seller Lounge)

1. Acesse https://seller.lgappstv.com com a mesma conta LG e complete o cadastro de vendedor.
2. **Apps › App Registration**: cadastre "LN TV" e confirme o App ID `net.lntelecom.tv`
   (se a LG exigir outro, altere `id` em `appinfo.json` antes de empacotar).
3. Gere o pacote: `ares-package webos` (ou baixe o `.ipk` do GitHub Actions "Build LG webOS App").
   A LG assina o pacote na publicação; não é preciso certificado próprio.
4. Informe: categoria, classificação etária (mesma usada na Samsung), países (Brasil),
   política de privacidade `https://tv2.lntelecom.net/privacidade`, ícones e capturas de tela
   tiradas da TV (Developer Mode + `ares-inspect`, ou captura de tela do próprio painel de teste).
5. **Conta de teste**: use uma conta de demonstração vinculada a uma categoria de teste,
   com limite de aparelhos alto (a LG testa em vários modelos ao mesmo tempo).
   Explique no campo de notas: login por CPF/e-mail e senha, ▲▼ trocam canal,
   OK 2x abre a lista, botão VERDE abre o menu, canais adultos pedem PIN.
6. Envie para QA. Cada nova versão: aumente `version` em `appinfo.json` e
   `APP_VERSION`/`APP_VERSION_CODE` em `js/config.js`.
