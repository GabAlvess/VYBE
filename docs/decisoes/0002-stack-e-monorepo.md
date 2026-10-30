# 0002 — Stack inicial e organização do repositório

- Status: Definida pelo responsável pelo projeto.
- Data: Não informada.
- Escopo: arquitetura de alto nível; ferramentas e versões continuam em aberto.

## Contexto

O desenvolvimento do VYBE precisa organizar frontend, backend e persistência para implementar uma plataforma com várias comunidades independentes.

## Decisão

- Manter frontend e backend em um monorepo.
- Usar React no frontend.
- Usar Node.js no backend.
- Usar MongoDB como banco de dados.
- Criar um banco adicional para desenvolvimento, proposto como `vybe_dev`.
- Concentrar o acesso ao MongoDB no backend.

## Consequências

O monorepo pode compartilhar UI, tokens e validações sem separar prematuramente a aplicação em serviços. A API aplica autorização e isolamento por comunidade. Configuração MongoDB permanece em variável secreta; desenvolvimento e produção usam bancos distintos.

## Ainda não decidido

Gerenciador de pacotes e workspaces, frameworks, versões suportadas, biblioteca MongoDB, estratégia de autenticação, topologia de implantação e definição final do nome do banco.
