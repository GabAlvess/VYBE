# Roadmap

O escopo abaixo vem da proposta v1.0. A sequência é uma organização sugerida para execução, sem datas, responsáveis ou compromissos comerciais definidos. Nenhum item está marcado como implementado.

A stack inicial é monorepo com React, Node.js e MongoDB. Consulte o [plano de desenvolvimento](plano-desenvolvimento.md) para estrutura, etapas e qualidade.

## 1. Refinamento e fundação técnica

- [ ] Criar e verificar o banco de desenvolvimento `vybe_dev` e configurar acesso seguro.
- [ ] Definir workspaces, versões e ferramentas do monorepo.
- [ ] Resolver as [pendências de escopo e comportamento](pendencias.md).
- [ ] Definir arquitetura, modelo de dados, endereçamento e estratégia de isolamento.
- [ ] Detalhar permissões, segurança, uploads, auditoria e backups.
- [ ] Preparar execução, testes e integração contínua.

## 2. MVP — plataforma e comunidade

- [ ] Estrutura multi-comunidade, banco de dados e isolamento de tenants.
- [ ] Administração central básica e criação de comunidades.
- [ ] Configuração, identidade básica, responsável e política de entrada.
- [ ] Cadastro, login e sessão segura por comunidade.
- [ ] Aprovação de participantes e detalhamento dos modos de entrada suportados no lançamento.

## 3. MVP — personagem e rede social

- [ ] Criar personagem com nome, username, foto, bio e perfil.
- [ ] Feed cronológico ou parcialmente cronológico, conforme decisão pendente.
- [ ] Publicações de texto e imagem.
- [ ] Curtidas, comentários, seguir e deixar de seguir.
- [ ] Detalhar exploração, busca e campos personalizados previstos no produto.
- [ ] Validar as jornadas em desktop e mobile.

## 4. MVP — proteção e administração

- [ ] Bloqueios e denúncias.
- [ ] Moderação, justificativas e recurso básico.
- [ ] Painel da comunidade e gestão de participantes.
- [ ] Painel central, permissões e registros administrativos relevantes.
- [ ] Validar isolamento entre comunidades, privacidade e autorização no servidor.

Segurança é transversal às entregas anteriores; esta etapa consolida sua validação e não posterga proteções fundamentais.

## 5. Validação e lançamento

- [ ] Validar entrada → eventual aprovação → personagem → publicação → interação.
- [ ] Validar denúncia → análise → ação justificada → recurso e eventual escalonamento.
- [ ] Demonstrar que contas, buscas, conteúdo e administração não vazam entre comunidades.
- [ ] Definir critérios mensuráveis de lançamento e testar operação, acessibilidade e recuperação de dados.
- [ ] Definir o recorte inicial do institucional e da descoberta.

## Escopo a conciliar

Recuperação de acesso aparece na tela de login, mas é explicitamente posterior na lista do MVP. Notificações simples são opcionais no MVP; sua inclusão não está fechada. Planos e definições comerciais não precisam estar concluídos no MVP. Ver [pendências](pendencias.md).

## Pós-MVP

Após estabilidade da base, avaliar recuperação de acesso conforme conciliação de escopo, mensagens privadas, Stories, notificações em tempo real, múltiplos formatos de conteúdo, temas, personalização avançada, premium, monetização e sistemas específicos de RPG. Entrada híbrida e automação de criação de comunidades também são evoluções futuras.

No longo prazo: outros públicos de roleplay, marketplace, ferramentas para criadores, APIs e integrações externas. São possibilidades, não entregas assumidas.

Fonte de escopo: [Estrutura do produto, seções 47–49](proposta/02-estrutura-do-produto.md).
