# Publicar o app da Samsung (LN TV)

Existem **dois caminhos completamente diferentes**. Eles não se excluem — dá para
usar os dois ao mesmo tempo.

| | Caminho A — seu servidor | Caminho B — loja da Samsung |
|---|---|---|
| Onde o app fica | `tv2.lntelecom.net` | Samsung Apps (na própria TV) |
| Custo | zero | cadastro gratuito, exige verificação |
| Tempo | imediato | 2 a 4 semanas de análise |
| Instalação | você instala, ou o cliente com seu link | o cliente busca "LN TV" e instala sozinho |
| Precisa de | DUID de cada TV | certificado da Samsung + aprovação |
| Risco | nenhum | a Samsung pode reprovar |

---

## Caminho A — publicar no seu servidor (recomendado para começar)

O app continua instalado por **Developer Mode**, mas você passa a controlar a
versão de um lugar só: troca o arquivo no servidor e todos os clientes são avisados.

### 1. Gerar o pacote assinado

No notebook, com o Tizen Studio aberto:

```bash
# uma vez só — cria a chave LNTV
tizen certificate -a LNTV -p lntv2026 -f LNTV
tizen security-profiles add -n LNTV -a ~/tizen-keys/LNTV.p12 -p lntv2026

# a partir da pasta do projeto
cd tizen
tizen build-web -- .
tizen package -t wgt -s LNTV -- .buildResult
# sai LNTVtizen0.wgt (assinado)
```

### 2. Subir para o servidor

```bash
sudo mkdir -p /opt/lntv-downloads
sudo cp LNTVtizen0.wgt /opt/lntv-downloads/lntv-tizen.wgt
sudo tee /opt/lntv-downloads/version-tizen.json >/dev/null <<'JSON'
{
  "tizenVersionCode": 1,
  "tizenVersionName": "1.0.0",
  "tizenUrl": "https://tv2.lntelecom.net/downloads/lntv-tizen.wgt"
}
JSON
sudo chown www-data:www-data /opt/lntv-downloads/lntv-tizen.wgt /opt/lntv-downloads/version-tizen.json
```

### 3. Liberar as URLs no nginx

Em `/etc/nginx/sites-enabled/tv2.lntelecom.net`:

```nginx
location = /version-tizen.json {
    alias /opt/lntv-downloads/version-tizen.json;
    add_header Cache-Control "no-store" always;
    add_header Access-Control-Allow-Origin "*" always;
    default_type application/json;
}
```

O `location ^~ /downloads/` que já existe cobre o `.wgt`.

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 4. Instalar na TV do cliente

Cada TV precisa estar em Developer Mode com o IP do seu servidor liberado:

1. Na TV: app **Apps** → digite `12345` → **Developer Mode ON** → informe o IP.
2. No servidor (ou no notebook):
   ```bash
   sdb connect <IP_DA_TV>:26101
   sdb -s <IP_DA_TV>:26101 install /opt/lntv-downloads/lntv-tizen.wgt
   ```
3. No painel admin: **usuário → dispositivos vinculados → Cadastrar** (a TV aparece
   como "Samsung (Tizen)" na lista de não cadastrados).

> O `version-tizen.json` só **avisa** que existe versão nova. A instalação ainda é
> manual — a Samsung não permite que um app instale outro app.

---

## Caminho B — publicar na Samsung Apps (Seller Office)

### O que você precisa ter antes de começar

1. **Conta de desenvolvedor Samsung** — https://dev.samsung.com (gratuita). Para
   publicar em nome da LN Telecom, cadastre a empresa com CNPJ.
2. **Cadastro no Seller Office** — https://seller.samsungapps.com
   (o cadastro é gratuito, mas a Samsung verifica os dados).
3. **Certificado de distribuidor público** — criado dentro do Tizen Studio:
   *File → New → Tizen Project → Certificate Profile Manager* → escolha
   **Distribution** → **Public Distribution**. Isso gera a chave que a Samsung aceita.
   Sem esse certificado a submissão não passa da primeira tela.
4. **Política de privacidade com URL pública** — obrigatória. Já publicada em
   `https://tv2.lntelecom.net/privacidade` (arquivo `src/pages/PrivacyPage.tsx`).
   Confira o texto antes de submeter: é o que a Samsung vai conferir.

> Textos prontos de metadados, a ordem das etapas e o que falta de material estão
> em **[STORE-SUBMISSION.md](STORE-SUBMISSION.md)**.

### Passos na loja

1. No Seller Office: **Create New App** → escolha **TV**.
2. A Samsung gera um **App ID** próprio. Substitua no `tizen/config.xml`:
   ```xml
   <tizen:application id="IDQUEASAMSUNGDEU.LNTV" package="IDQUEASAMSUNGDEU" required_version="5.5"/>
   ```
   e troque o `id` do `<widget>` para o URL que a Samsung indicar.
3. Preencha os metadados em português:
   - Nome: `LN TV`
   - Descrição curta e longa
   - Categoria: **Live TV / TV Everywhere**
   - Palavras-chave
   - Contato de suporte (e-mail e telefone)
4. Envie os materiais visuais:
   - Ícone **512×512** (o `public/icon-512.png` do projeto já serve)
   - Ícone 117×117 (o `tizen/icon.png`)
   - **3 a 5 capturas de tela reais** em 1920×1080, mostrando a TV ligada de verdade
   - Banner de destaque no formato que a Samsung pedir
5. Informe a **URL da política de privacidade**.
6. Envie o `.wgt` **assinado com o certificado de distribuidor público**.
7. Envie as instruções de teste: como a Samsung acessa o app sem conta de cliente
   (precisa de um login de demonstração seu).
8. Submeta e aguarde a análise.

### Avisos importantes

- **A Samsung pede comprovação de direitos de conteúdo** para apps de canais de TV.
  Prepare contratos ou autorizações das emissoras/operadoras cujo sinal você
  distribui. Esse é o motivo número 1 de reprovação de apps de IPTV.
- A análise leva **de 2 a 4 semanas** e pode voltar com pedidos de ajuste.
- O app precisa funcionar **sem** depender de você ativar nada manualmente: a
  Samsung testa com o login de demonstração que você informar.
- A loja define a **versão mínima de Tizen** aceita. Com `required_version="5.5"`
  você alcança as TVs de 2020 em diante.

---

## Checagem rápida antes de publicar

- [ ] `tizen/js/config.js` com a `ANON_KEY` do servidor self-hosted (não a do Cloud)
- [ ] `config.xml` sem `<tizen:allow-navigation>` e com `required_version="5.5"`
- [ ] Privilégios `avplay` e `tv.inputdevice` presentes
- [ ] Teste feito em TV física: abre canal, troca de canal, PIN de canal adulto,
      revogação pelo painel derruba a sessão
- [ ] Política de privacidade publicada em `/privacidade` e revisada pela LN Telecom
