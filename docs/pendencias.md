# Questões em aberto

As pendências abaixo não alteram os princípios estabelecidos na proposta. Devem orientar o refinamento antes da implementação.

| Tema | Definição necessária |
| --- | --- |
| Recuperação de acesso | O Documento 02 inclui recuperação na tela de login (§8), mas a posiciona posteriormente na lista do MVP (§47). Confirmar fase e comportamento. |
| Notificações | Confirmar se notificações simples entram no MVP (§22); tempo real é pós-MVP. |
| Entrada | Detalhar modos disponíveis no lançamento, validade de convites e transições de aprovação/recusa. Entrada híbrida é futura. |
| Feed | Escolher cronológico ou parcialmente cronológico e suas fontes e critérios. |
| Bloqueios | Especificar efeitos em visualização, busca, seguidores e interações existentes. |
| Permissões | Definir a matriz de Member, Moderator, Admin, Owner e equipe central, incluindo dados privados acessíveis. |
| Moderação | Definir categorias, transições, justificativas obrigatórias, recursos, prazos e escalonamentos. |
| Personagens | Detalhar unicidade e alteração de username, campos configuráveis, capa e limites de edição no MVP. |
| Público e privado | Definir visibilidade padrão de conteúdo e campos, dados autorizados no catálogo e critérios de acesso. |
| Institucional e descoberta | Delimitar o recorte para lançamento; páginas descritas no produto não estão todas explicitadas na lista do MVP. |
| Tecnologia | Stack definida como monorepo React, Node.js e MongoDB. Escolher ferramentas e versões, persistência detalhada, isolamento, resolução de comunidade, domínio e hospedagem. Subdomínios são exemplos conceituais. |
| Banco de desenvolvimento | Criar/verificar `vybe_dev` no cluster existente; confirmar permissões do usuário e acesso de rede. Manter URI somente em configuração local secreta. |
| Segurança e operação | Detalhar sessões, abuso, limites e validação de uploads, auditoria, retenção, backups e restauração. |
| Design | Validar tipografia, contraste, componentes, protótipos e comportamento mobile. |
| Negócio e lançamento | Definir metas, métricas, critérios de aceitação, cronograma e responsáveis. Planos e preços ainda não foram definidos. |

Fontes: [Fundação](proposta/01-fundacao.md) e [Estrutura do produto](proposta/02-estrutura-do-produto.md). Registrar resoluções relevantes em [Decisões](decisoes/README.md).
