# Estrutura do produto

## Cinco ambientes

| Ambiente | Público e função |
| --- | --- |
| Site institucional | Apresentar o VYBE a donos de RPG, administradores e interessados. |
| Portal de descoberta | Apresentar comunidades que autorizem sua divulgação. |
| Rede social da comunidade | Permitir a participação dos jogadores por seus personagens. |
| Administração da comunidade | Gerir participantes, configurações locais e moderação autorizada. |
| Administração central | Gerir comunidades, recursos globais e casos escalonados. |

## Institucional e descoberta

O institucional prevê apresentação, como funciona, funcionalidades, comunidades, planos e contato. A definição comercial pode ficar para depois do MVP. Formulário, atendimento e serviços comerciais são possibilidades, sem implantação presumida.

Descobrir funciona como catálogo de universos. Cards e páginas públicas podem mostrar logo, capa, nome, categoria, descrição, regras públicas e política de entrada, conforme autorização da comunidade. Destaques, popularidade e filtros são possibilidades. Descoberta não cria uma rede social global nem mistura personagens ou conteúdo entre comunidades. O recorte dessas áreas para o lançamento está pendente.

## Jornada do jogador

1. Conhecer o VYBE e encontrar uma comunidade, ou acessar seu endereço/convite.
2. Criar conta no contexto daquela comunidade.
3. Aguardar aprovação quando exigida; solicitações podem ser aprovadas ou recusadas.
4. Criar ou concluir o personagem após eventual aprovação.
5. Entrar na rede, publicar, encontrar personagens, seguir e interagir.

A entrada pode ser aberta, por aprovação ou por convite válido. Combinações híbridas e códigos especiais são evolução futura. O login apresenta identidade da comunidade, marca VYBE discreta, e-mail, senha e cadastro quando permitido. A fase de recuperação de acesso precisa ser conciliada nos documentos de origem.

## Personagem e configurações

A proposta inicial considera um personagem por conta naquela comunidade. Nome, username, foto e biografia compõem a criação inicial. O perfil prevê capa, informações específicas do RPG, publicações e contadores de seguidores e seguindo. Campos configuráveis podem representar curso, profissão, cargo, departamento ou grupo; sua abrangência no MVP precisa ser detalhada.

Configurações privadas da conta tratam de e-mail, senha, sessões, privacidade, bloqueios e preferências. Configurações públicas do personagem tratam de identidade, imagens e campos autorizados. Alterações sensíveis seguem as regras da comunidade.

## Núcleo social

- Feed cronológico ou parcialmente cronológico, com seleção exata ainda pendente.
- Publicação de texto e imagem no MVP; múltiplas imagens, vídeo, enquetes e compartilhamentos posteriormente.
- Publicação com autoria do personagem, data, conteúdo, curtidas, comentários e ação de denúncia.
- Comentários com criação, exclusão do próprio comentário, denúncia e moderação autorizada.
- Uma curtida por personagem em cada publicação.
- Seguir, deixar de seguir e consultar seguidores e seguindo.
- Explorar e buscar personagens e usernames apenas na comunidade atual; sugestões e filtros são possibilidades.

Notificações devem ser consideradas na arquitetura. Notificações simples são opcionais no MVP; tempo real é pós-MVP. Mensagens privadas e Stories são posteriores.

## Proteção e moderação

Bloqueios, denúncias, moderação, justificativas e recurso básico integram o MVP. A denúncia prevê motivo, categoria e descrição opcional, para perfis, publicações e comentários; outros formatos acompanham suas respectivas funcionalidades.

Estados propostos de denúncia: recebida, em análise, resolvida, recusada e escalonada. Moderação pode manter ou remover conteúdo, advertir, suspender ou encaminhar casos. Recursos permitem revisar, manter ou alterar decisões, com justificativa. Detalhes de transições, prazos e visibilidade ainda precisam ser definidos.

## Administração da comunidade

O painel é separado da rede comum e limitado a pessoas autorizadas. Prevê gestão de solicitações, participantes, personagens, denúncias, recursos e configurações permitidas. O dashboard pode resumir participantes, pendências e ações recentes.

Papéis iniciais: `Member`, `Moderator`, `Admin` e `Owner`. A matriz exata de permissões está pendente. Administradores não podem alterar livremente a identidade dos personagens nem acessar irrestritamente conversas privadas futuras.

## Administração central

A equipe VYBE cria, configura, ativa e suspende comunidades, gerencia funcionalidades e atende escalonamentos graves sob permissões específicas e auditadas.

Fluxo inicial de criação: registrar comunidade → definir nome e slug/subdomínio → configurar identidade → escolher entrada → atribuir responsável → ativar. A automação desse processo é futura.

Recursos podem ser habilitados por comunidade. Métricas, painéis avançados e mecanismos comerciais serão detalhados conforme a fase do produto.

Fonte: [Estrutura do produto](proposta/02-estrutura-do-produto.md).
