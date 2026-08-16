# Certificados digitais (Prompt 04b)

Certificado vencido = **cegueira de NF-e** naquela empresa. Todo o módulo existe para
que essa cegueira seja avisada com antecedência, em vez de descoberta quando as notas
param de chegar.

## Onde está o quê

- **Banco**: migrations `0062` (tabelas, RLS, seeds de notificação), `0063` (RPCs),
  `0064` (ocultar cliente, corte de 10 anos, crédito) e `0116` (funil de captura).
  Tabelas: `certificados` (uma linha por CNPJ), `certificados_ocultos`,
  `certificado_cards` e `certificado_card_eventos`.
- **Core** (`packages/core/src/certificados/`): `avaliarCertificado()` — a regra de
  estado/cor, compartilhada por web, mobile e worker; `funil.ts` — colunas, regra de
  ganho e percentual de cobertura.
- **Worker** (`apps/worker/src/jobs/radar/certificados.ts`): sync diário + alertas +
  reconciliação do funil.
- **Web**: `/empresas/certificados` (grid) — aberta pelo botão no painel de Clientes
  Onepay — e `/comercial/certificados` (funil de captura).
- **Mobile**: `app/(tabs)/empresas/certificados.tsx` — indicadores + lista "Atenção".

## Estados e cores

| estado | cor | quando |
|---|---|---|
| `valido` | verde | `status = 'active'` e vence em mais de 30 dias |
| `vencendo` | amarelo | `status = 'active'` e vence em até 30 dias (inclusive hoje) |
| `vencido` | **laranja** | data passou **ou** `status ≠ 'active'` |
| `ausente` | vermelho | não há certificado na base |

**Quatro cores, não três.** Vencido e ausente param a ingestão do mesmo jeito, mas
pedem ações diferentes: vencido é um cliente que tinha certificado e deixou expirar
(liga-se para renovar); ausente é um CNPJ que nunca apareceu no endpoint (investiga-se
o cadastro, ou é SPE que nunca operou). Com uma cor só, "cobre o cliente" e "confira o
cadastro" ficavam misturados.

**`ausente` é vermelho, não cinza.** O efeito prático de "não temos o certificado" é o
mesmo de "está vencido": nenhuma NF-e daquela empresa é ingerida.

A regra vive **em um lugar só** (`packages/core`) porque três consumidores dependem
dela responder igual. Um quadrado verde na tela ao lado de uma notificação de
"vencido" destrói a confiança na página inteira — e a notificação seria a correta.

### Datas: a armadilha do fuso

O endpoint devolve `"2026-08-15T23:59:59"` — **sem fuso**. `new Date()` leria isso
como hora local, e o worker (UTC no Railway) discordaria do browser (UTC−3) em um dia
inteiro, mudando a cor do quadrado e se o alerta dispara. `parseDataCertificado()`
interpreta como UTC.

Ela também normaliza o `+00` que o Postgres emite para `timestamptz`: é fuso válido em
Postgres e **inválido** em ECMAScript. Sem isso, toda data virava `Invalid Date`, todo
certificado virava `ausente` e o grid ficava inteiro vermelho — falha convincente e
silenciosa. Há teste para os dois casos, e a suíte roda igual em qualquer `TZ`.

## Sync (diário)

`POST /jobs/radar/certificados` → `sincronizarCertificados()`. Encadeado ao cron dos
clientes Onepay (`/api/cron/radar-onepay`): mesma origem, mesma janela.

O disparo dos certificados **não é condicionado** ao sucesso do temperature-report —
são dados independentes, e deixar de saber que um certificado vence porque o outro
endpoint caiu seria trocar um problema por outro pior.

- Guarda **todos** os certificados, inclusive de fornecedores (§1). O grid mostra só
  construtoras clientes e suas SPEs; o KPI "total ativos" conta tudo.
- Dois certificados para o mesmo `taxId` (renovação em curso): fica o de **maior**
  `expires_at`. A consolidação acontece depois de baixar todas as páginas, porque o
  mesmo CNPJ pode vir em páginas diferentes.
- Registra em `mercado_ingestoes` (fonte `onepay_certificados`) — é lá que alguém vai
  perguntar "por que o grid está com data de ontem?".

### Alertas e dedupe

`certificado.vencendo`, `certificado.vencido` e `certificado.renovado` viram evento na
empresa (timeline) e notificação para Admin e Crédito.

O dedupe é a coluna `ultimo_alerta`: **só emite quando o estado muda**. Sem isso,
"vencendo" seria reemitido todos os dias durante 30 dias — e um alerta que chega todo
dia deixa de ser lido no terceiro. Só empresas **na base** geram evento: alerta sobre
CNPJ que ninguém acompanha é ruído.

## O grid, e onde ele se afasta da spec

A spec pede "uma coluna por SPE". Contra a base real isso não funciona: uma
construtora tem **370 SPEs** (são 744 no total, entre 47 clientes). 370 colunas não
cabem em tela nem em impressão.

O que foi feito: o grid continua **por linha**, como a spec manda, mas cada linha rola
horizontalmente e as células vêm **ordenadas por urgência** (vencido → ausente →
vencendo → válido), com as 24 primeiras visíveis e o resto atrás de um "+N". Assim o
que exige ação está sempre nos primeiros centímetros da linha.

À direita de cada linha fica o **crédito disponível** do cliente na Onepay: é ele que
decide se vale correr atrás do certificado — cliente sem limite não opera nem com
certificado em dia.

### O que some do grid

- **Clique em qualquer quadrado** → confirmação → some do grid e **das estatísticas**
  (`certificados_ocultos`). Vale para SPE e para a matriz: ocultar um cliente serve
  para quem não se pretende cobrar certificado, e tira a linha do denominador.
- **SPE aberta há mais de 10 anos some sozinha**, sem ocupar linha na tabela de
  ocultos — é regra, não decisão de alguém. Obra encerrada mantém o CNPJ vivo na
  Receita e ninguém vai renovar certificado dela. Na base atual isso corta 27 das 744.
- Ocultar é preferência **global**, não por usuário: quem esconde está dizendo "esta
  não opera", e isso vale para o time. Por usuário, cada um veria um grid diferente e
  a conversa sobre cobertura ficaria impossível.

### Tooltip

Fundo escuro, uma informação por linha (empresa, CNPJ, situação, vencimento, prazo).
O `title` nativo não permite quebra de linha confiável nem tamanho legível, e este
tooltip é lido de relance durante uma ligação. Abre em 150ms, não nos 700ms do padrão:
aqui o mouse varre dezenas de quadrados procurando um.

### Por que a RPC é SECURITY DEFINER

As SPEs vivem em `mercado_universo`, cuja policy exige o módulo `mercado`. Quem tem só
`empresas` — o público desta página — não leria SPE nenhuma, e o grid apareceria com a
coluna Matriz e mais nada: vazio de um jeito convincente, que é o pior modo de falhar
(o mesmo problema que a migration `0060` documenta).

O recorte é estreito e é o que justifica o DEFINER: devolve apenas CNPJ e nome das
SPEs **do grupo de um cliente Onepay que é construtora**. Não é acesso ao universo de
mercado.

## Indicadores

1. **% clientes com certificado válido** — matrizes verdes ou amarelas ÷ construtoras
   clientes.
2. **% SPEs com certificado válido** — SPEs visíveis verdes ou amarelas ÷ SPEs
   visíveis, com **uma casa decimal**: são centenas de SPEs, e 1% arredondado esconde
   movimento de várias empresas. Ocultar uma SPE a tira do denominador.
3. **Total de certificados ativos** — **escopo maior de propósito**: conta a base
   inteira, inclusive fornecedores, que não aparecem no grid. O card diz isso no
   tooltip.

## Mobile

O grid não vem para o celular: 47 × 370 não é consultável em 6". A tela entrega os
três indicadores e a lista **Atenção** (amarelos e vermelhos, por urgência) com toque
para a Company 360 — só quando a SPE existe em `empresas`, senão não há para onde ir.

## Tools (módulo Empresas)

- `certificados.status_geral` — os três indicadores + até 50 itens que exigem ação.
- `certificados.consultar` — estado do certificado de um CNPJ, inclusive fornecedor.

Ficam em **Empresas**, e não em Radar, porque é lá que o painel de Clientes Onepay
mora hoje.

## O funil de captura (`0116`)

O grid é uma **foto**: você olha, fecha a aba e nada aconteceu. O funil em
`/comercial/certificados` é a **fila de trabalho** que fecha as lacunas que o grid
mostra. Mesma origem, perguntas diferentes — e as duas telas se linkam.

**Um card por cliente, não por CNPJ.** São 1.017 CNPJs no escopo e 1.002 sem
certificado; um card por CNPJ seria uma fila de mil itens que ninguém encara. A ligação
é uma só — com a construtora — e as SPEs do grupo entram dentro do card dela. Hoje: 47
cards, o maior com **371 CNPJs**, o que faz da ordenação por urgência (matriz →
descoberto → vence antes) a própria interface do card.

### As colunas

| coluna | quem move |
|---|---|
| Universo de certificados | a máquina — entra tudo que falta ou vence em <30d |
| Iniciar prospecção | humano — escolhido para atacar, conversa ainda não começou |
| Em prospecção | humano |
| Emissão agendada | humano |
| Pendente só SPEs | **a máquina**, quando a matriz fica coberta |
| Ganho / Perdido | humano, com as regras abaixo |

`iniciar_prospeccao` separa a fila do que foi **escolhido** da fila. Sem ela, "Universo"
guardava as duas coisas — tudo que falta e o que se decidiu atacar — e uma coluna que
significa duas coisas não prioriza nenhuma.

`pendente_spes` é da máquina de propósito: ela separa "ainda não falei com o cliente"
de "o cliente resolveu o principal e sobrou a cauda". Dois trabalhos com ligações
diferentes na mesma coluna são dois trabalhos que ninguém prioriza. O RPC recusa um
humano arrastando card para lá sem a matriz coberta — senão o nome da coluna deixa de
valer.

### As regras que o banco garante

1. **Nunca ganho sem o certificado da matriz.** É ela que destrava a ingestão de NF-e;
   fechar sem ela é marcar a cegueira como resolvida. `app_mover_certificado_card`
   levanta exceção — a tela só desabilita o botão, e a tela não é a única porta.
2. **Perder exige motivo** (`motivos_perda`, contexto `certificado`).
3. **Auto-ganho só quando não sobra nada**: cliente sem SPE ganha sozinho no dia em que
   o certificado aparece; com SPEs, ganhar é decisão humana a partir de
   `pendente_spes`.

### Por que fechar não é para sempre — e o retrato que evita o loop

Perdido "sai até o fato mudar". A armadilha é o oposto do esperado: como a alimentação
é automática, o card voltaria **no dia seguinte** pelo mesmo certificado faltando que o
fez perder, e a coluna de perdidos seria decorativa.

Por isso o fecho grava um **retrato** (`fechado_matriz_coberta`, `fechado_cobertos`) e a
reabertura compara contra ele, não contra o absoluto. Reabre quando a cobertura
**regride**: a matriz perdeu validade, ou um certificado que existia venceu. E um card
perdido cuja matriz depois aparece sobe para `pendente_spes`/`ganho` — o fato mudou na
direção boa, e insistir na perda seria ignorar o cliente que resolveu sozinho.

**Coberto = certificado com mais de 30 dias.** Uma definição só (`certificado_universo`),
usada pelo percentual, pela lista de pendências e pela regra de reabertura.

### Escopo por vendedor

O gestor vê tudo; o **originador** vê os clientes da sua carteira
(`vendedor_carteira`, papel `originacao`). Vendedor sem carteira vê lista vazia — o
default de um escopo vazio é nada, não tudo. A escrita revalida o escopo: uma escrita
que confia no filtro da leitura é uma escrita sem dono.

### `certificado_universo` e o revoke explícito

A view é SECURITY DEFINER porque lê `mercado_universo`, que o módulo comercial não
enxerga. O projeto tem *default privileges* concedendo select em `public` para `anon` e
`authenticated`, então ela **nasceu legível sem login** — CNPJ e vencimento de todo
cliente e SPE em `/rest/v1/certificado_universo`. O `revoke all ... from anon,
authenticated` na migration é o que fecha isso; não conceder não bastava.

### Reconciliação

`certificado_funil_sincronizar()` é **idempotente** e roda encadeada ao sync diário
(no mesmo job, não num cron próprio: agendar separado abriria uma janela em que a tela
mostra a coluna de ontem sobre o certificado de hoje). Falha dela não derruba o sync —
o certificado já está gravado, e a próxima rodada resolve.

**O funil não tem botão de sincronizar.** Com alimentação automática ele só ofereceria
a chance de clicar em algo que quase sempre não muda nada. Quem precisar forçar usa o
"Sincronizar" do grid, que dispara o job inteiro — e o job reconcilia o funil no fim.

### A tela

Card = **só leitura**: nome, CNPJ, escudo do estado da matriz e a barra de cobertura.
Clicar abre o detalhe, e é lá que se move, ganha e perde. Três botões por card
multiplicavam por 47 uma decisão que se toma uma vez, e comiam o espaço do que o card
tinha a dizer.

O detalhe é `flex-col` com `max-h-[85vh]` e miolo rolável (`min-h-0`), e não o `grid`
sem altura do primitivo: com listas de até 371 CNPJs a caixa crescia além da viewport
e cabeçalho, tabela e rodapé apareciam fora do fundo pintado.

O seletor de originador fica no **cabeçalho**, na mesma posição do funil de vendas e do
de reuniões — um filtro que muda de lugar entre telas irmãs custa uma procura por tela.

## Fora de escopo

Upload/renovação de certificado pelo JobsiteOS, fornecedores no grid (armazenados, não
exibidos) e histórico de certificados.
