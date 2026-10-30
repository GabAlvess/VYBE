# 0001 — Fundação e fronteiras do produto

- Status: Estabelecida na proposta v1.0 fornecida pelo responsável pelo projeto.
- Data da decisão original: Não informada.
- Origem: [Documento 01](../proposta/01-fundacao.md) e [Documento 02](../proposta/02-estrutura-do-produto.md).

## Contexto

Comunidades de roleplay utilizam ferramentas fragmentadas e precisam de uma rede própria sem desenvolver toda a infraestrutura. A proposta define o produto e suas fronteiras antes da escolha de tecnologia.

## Diretrizes estabelecidas

- Infraestrutura compartilhada com comunidades independentes e isolamento de dados.
- Contas por comunidade, permitindo o mesmo e-mail em contas independentes.
- Separação entre conta privada e personagem público, centro da experiência social.
- Cinco ambientes: institucional, descoberta, rede social, administração local e administração central.
- Personalização controlada, preservando acessibilidade, segurança e consistência.
- Regras globais obrigatórias, autorização no servidor e administração com limites e auditoria.
- MVP com núcleo social, gestão e proteção; expansão gradual após estabilidade.

## Alternativas

Os documentos não apresentam uma avaliação formal de alternativas. Não há escolha de stack, banco de dados ou topologia de implantação neste registro.

## Consequências

Cadastro, permissões, busca, conteúdo e operações administrativas precisam respeitar a comunidade atual. Dados privados não podem ser expostos automaticamente no perfil. Segurança fundamental não pode depender de plano premium. Personalização e expansão devem preservar os limites da plataforma.

## Validação prevista

Verificar jornadas completas e isolamento entre pelo menos duas comunidades, incluindo reutilização de e-mail sem compartilhar contas ou permissões. Testar negativas de autorização no servidor, exposição de dados privados e limites administrativos. Estas validações ainda não foram executadas: o repositório contém documentação, sem aplicação implementada.

## Pendências

As ambiguidades de escopo e especificações ausentes estão em [Questões em aberto](../pendencias.md).
