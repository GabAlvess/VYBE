import './LegalPages.css';
import { LEGAL_LAST_UPDATED, LEGAL_PRIVACY_VERSION, LEGAL_TERMS_VERSION } from '@vybe/shared';
import { VybeLogo } from './VybeLogo';

type LegalSection = { title: string; paragraphs?: string[]; bullets?: string[]; groups?: { title: string; bullets: string[] }[]; note?: string };

const terms: LegalSection[] = [
  { title: 'Sobre o VYBE', paragraphs: ['O VYBE é uma plataforma digital que permite que usuários participem de comunidades virtuais e utilizem diferentes experiências sociais integradas, como publicação de conteúdo, mensagens, conexões, recursos financeiros virtuais e outros aplicativos disponibilizados dentro de cada comunidade.', 'Cada comunidade pode possuir configurações, recursos, regras e funcionalidades próprias.', 'Ao criar uma conta ou utilizar o VYBE, o usuário concorda com estes Termos de Uso.'] },
  { title: 'Conta VYBE', paragraphs: ['Para utilizar determinados recursos, o usuário deverá criar uma conta VYBE. A conta é pessoal e não deve ser transferida sem autorização.'], bullets: ['fornecer informações válidas;', 'manter seus dados de acesso protegidos;', 'não compartilhar sua senha;', 'informar ao VYBE sobre uso não autorizado de sua conta;', 'manter seu e-mail de acesso atualizado.'] },
  { title: 'Identidade dentro das comunidades', paragraphs: ['Após entrar em uma comunidade, o usuário poderá criar uma identidade própria para aquele universo. A mesma conta VYBE poderá possuir identidades diferentes em comunidades diferentes. O nome de usuário deverá ser único dentro de cada comunidade.'], bullets: ['nome;', 'nome de usuário;', 'foto;', 'biografia;', 'informações definidas pela comunidade.'] },
  { title: 'Experiência imersiva', paragraphs: ['Algumas áreas do VYBE são desenvolvidas para proporcionar uma experiência imersiva dentro das comunidades. Por esse motivo, determinadas interfaces podem representar redes sociais, sistemas de mensagens, bancos virtuais, instituições, escolas, empresas, eventos, sistemas de relacionamento e outros serviços fictícios.', 'Esses recursos fazem parte do ambiente digital do VYBE e devem ser utilizados de acordo com as regras da plataforma e da comunidade correspondente.'] },
  { title: 'Aplicativos do VYBE', paragraphs: ['Dependendo da comunidade, poderão estar disponíveis aplicativos como Social, Echo, Match, Mensagens, Banco, Eventos, Acadêmico, Carreira, Notícias e outros. Alguns aplicativos podem não estar disponíveis em todas as comunidades.'] },
  { title: 'Social e Echo', paragraphs: ['O usuário poderá publicar textos, imagens, comentários, reações e outros conteúdos suportados. O usuário é responsável pelo conteúdo que publica. Não é permitido publicar conteúdo que viole leis, direitos de terceiros ou regras do VYBE.'] },
  { title: 'Mensagens privadas', paragraphs: ['O VYBE poderá disponibilizar sistemas de comunicação entre usuários. O usuário não deve utilizar mensagens para assediar, ameaçar, praticar fraude, enviar spam, compartilhar conteúdo ilegal ou tentar obter informações pessoais de forma indevida.', 'O VYBE poderá adotar medidas de segurança e moderação quando necessário.'] },
  { title: 'Match', paragraphs: ['O VYBE poderá disponibilizar uma funcionalidade de descoberta e conexão entre perfis. A participação no Match poderá ser opcional. As interações devem respeitar consentimento, regras da comunidade, segurança, limites de idade aplicáveis e demais regras da plataforma.', 'O VYBE não garante que uma interação entre usuários resultará em amizade, relacionamento ou qualquer outro tipo de vínculo.'] },
  { title: 'Banco virtual', paragraphs: ['Todo saldo, moeda, transferência, pagamento, salário ou movimentação existente no Banco VYBE é exclusivamente virtual e fictício. Esses valores não representam dinheiro real, não possuem valor monetário fora da plataforma, não podem ser convertidos em moeda real, não representam conta bancária real e não configuram serviço financeiro real.', 'Uma transferência virtual poderá alterar o saldo virtual das contas envolvidas dentro da comunidade.'], note: 'O Banco virtual é uma experiência fictícia da comunidade e não movimenta dinheiro real.' },
  { title: 'Conteúdo e responsabilidade', paragraphs: ['O usuário mantém responsabilidade pelo conteúdo que publica. Ao publicar conteúdo no VYBE, o usuário concede à plataforma as permissões técnicas necessárias para armazenar, exibir, processar e distribuir o conteúdo dentro das funcionalidades da plataforma. Isso não transfere automaticamente a propriedade intelectual do conteúdo ao VYBE.'] },
  { title: 'Conteúdo proibido', paragraphs: ['Não é permitido utilizar o VYBE para:'], bullets: ['atividades ilegais;', 'assédio ou perseguição;', 'ameaças;', 'discurso de ódio;', 'exploração sexual ou conteúdo envolvendo abuso infantil;', 'fraude;', 'tentativa de invasão ou distribuição de malware;', 'spam;', 'falsificação de identidade com finalidade fraudulenta;', 'violação grave de direitos de terceiros.'], note: 'O VYBE poderá remover conteúdo e aplicar medidas administrativas quando necessário.' },
  { title: 'Comunidades', paragraphs: ['Cada comunidade poderá possuir regras próprias, administradores, moderadores, recursos específicos e mecanismos de aprovação de membros. Ao participar de uma comunidade, o usuário também deverá respeitar as regras locais, desde que elas não entrem em conflito com as regras gerais do VYBE.'] },
  { title: 'Administração das comunidades', paragraphs: ['Administradores de comunidade poderão possuir permissões para organizar membros, moderar conteúdo, criar eventos, administrar recursos, configurar determinados aplicativos e aplicar medidas previstas pelas regras da comunidade.', 'A administração central do VYBE mantém controle sobre questões relacionadas à segurança e ao funcionamento geral da plataforma.'] },
  { title: 'Verificação de perfil', paragraphs: ['O VYBE poderá disponibilizar selos de verificação. Alguns tipos de verificação poderão ser pagos. Quando houver cobrança, as condições, o preço e a forma de aquisição serão apresentados antes da contratação.', 'Um selo de verificação não representa garantia sobre caráter, reputação, conduta, identidade civil ou confiabilidade absoluta do usuário. O VYBE poderá remover ou suspender uma verificação em caso de fraude, abuso ou violação das regras.'] },
  { title: 'Pagamentos reais', paragraphs: ['Sempre que o VYBE oferecer recursos pagos com dinheiro real, como determinados serviços ou verificações, esses pagamentos serão claramente diferenciados do Banco virtual. Dinheiro real e saldo fictício da comunidade nunca devem ser tratados como a mesma coisa.'] },
  { title: 'Segurança', paragraphs: ['O usuário não pode tentar acessar contas de terceiros, explorar vulnerabilidades, contornar controles de segurança, acessar dados de outras comunidades sem autorização ou automatizar abuso da plataforma.'] },
  { title: 'Suspensão e encerramento', paragraphs: ['O VYBE poderá advertir, limitar funcionalidades, suspender, remover conteúdo ou encerrar acesso quando houver violação relevante destes Termos ou riscos à plataforma e seus usuários.'] },
  { title: 'Exclusão da conta', paragraphs: ['O usuário poderá solicitar exclusão da sua conta conforme os mecanismos disponibilizados pela plataforma. Alguns registros poderão ser mantidos quando necessário para cumprimento de obrigações legais, segurança, prevenção de fraude, auditoria ou resolução de disputas.'] },
  { title: 'Alterações no serviço', paragraphs: ['O VYBE poderá adicionar ou remover recursos, alterar funcionalidades, atualizar interfaces e modificar aplicativos disponíveis. Mudanças relevantes poderão ser comunicadas aos usuários.'] },
  { title: 'Alterações nos Termos', paragraphs: ['Estes Termos poderão ser atualizados. Quando houver alteração material, o VYBE poderá informar os usuários por meio da própria plataforma.'] },
  { title: 'Contato', paragraphs: ['Para dúvidas relacionadas a estes Termos, consulte os canais oficiais de contato que serão disponibilizados pelo VYBE.'] },
];

const privacy: LegalSection[] = [
  { title: 'Introdução', paragraphs: ['Esta Política explica como o VYBE trata dados pessoais durante o uso da plataforma. O VYBE busca tratar dados de forma transparente, segura e compatível com a legislação aplicável.'] },
  { title: 'Dados que podemos tratar', groups: [
    { title: 'Dados da conta', bullets: ['nome informado;', 'e-mail;', 'credenciais protegidas (senhas não são armazenadas em texto simples);', 'data de criação;', 'informações de autenticação.'] },
    { title: 'Dados de perfil', bullets: ['nome, username, foto e bio;', 'informações de perfil;', 'comunidades das quais participa.'] },
    { title: 'Conteúdo', bullets: ['publicações, imagens, comentários e reações;', 'mensagens, eventos e outros conteúdos enviados.'] },
    { title: 'Dados de interação', bullets: ['seguidores, curtidas, comentários e conexões;', 'confirmações de presença;', 'utilização dos aplicativos.'] },
    { title: 'Dados do Match', bullets: ['participação no Match e preferências configuradas;', 'interesses e conexões;', 'matches, quando o recurso estiver habilitado.'] },
    { title: 'Dados do Banco virtual', bullets: ['saldo fictício e transferências virtuais;', 'remetente, destinatário, valor virtual, data, descrição e histórico;', 'esses dados não representam movimentações bancárias reais.'] },
    { title: 'Dados técnicos', bullets: ['endereço IP, navegador e dispositivo;', 'data e horário de acesso;', 'sessões, logs de segurança e identificadores técnicos.'] },
  ] },
  { title: 'Finalidades', paragraphs: ['Os dados poderão ser utilizados para criar e manter contas, autenticar usuários, permitir entrada em comunidades, manter perfis, disponibilizar Social, Echo e mensagens, executar Match e Banco virtual, registrar eventos, entregar notificações, prevenir abuso, manter segurança, prestar suporte, cumprir obrigações legais e melhorar a plataforma.'] },
  { title: 'Bases legais', paragraphs: ['O tratamento será realizado conforme as bases legais aplicáveis previstas na legislação de proteção de dados. Dependendo da situação, isso pode incluir execução de contrato, cumprimento de obrigação legal, legítimo interesse, consentimento, exercício regular de direitos, proteção contra fraude e outras bases legalmente aplicáveis. Nem todo tratamento depende exclusivamente de consentimento.'] },
  { title: 'Dados públicos e privados', paragraphs: ['Algumas informações serão visíveis dentro da comunidade, como nome de perfil, username, foto, bio, publicações públicas, seguidores e determinadas interações. Outras informações permanecem privadas ou restritas conforme a funcionalidade, como e-mail de login, credenciais, controles de segurança e determinadas informações administrativas.'] },
  { title: 'Comunidades', paragraphs: ['Uma conta VYBE poderá participar de várias comunidades. Cada comunidade poderá possuir uma identidade separada. Os dados de uma comunidade não devem ser automaticamente expostos em outra comunidade quando isso não fizer parte da funcionalidade prevista.'] },
  { title: 'Administradores de comunidade', paragraphs: ['Administradores e moderadores podem acessar informações necessárias às funções de administração e moderação, conforme suas permissões. Ser administrador não concede acesso irrestrito a informações privadas. O VYBE deve aplicar controles de acesso e auditoria.'] },
  { title: 'Mensagens', paragraphs: ['Mensagens privadas são destinadas aos participantes da conversa. O VYBE poderá processá-las tecnicamente para entrega, armazenamento, segurança, prevenção de abuso, atendimento de denúncias e cumprimento legal quando necessário. O acesso administrativo deve ser restrito e controlado.'] },
  { title: 'Banco virtual', paragraphs: ['Os dados do Banco virtual são utilizados apenas para operar a economia fictícia da comunidade. Uma transferência poderá gerar registros para remetente, destinatário, administradores autorizados quando necessário e logs de auditoria. Esses registros não representam operações financeiras reais.'] },
  { title: 'Compartilhamento de dados', paragraphs: ['Dados poderão ser compartilhados quando necessário com prestadores que auxiliem no funcionamento da plataforma, como hospedagem, armazenamento, envio de e-mail, segurança, autenticação, infraestrutura e suporte técnico. Também poderá ocorrer compartilhamento quando exigido por lei ou autoridade competente. O VYBE não declara vender dados pessoais.'] },
  { title: 'Cookies e tecnologias semelhantes', paragraphs: ['A plataforma poderá utilizar cookies e armazenamento local para autenticação, sessão, segurança, preferências, funcionamento da interface e análise técnica quando implementada. Quando necessário, serão implementados mecanismos adequados de informação e escolha.'] },
  { title: 'Segurança', paragraphs: ['O VYBE deve utilizar medidas técnicas e administrativas adequadas para proteger os dados, que podem incluir hashing de senhas, controle de acesso, isolamento entre comunidades, logs, monitoramento, conexões seguras e validações server-side. Nenhuma plataforma pode garantir segurança absoluta.'] },
  { title: 'Retenção', paragraphs: ['Os dados serão mantidos pelo período necessário para cumprir as finalidades para as quais foram coletados e conforme obrigações legais, segurança e prevenção de fraude. Os prazos específicos dependem de uma política de retenção que poderá ser detalhada futuramente.'] },
  { title: 'Direitos do usuário', paragraphs: ['Nos termos da legislação aplicável, o usuário poderá possuir direitos relacionados aos seus dados, incluindo, quando cabível:'], bullets: ['confirmação do tratamento e acesso;', 'correção;', 'informações sobre o tratamento;', 'exclusão nos casos aplicáveis;', 'revogação de consentimento quando aplicável;', 'portabilidade quando aplicável;', 'oposição nos casos previstos em lei.'], note: 'Um canal de privacidade poderá ser disponibilizado nas configurações da conta.' },
  { title: 'Exclusão da conta', paragraphs: ['Quando o usuário solicitar exclusão, informações poderão ser removidas ou anonimizadas conforme aplicável. Determinados registros poderão ser mantidos por obrigação legal, segurança, prevenção de fraude ou auditoria.'] },
  { title: 'Crianças e adolescentes', paragraphs: ['O tratamento de dados de crianças e adolescentes deve observar a legislação aplicável. Antes do lançamento, o VYBE deverá definir claramente a idade mínima da plataforma, regras do Match, mecanismos de proteção e eventual necessidade de consentimento ou controles adicionais.'] },
  { title: 'Transferências internacionais', paragraphs: ['Caso fornecedores ou infraestrutura processem dados fora do Brasil, o VYBE deverá tratar transferências internacionais conforme a legislação aplicável. Esta Política não cita fornecedores específicos que ainda não estejam efetivamente contratados.'] },
  { title: 'Atualizações desta Política', paragraphs: ['Esta Política poderá ser atualizada para refletir mudanças legais, técnicas, novos aplicativos ou novas funcionalidades. Alterações relevantes poderão ser comunicadas pela plataforma.'] },
  { title: 'Controlador e contato', paragraphs: ['Antes da publicação oficial, esta seção deverá identificar o nome ou razão social do responsável pelo VYBE, as informações exigidas legalmente, o canal de contato e o canal de privacidade ou encarregado quando aplicável. Esses dados não serão inventados.'] },
];

function LegalPage({ kind }: { kind: 'terms' | 'privacy' }) {
  const isTerms = kind === 'terms';
  const sections = isTerms ? terms : privacy;
  const version = isTerms ? LEGAL_TERMS_VERSION : LEGAL_PRIVACY_VERSION;
  const title = isTerms ? 'Termos de Uso do VYBE' : 'Política de Privacidade do VYBE';
  const otherHref = isTerms ? '/politica-de-privacidade' : '/termos-de-uso';
  const otherTitle = isTerms ? 'Política de Privacidade' : 'Termos de Uso';

  return <main className="legal-page">
    <header className="legal-topbar"><a className="brand" href="/" aria-label="VYBE — página inicial"><VybeLogo className="brand-reference-image"/></a><a className="legal-back" href="/">Voltar</a></header>
    <div className="legal-layout">
      <aside className="legal-toc" aria-label="Índice desta página"><strong>Nesta página</strong><nav>{sections.map((section, index) => <a key={section.title} href={`#secao-${index + 1}`}>{section.title}</a>)}</nav></aside>
      <article className="legal-document">
        <p className="legal-eyebrow">VYBE · DOCUMENTOS</p>
        <h1>{title}</h1>
        <p className="legal-updated">Última atualização: {LEGAL_LAST_UPDATED} <span>·</span> Versão {version}</p>
        <p className="legal-draft">Rascunho inicial de produto. Este conteúdo ainda não foi revisado juridicamente.</p>
        {sections.map((section, index) => <section className="legal-section" id={`secao-${index + 1}`} key={section.title}>
          <h2>{index + 1}. {section.title}</h2>
          {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          {section.bullets && <ul>{section.bullets.map((item) => <li key={item}>{item}</li>)}</ul>}
          {section.groups?.map((group) => <div className="legal-data-group" key={group.title}><h3>{group.title}</h3><ul>{group.bullets.map((item) => <li key={item}>{item}</li>)}</ul></div>)}
          {section.note && <p className="legal-note">{section.note}</p>}
        </section>)}
        <footer className="legal-document-footer"><a href={otherHref}>{otherTitle}</a><a href="/">Voltar ao VYBE</a></footer>
      </article>
    </div>
  </main>;
}

export function TermsOfUsePage() { return <LegalPage kind="terms"/>; }
export function PrivacyPolicyPage() { return <LegalPage kind="privacy"/>; }
