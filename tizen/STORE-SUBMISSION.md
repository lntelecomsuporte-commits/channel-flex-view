# Submissão à Samsung Apps (Seller Office) — LN TV

Você já tem conta na Samsung Developers e certificados emitidos, então o que falta é
**material e configuração**. Este arquivo tem os textos prontos para colar no
Seller Office e a ordem exata das etapas.

---

## 1. Criar o app e pegar o App ID

1. Acesse https://seller.samsungapps.com → **Create New App** → tipo **TV**.
2. A Samsung gera um **App ID** no formato `XXXXXXXX.YYYYYYY`.
3. Abra `tizen/config.xml` e substitua as duas linhas:
   ```xml
   <widget xmlns="http://www.w3.org/ns/widgets"
           xmlns:tizen="http://tizen.org/uri/profile/1.1/uiapis"
           id="https://tv2.lntelecom.net/tizen"
           version="1.0.0"
           viewmodes="maximized">
     <tizen:application id="XXXXXXXX.YYYYYYY" package="XXXXXXXX" required_version="5.5"/>
   ```
   - `id` do `<widget>` → a URL que a Samsung indicar para o seu app.
   - `tizen:application id` e `package` → o App ID e o prefixo dele.
4. Aumente `version` para a versão que vai submeter (ex.: `1.0.1`).

> Se o App ID não bater com o `config.xml`, o upload do `.wgt` é rejeitado na hora.

## 2. Assinar com o certificado de distribuidor público

Com os certificados que você já tem:

```bash
# criar o perfil de distribuição (uma vez), apontando para o certificado público
tizen security-profiles add -n LNTV-PUBLIC \
  -a /caminho/para/author.p12 -p 'senha-do-autor' \
  -d /caminho/para/distributor.p12 -dp 'senha-do-distribuidor'

# gerar o pacote final
cd tizen
tizen build-web -- .
tizen package -t wgt -s LNTV-PUBLIC -- .buildResult
```

O arquivo gerado (`.wgt`) é o que sobe na loja.

## 3. Metadados — textos prontos

| Campo | Conteúdo |
|---|---|
| Nome do app | `LN TV` |
| Nome curto / tagline | `Canais ao vivo na sua Samsung TV` |
| Categoria principal | Live TV / TV Everywhere |
| Idioma | Português (Brasil) |
| Site | `https://tv2.lntelecom.net` |
| Política de privacidade | `https://tv2.lntelecom.net/privacidade` |
| E-mail de suporte | o e-mail de atendimento da LN Telecom |
| Telefone de suporte | o telefone de atendimento da LN Telecom |
| Palavra-chave | `tv, canais ao vivo, streaming, iptv, futebol, filmes, séries, notícias` |

**Descrição curta (até ~140 caracteres)**

> Assista canais ao vivo, filmes e séries na sua Samsung TV. Login por conta,
> favoritos, programação na tela e comando de voz em português.

**Descrição longa**

> O LN TV leva os canais da sua assinatura para a Samsung TV, sem precisar de
> aparelho externo.
>
> O que o app faz:
> - Abre o último canal assistido assim que você liga a TV.
> - Lista completa de canais com zapeamento por cima/baixo, número do canal e
>   favoritos no botão vermelho do controle.
> - Programação (EPG) na tela, com a hora certa da sua região.
> - Trilha de áudio e legenda quando o canal oferece.
> - Comando de voz em português: "canal 23", "globo", "legenda".
> - Canais com conteúdo adulto protegidos por PIN.
> - Aviso quando há uma nova versão do aplicativo.
>
> Requisitos:
> - Samsung TV com Tizen 5.5 ou mais novo (modelos de 2020 em diante).
> - Conexão com a internet.
> - Conta ativa do LN TV fornecida pela LN Telecom. O app não faz cadastro
>   público: o acesso é liberado pelo atendente.
>
> Suporte: o contato é feito pelos canais de atendimento da LN Telecom.

## 4. Materiais visuais

| Material | Requisito | Situação |
|---|---|---|
| Ícone | 512×512 PNG | `public/icon-512.png` do projeto já serve |
| Ícone do app | 117×117 PNG | `tizen/icon.png` |
| Capturas | 3 a 5, 1920×1080, reais | **falta capturar na TV** |
| Banner de destaque | formato pedido pela Samsung | **falta gerar** |

As capturas precisam ser da TV ligada de verdade, mostrando:
1. A tela de login/ativação.
2. Um canal tocando com o nome e a programação na tela.
3. A lista de canais aberta.
4. O menu lateral.
5. A tela de PIN de canal adulto.

## 5. Login de demonstração

A Samsung testa o app sem ser cliente. Você precisa informar uma conta que funcione
para o avaliador, com canal aberto e sem depender de você liberar nada na hora.

## 6. Direitos de conteúdo

Tenha em mãos os contratos ou autorizações das emissoras/provedores cujo sinal você
distribui. A Samsung costuma pedir comprovação para apps de canais de TV, e a falta
desse documento é o principal motivo de reprovação.

## 7. Enviar

1. Preencha metadados + materiais.
2. Anexe o `.wgt` assinado.
3. Informe o login de demonstração.
4. Envie e acompanhe o status — a análise leva de 2 a 4 semanas.
