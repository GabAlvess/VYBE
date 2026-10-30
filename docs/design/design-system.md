# VYBE Design System — v0.1

Status: proposta visual inicial, baseada na direção solicitada: UI moderna, flat e com forte presença de ícones. Não representa aprovação final de todos os componentes.

## Direção

Usar a paleta VYBE em superfícies claras, com roxo como ação primária, lilás como seleção e grafite para leitura. Bordas sutis organizam os blocos. Evitar sombras decorativas, blur e gradientes na interface; as referências de marca orientam personalidade e cores. Conteúdo e personagem têm prioridade.

A referência social orienta o respiro, a navegação lateral, os avatares e a presença de ícones. Stories e mensagens não passam a fazer parte do MVP por aparecerem na referência. O símbolo em letra `v` na demonstração é provisório: não substitui o logo original nem representa um arquivo oficial de marca.

## Artefatos

- [Demonstração interativa](../../design-system/index.html).
- [Tokens CSS](../../design-system/tokens.css).
- [Estilos e componentes](../../design-system/styles.css).
- [Interações locais](../../design-system/demo.js).

Não há dependências ou etapa de build. Para abrir com servidor local, executar na raiz do repositório:

```sh
python3 -m http.server 8000 --directory design-system --bind 127.0.0.1
```

As interações de publicar, curtir e seguir existem apenas na memória da página. Não há autenticação, persistência, upload ou integração com a aplicação.

## Tokens

| Categoria | Definição inicial |
| --- | --- |
| Marca | Roxo `#7047EB`, hover `#6036D6`, roxo escuro `#43249A`, lilás `#F0EBFF` |
| Superfícies | Branco `#FFFFFF`, canvas `#F6F6F8`, borda `#E6E4ED` |
| Texto | Principal `#24232B`, secundário `#686575` |
| Sucesso | Texto `#23734B`, fundo `#EAF6EE` |
| Atenção | Texto `#815400`, fundo `#FFF4D9` |
| Erro | Texto `#B52C49`, fundo `#FFF0F3` |
| Tipografia | System sans; Inter apenas se já disponível no dispositivo, sem download externo |
| Escala | Corpo 14–16 px; títulos de seção 20 px; destaque responsivo 36–58 px |
| Espaçamento | Base 4 px; passos 4, 8, 12, 16, 20, 24, 32 e 48 px |
| Raios | 8, 12 e 20 px; pill para elementos circulares |
| Movimento | 150 ms; respeitar preferência por movimento reduzido |

Tokens são nomes semânticos compartilhados. A personalização futura deve mapear tokens autorizados da comunidade e validar contraste; não permitir troca arbitrária de todas as variáveis.

## Componentes iniciais

- Botões primário, secundário, contorno, destrutivo, desabilitado e somente ícone.
- Inputs com label, ajuda, erro e foco visível; textarea no compositor.
- Badges com texto e significado independente da cor.
- Avatares, navegação, cards, publicação e ações sociais.
- Modal nativo de criação de publicação, com cancelamento e fechamento por Escape.
- Estados locais de curtir/seguir com `aria-pressed` e retorno em região de status.

Botões têm área mínima de 44 × 44 px. Ícones decorativos não são anunciados; ações sem texto têm nome acessível. Não usar placeholder como substituto de label. Desabilitar uma ação não substitui explicar indisponibilidade no fluxo real.

## Iconografia

SVGs locais em grade 24 × 24, traço 1,7 px, pontas e junções arredondadas. Ícones renderizados normalmente a 20 px e alinhados com o texto. O conjunto inicial é próprio e está embutido como sprite na demonstração, sem CDN. Inclui início, explorar, personagem, curtir, comentário, imagem, busca, proteção, denúncia, configurações e ações auxiliares.

Usar ícone com texto na navegação principal e em ações menos familiares. Não usar somente cor para indicar seleção ou status. Uma futura biblioteca deve manter uma única família visual e licença documentada.

## Layout responsivo

Desktop: sidebar do design system, conteúdo com largura limitada e estudo social com navegação, feed e apoio. Abaixo de 1150 px, reduzir a navegação e remover a coluna complementar do estudo. Abaixo de 720 px, reorganizar em uma coluna e navegação horizontal. Esse estudo não fecha o layout de todas as telas do produto.

## Próximos passos

Validar a direção visual, receber o logo vetorial original, escolher tipografia definitiva, desenhar estados completos e telas de login, aprovação, perfil e moderação. Expandir componentes de formulário e navegação conforme essas jornadas. Definir tema escuro e personalização de comunidades em etapas posteriores, sem presumir que já existem.
