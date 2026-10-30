# Plano de desenvolvimento

Status: plano inicial, baseado na stack escolhida pelo responsável pelo projeto. Ordem sugerida; datas e responsáveis ainda não definidos.

## Stack definida

- Monorepo para organizar a aplicação web e a API.
- Frontend em React.
- Backend em Node.js.
- MongoDB como banco de dados.
- Banco adicional de desenvolvimento proposto: `vybe_dev`, separado do banco existente e de qualquer ambiente de produção.
- Acesso ao MongoDB via variável `MONGODB_URI`; montar a URI apenas no ambiente local a partir de credenciais fornecidas com segurança.

As versões de Node.js, React, framework HTTP, biblioteca de acesso ao MongoDB, gerenciador de pacotes e ferramenta de workspace serão escolhidas na etapa de fundação. A escolha deve considerar suporte atual, experiência da equipe e execução simples em desenvolvimento.

## Estrutura sugerida do monorepo

```text
vybe/
├── apps/
│   ├── web/                 # React: portal e experiência social
│   └── api/                 # Node.js: API e regras de negócio
├── packages/
│   ├── ui/                  # Componentes React compartilhados
│   ├── design-tokens/       # Tokens do design system
│   └── shared/              # Tipos e validações compartilhados
├── docs/
├── .env.example             # Nomes e exemplos sem credenciais reais
└── package.json             # Scripts e workspaces do monorepo
```

Começar com dois aplicativos e pacotes compartilhados pequenos. Não criar serviços separados antes de existir uma necessidade concreta. Manter a API responsável por autorização, validação, regras do produto e acesso aos dados; o frontend nunca acessa o MongoDB diretamente.

## Configuração local e banco

Variáveis esperadas pela API:

```dotenv
NODE_ENV=development
HOST=127.0.0.1
PORT=3001
MONGODB_URI=
```

`MONGODB_URI` deve apontar para o banco novo `vybe_dev`. A URI contém credenciais e deve existir apenas em um `.env` local ignorado pelo Git ou no gerenciador de segredos do ambiente de execução. `.env.example` documenta apenas nomes e valores não secretos. Nunca registrar URI, senha, arquivo de credenciais ou saída de conexão em logs ou documentação.

No MongoDB Atlas, um banco lógico pode ser criado no primeiro uso se a conta tiver autorização: conectar ao cluster e executar a primeira gravação em `vybe_dev` cria o banco e sua coleção. Antes da implementação, confirmar que a credencial tem permissões adequadas no cluster e que a lista de acesso de rede permite o ambiente de desenvolvimento. Evitar copiar dados de produção para desenvolvimento.

O comando `npm run db:init --workspace=@vybe/api` usa a URI local e cria a coleção inicial vazia `communities`; é repetível e não insere dados fictícios. A inicialização remota ainda depende de acesso de rede TCP autorizado ao cluster.

## Fases de execução

### 1. Fundação do repositório

- Definir versões e ferramentas, criar workspaces e scripts de desenvolvimento.
- Criar `apps/web`, `apps/api` e os pacotes compartilhados mínimos.
- Adicionar `.gitignore`, `.env.example`, configuração de formatação e lint.
- Documentar instalação, execução local e configuração segura.
- Adicionar verificações automatizadas para lint, tipos, testes e build.

**Saída:** desenvolvedor consegue iniciar web e API pelos scripts da raiz, sem expor credenciais.

### 2. API e conexão com MongoDB

- Criar inicialização da API com validação de variáveis obrigatórias e encerramento limpo.
- Implementar endpoint de saúde que informe estado do processo e da dependência sem revelar URI ou detalhes sensíveis.
- Conectar ao banco `vybe_dev` usando `MONGODB_URI`.
- Criar índices e validações junto aos primeiros modelos, com estratégia de atualização reproduzível.
- Preparar dados fictícios locais; não usar dados reais de jogadores.

**Saída:** API confirma conexão com o banco de desenvolvimento e falha claramente se a configuração estiver ausente ou inválida.

### 3. Aplicação web e componentes

- Implementar a base React e conectar ao endpoint de saúde.
- Transpor os tokens e componentes do [design system](design/design-system.md) para `packages/ui` e `packages/design-tokens`.
- Criar layout responsivo, navegação, estados de carregamento, erro e vazio.
- Não apresentar publicação local demonstrativa como dado persistido.

**Saída:** frontend e API funcionam juntos localmente e compartilham componentes sem acoplamento ao banco.

### 4. Identidade, comunidade e autorização

- Modelar comunidades e contexto de tenant.
- Implementar cadastro, sessão segura e fluxo de entrada configurável.
- Implementar personagens separados dos dados privados da conta.
- Definir e aplicar autorização no servidor em cada operação.
- Testar que buscas, conteúdo e administração não cruzam comunidades.

**Saída:** usuário participa somente dos universos para os quais tem acesso.

### 5. MVP social e proteção

- Implementar perfil, feed cronológico, publicações de texto/imagem, curtidas, comentários e seguidores.
- Implementar bloqueios, denúncias, moderação, auditoria e recursos conforme regras aprovadas.
- Validar uploads, limitar abuso e garantir que ações administrativas tenham escopo e justificativa.
- Entregar os painéis de comunidade e central com permissões mínimas necessárias.

**Saída:** jornada de entrada, personagem, publicação, interação e moderação pode ser validada ponta a ponta.

### 6. Preparação para lançamento

- Revisar segurança, acessibilidade, performance e comportamento em dispositivos móveis.
- Preparar backups e ensaiar restauração; definir observabilidade sem dados pessoais desnecessários.
- Separar configurações e bancos de desenvolvimento, teste e produção.
- Definir migração, implantação, domínio, política de privacidade e critérios mensuráveis de lançamento.

**Saída:** publicação ocorre com configuração segura, recuperação testada e operação documentada.

## Testes e critérios de qualidade

- Unidade: validações, regras de negócio e permissões.
- Integração: API e MongoDB de teste; confirmar criação de banco/coleções e comportamento dos índices.
- API: autenticação, autorização, erros e isolamento por comunidade.
- Interface: componentes acessíveis, estados de tela e jornadas prioritárias.
- Ponta a ponta: entrada, criação de personagem, publicação, interação e moderação.
- Build: lint, verificação de tipos e build de todos os workspaces.

Testes não devem depender de produção. Usar banco e contas de teste isolados e conteúdo fictício.

## Critério para começar a implementação

1. Criar e verificar o acesso ao banco `vybe_dev` sem colocar a senha no Git ou no chat.
2. Confirmar permissões do usuário de banco e acesso de rede do ambiente de desenvolvimento.
3. Escolher versões e ferramentas do monorepo.
4. Aprovar as pendências de produto que afetam os primeiros modelos e fluxos, em especial permissões, entrada e visibilidade.

Referências: [roadmap](roadmap.md), [questões em aberto](pendencias.md), [estrutura do produto](produto.md) e [fundação do VYBE](proposta/01-fundacao.md).
