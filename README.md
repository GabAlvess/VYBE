# VYBE

Plataforma de infraestrutura social para comunidades de roleplay: cada comunidade tem seu universo independente, com uma experiência centrada em personagens.

Slogan provisório: **Conecte seu universo.**

Consulte a [documentação](docs/README.md) para conhecer a proposta, as regras, o design, as decisões e o [plano de desenvolvimento](docs/plano-desenvolvimento.md).

## Desenvolvimento local

Requer Node.js 22 ou superior e npm.

```sh
npm install
cp .env.example .env
# Configure MONGODB_URI no .env local usando credenciais de desenvolvimento.
npm run dev
```

- Frontend: http://127.0.0.1:5173
- API: http://127.0.0.1:3001/api/health
- Prontidão do banco: http://127.0.0.1:3001/api/ready

No modo `development`, a API usa o banco `vybe_dev` (ou `VYBE_DEV_DB_NAME`) mesmo que a URI tenha outro banco no caminho. O seed aplica o mesmo override e se recusa a executar fora de `NODE_ENV=development`. Não adicione `.env` ao Git.

Inicialize a comunidade oficial e os dados fictícios de demonstração com:

```sh
npm run db:seed --workspace=@vybe/api
```

O seed é idempotente e usa `VYBE_DEMO_PASSWORD` para a conta `demo@community.vybe.test`. Se a variável estiver vazia ou ausente, usa `VybeDemo!2026`. Configure uma senha própria no `.env` local antes de compartilhar o ambiente.

No desenvolvimento local, `http://127.0.0.1:5173` serve o tenant definido por `VYBE_DEV_TENANT_SLUG` (padrão `community`). Em produção, o tenant oficial é `https://community.vybe.com.br`; `https://vybe.com.br` permanece a página da plataforma principal.

Rotas da comunidade: `/` (feed), `/explorar`, `/pulso`, `/eventos`, `/comunidade`, `/mensagens`, `/notificacoes` e `/@yasminmv` (perfil de demonstração). A API oferece endpoints de sessão, feed, publicações, curtidas, comentários, follows, perfis, eventos e notificações; as consultas recebem `tenantId` do middleware que resolve o host.

Comandos úteis: `npm run check` valida tipos e builds dos workspaces; `npm test` executa os testes. `npm run db:init --workspace=@vybe/api` continua disponível para inicializar a coleção. Não adicione `.env` ao Git.

Estrutura: `apps/web` contém o React, `apps/api` contém a API Node e `packages/shared` contém contratos compartilhados iniciais. `design-system` mantém o estudo visual e seus tokens.
