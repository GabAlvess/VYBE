# VYBE

Plataforma de infraestrutura social para comunidades de roleplay: cada comunidade tem seu universo independente, com uma experiência centrada em personagens.

Slogan provisório: **Conecte seu universo.**

Consulte a [documentação](docs/README.md) para conhecer a proposta, as regras, o design, as decisões e o [plano de desenvolvimento](docs/plano-desenvolvimento.md).

## Desenvolvimento local

Requer Node.js 22 ou superior e npm.

```sh
npm install
cp .env.example .env
# Configure MONGODB_URI no .env local usando credenciais rotacionadas.
npm run dev
```

- Frontend: http://127.0.0.1:5173
- API: http://127.0.0.1:3001/api/health
- Prontidão do banco: http://127.0.0.1:3001/api/ready

Comandos úteis: `npm run check` valida tipos e builds dos workspaces. `MONGODB_URI` é opcional para iniciar a API; a rota `/api/ready` informa quando a conexão ao banco estiver ativa. Não adicione `.env` ao Git.

Após configurar `MONGODB_URI` apontando para `vybe_dev`, inicialize o banco vazio com `npm run db:init --workspace=@vybe/api`. O comando cria a coleção `communities` se ainda não existir e pode ser repetido.

Estrutura: `apps/web` contém o React, `apps/api` contém a API Node e `packages/shared` contém contratos compartilhados iniciais. `design-system` mantém o estudo visual e seus tokens.
