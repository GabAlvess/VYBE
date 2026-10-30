# Regras do produto

Estas diretrizes consolidam a proposta de produto; ainda não representam controles implementados.

## Isolamento e identidade

| ID | Regra |
| --- | --- |
| R01 | Cadastro em uma comunidade não concede acesso automático a outra. |
| R02 | O mesmo e-mail pode ser usado em comunidades diferentes, com contas independentes. |
| R03 | Personagens, seguidores, publicações, permissões, histórico e configurações não são compartilhados automaticamente. |
| R04 | Conta privada e identidade pública do personagem são separadas. Dados reais não aparecem automaticamente no perfil. |
| R05 | Exploração e busca de personagens ficam dentro da comunidade atual. |
| R06 | O identificador de comunidade enviado pelo navegador não basta para autorizar acesso a outro tenant. |

## Visibilidade e entrada

Comunidades podem ser públicas, privadas ou públicas com entrada controlada. Ser pública não torna todo conteúdo público. A divulgação e os dados apresentados externamente dependem da configuração autorizada. Comunidades privadas não aparecem no catálogo público e podem usar convite ou link específico conforme sua política de entrada.

Entradas abertas permitem cadastro e entrada direta; entradas com aprovação exigem análise; cadastro por convite exige convite válido. O personagem é criado ou concluído após eventual aprovação. Entrada híbrida é futura.

## Interações

Uma publicação recebe no máximo uma curtida por personagem. Participantes podem seguir e deixar de seguir personagens, comentar, excluir comentários próprios e denunciar conteúdos disponíveis. Bloqueios devem impedir ou limitar visualização, interação e contato; os efeitos precisos aguardam especificação.

## Permissões e administração

- Permissões relevantes são verificadas no servidor, nunca apenas na interface.
- A administração local só atua na própria comunidade e nas configurações autorizadas.
- Regras locais complementam as regras globais obrigatórias, sem desativá-las.
- Administradores não podem remover proteções fundamentais, acessar livremente conversas privadas ou alterar identidades sem motivo ou permissão adequada.
- A administração central também opera com controles, permissões específicas e auditoria.
- Ações relevantes, como suspensão, remoção de conteúdo, alteração de permissão, configuração e resolução de denúncia, geram registros suficientes para investigação.

## Proteção obrigatória

Segurança fundamental não é opcional nem premium. A plataforma prevê autenticação segura, proteção de sessões e contas, isolamento, prevenção de abuso, limitação de requisições, proteção de uploads, auditoria e backups. Denúncias, bloqueios, justificativas, recurso básico e moderação fazem parte do MVP.

Casos graves podem ser escalonados à equipe VYBE. Critérios de escalonamento, ações que exigem justificativa, retenção de registros e matriz de permissões precisam de detalhamento.

## Expansão

Antes de adicionar um recurso, esclarecer problema e público, pertencimento à plataforma ou comunidade, permissões, riscos, mobile, impacto entre comunidades, possibilidade de desativação e auditoria. Expandir após estabilizar a base.

Fontes: [Fundação](proposta/01-fundacao.md) e [Estrutura do produto](proposta/02-estrutura-do-produto.md). Pendências: [definições em aberto](pendencias.md).
