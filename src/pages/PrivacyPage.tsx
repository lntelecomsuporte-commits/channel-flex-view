import { useEffect, useState } from "react";

const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: "Quem somos",
    body: [
      "O LN TV é um serviço de distribuição de canais de TV por internet operado pela LN Telecom, disponível pelo site tv2.lntelecom.net e por aplicativos para Smart TV (Samsung, LG, Android, Roku) e celular.",
      "Esta política explica quais dados coletamos, por que coletamos e quais são os seus direitos.",
    ],
  },
  {
    title: "Dados que coletamos",
    body: [
      "Cadastro e acesso: e-mail de login, a senha (armazenada de forma protegida no servidor) e as permissões da sua conta.",
      "Dispositivos: o identificador físico da TV ou do aparelho (DUID, client-id do Roku ou ID do dispositivo Android), o nome que você dá a ele, a plataforma e a data do último uso.",
      "Sessão de uso: quais canais você abriu, em que horário, por quanto tempo e se houve falha de reprodução.",
      "Endereço IP: usado para identificar a cidade do acesso, mostrar a programação local correta e proteger a conta contra acessos de outros lugares.",
      "Comandos de voz: quando você usa o microfone do controle, o áudio é transcrito no próprio aparelho e não é gravado por nós.",
    ],
  },
  {
    title: "Por que coletamos",
    body: [
      "Para autenticar o acesso e impedir que pessoas não autorizadas usem sua conta.",
      "Para limitar quantas TVs podem assistir ao mesmo tempo e para bloquear aparelhos que você removeu.",
      "Para exibir a grade de programação (EPG) na sua região.",
      "Para diagnosticar canais que não abrem e melhorar a estabilidade do serviço.",
      "Para cumprir obrigações legais e atender requisições de autoridades competentes.",
    ],
  },
  {
    title: "Com quem compartilhamos",
    body: [
      "Não vendemos seus dados pessoais.",
      "Compartilhamos apenas com as emissoras e provedores de conteúdo que fornecem os canais, quando necessário para liberar a transmissão, e com as autoridades, quando houver obrigação legal.",
      "Os dados ficam em servidores controlados pela LN Telecom e não são enviados para serviços de terceiros fora dessa finalidade.",
    ],
  },
  {
    title: "Retenção e exclusão",
    body: [
      "Guardamos os registros de uso pelo tempo necessário para operar o serviço e cumprir a legislação aplicável.",
      "Ao remover um dispositivo do painel, o acesso dele é encerrado imediatamente e o vínculo é apagado.",
      "Você pode pedir a exclusão dos seus dados a qualquer momento pelo e-mail de contato.",
    ],
  },
  {
    title: "Crianças e adolescentes",
    body: [
      "O LN TV não é dirigido a crianças. Canais com conteúdo adulto ficam protegidos por PIN e exigem a senha do titular da conta.",
    ],
  },
  {
    title: "Segurança",
    body: [
      "Usamos autenticação por token, controle de acesso por dispositivo e verificação de senhas vazias ou já vazadas na internet.",
      "Nunca pedimos sua senha por telefone, WhatsApp ou e-mail. Desconfie de pedidos nesse formato.",
    ],
  },
  {
    title: "Alterações desta política",
    body: [
      "Esta política pode ser atualizada. A versão em vigor é sempre a publicada nesta página, com a data da última alteração indicada abaixo.",
    ],
  },
  {
    title: "Contato",
    body: [
      "Dúvidas, pedidos de acesso, correção ou exclusão de dados: fale com a LN Telecom pelo e-mail de suporte informado no seu cadastro ou pelo painel em tv2.lntelecom.net.",
    ],
  },
];

const PrivacyPage = () => {
  const [year, setYear] = useState(new Date().getFullYear());

  useEffect(() => {
    setYear(new Date().getFullYear());
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <header className="mb-10 border-b border-border pb-6">
          <h1 className="text-3xl font-bold tracking-tight">
            Política de Privacidade
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            LN TV — LN Telecom · Última atualização: 18 de novembro de 2026
          </p>
        </header>

        <div className="space-y-8">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <h2 className="mb-3 text-lg font-semibold text-primary">
                {section.title}
              </h2>
              {section.body.map((paragraph, i) => (
                <p
                  key={i}
                  className="mb-2 text-sm leading-relaxed text-muted-foreground last:mb-0"
                >
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
        </div>

        <footer className="mt-12 border-t border-border pt-6 text-xs text-muted-foreground">
          © {year} LN Telecom. Todos os direitos reservados.
        </footer>
      </div>
    </div>
  );
};

export default PrivacyPage;
