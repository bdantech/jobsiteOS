# Meu Dia (04p)

A home do vendedor: **Comercial → Meu Dia**. Não é um dashboard — é uma lista de trabalho
finita e completável. Cada item responde três coisas num olhar: **por que está aqui**,
**quanto vale** e **qual o botão que resolve**.

Quatro regras governam a tela inteira, e cada uma resolve um jeito conhecido de matar a
adoção de um painel:

- **É uma grade de WIDGETS, não uma pilha de cards.** Pouca informação no menor espaço;
  rolagem interna é aceitável, ler dez cards para achar o dinheiro não é. A primeira
  versão listava tudo e o resultado foi o previsível: confusa e sem foco.
- **Bloco vazio some.** A página encolhe conforme o dia é trabalhado, e o fim dela é
  "Tudo em dia por aqui", não uma lista de zeros.
- **Indicador abre modal, nunca navega.** Perder a página é perder o contexto do dia.
- **Todo gráfico é clicável — ele É a lista.** Não decora o bloco; é o índice dele.
  Clicar numa fatia, numa bolha ou numa barra abre os itens daquele recorte.

## A forma de cada widget

Cada bloco declara no catálogo o seu `visual`, e é essa declaração que a tela lê — não há
um `if` por tipo de bloco na UI, e um bloco novo nasce com o widget certo por dizer qual é.

| `visual` | Responde | Onde |
|---|---|---|
| `pizza` | de quem é o volume parado | NFs de alta, por cedente |
| `bolhas` | duas grandezas ao mesmo tempo | certificados, inbound |
| `barras` | ranking por uma grandeza | carteira ociosa, conversas esperando |
| `rolagem` | lista longa num cartão só | fornecedores a cadastrar |
| `lista` | poucos itens, cada um com a sua ação | o padrão |

**Não há filtro de grupo.** Havia um — carteira / funil / cadastro — e ele era um botão que
escondia widget: o vendedor abria o dia, via nove painéis, clicava em "carteira" e passava a
ver três, sem nada lhe dizer que os outros seis continuavam existindo. Todos os painéis
aparecem de uma vez, e a rolagem é resposta melhor do que um filtro que apaga contexto. (O
celular ainda tem o filtro; ele entra no redesenho do mobile.)

Para o closer, o **mapa da carteira abre a grade**, não a fecha: é o retrato de onde está o
dinheiro pelo qual ele responde, e portanto o contexto de tudo o que vem depois.

O **mapa da carteira** é um treemap (squarify): a área de cada retângulo é a fração do
limite aprovado, e a soma delas é o componente inteiro. A versão anterior era uma fileira
de quadrados com `flex-wrap`, e deixava um rio de espaço vazio à direita que entrava na
leitura como se dissesse algo sobre a última linha. O preço do treemap é que a cauda fica
pequena de verdade: na carteira do Fabio, 13 dos 29 retângulos comportam o nome; os outros
16 são contas de R$ 300 mil para baixo numa carteira de R$ 18 milhões, e continuam com
tooltip e clique. Preferimos a área honesta ao rótulo em todos — o mapa existe para dizer
onde está o limite, e é o retângulo grande que tem de ler grande. Medido: cobertura de
100,00%, zero sobreposição, pior razão de aspecto 2,5:1.

**A paleta não foi escolhida no olho.** São os slots categóricos validados do sistema de
dataviz, rodados no validador para as duas superfícies: pior par adjacente em ΔE 9,1
(claro) e 8,4 (escuro) sob simulação de daltonismo, acima do piso de 8. O modo escuro tem
os seus próprios passos, não uma inversão do claro. Onde a cor clara fica abaixo de 3:1
contra a superfície, a regra de alívio está cumprida: toda fatia tem rótulo direto e a
legenda repete o valor em texto — nenhuma informação depende só de matiz.

O **status do temperature report** (`operating_normally`, `low_operation`,
`requires_attention`, `inoperative`) usa a paleta de status, que é reservada e nunca vira
"série 4". Ela sempre aparece com rótulo ao lado.

A pizza dos cedentes não tem legenda lateral: ela ficou com o componente inteiro, com
**rótulo direto** na fatia (nome + %) e o valor em reais no tooltip. O método de dataviz
prefere o rótulo direto à legenda justamente por dispensar o vaivém dos olhos. Fatia abaixo
de 7% não recebe rótulo — o texto colidiria com o vizinho — e depende do tooltip; é o preço
de seis fatias num círculo, e a razão de "Outros" existir.

A cor da bolha do inbound (azul aos 0h → vermelho às 96h) é **codificação redundante**: o
eixo X já diz quantas horas passaram e a cor repete. É o que torna legítimo usar dois tons
numa grandeza que só cresce — ela não separa categorias, ela grita.

## Onde cada coisa mora

| Peça | Arquivo |
|---|---|
| Catálogo dos blocos (fonte da verdade) | `packages/core/src/comercial/meu-dia.ts` |
| **Régua visual** (paleta, status, treemap) | `packages/core/src/comercial/meu-dia-visual.ts` |
| Agregador | `meu_dia()` + `app__md_originador/sdr/closer/comuns` no banco |
| Carga | `apps/web/src/components/comercial/meu-dia/queries.ts` |
| Tela (web) | `apps/web/src/components/comercial/meu-dia/meu-dia-tela.tsx` |
| Desenho (web) | `.../meu-dia/graficos.tsx` — recharts |
| Tela (celular) | `apps/mobile/app/(tabs)/comercial/index.tsx` |
| Desenho (celular) | `apps/mobile/src/features/comercial/components/graficos.tsx` — `react-native-svg` |
| Ações | `app_meu_dia_ocultar` / `_reexibir` / `_concluir_tarefa` no banco |
| Tabelas | migração `0190_meu_dia.sql` |

A **régua visual** mora no core pelo mesmo motivo do catálogo: paleta categórica, cores de
status, o gradiente da espera, a tinta legível e a geometria do treemap são *regra*, não
desenho. As duas plataformas desenham com bibliotecas diferentes — recharts na web,
`react-native-svg` no celular — mas leem os mesmos valores. Duplicá-los significaria que o
vermelho de `inoperative` pudesse ser um hex numa tela e outro na outra, e a mesma conta ser
"parada" aqui e "atenção" lá sem ninguém perceber até comparar as duas lado a lado. O
`squarify` tem dez testes no core, incluindo os degenerados (carteira vazia, um cliente só,
tudo zero, largura ainda não medida).

O **catálogo** é a única lista de blocos que existe. Ele dirige, ao mesmo tempo, os
limiares que o agregador aplica, o rótulo e a ação de cada card, e a tela de settings.
Três listas em três lugares divergiriam no primeiro bloco novo — e o sintoma seria um
bloco que aparece na tela e não aparece nas configurações.

## De onde vem cada número

### Originador
| Bloco | Fonte | Limiar |
|---|---|---|
| NFs de alta não prospectadas | `notas_fiscais` faixa `alta`, estágio `a_prospectar`, do vendedor | — |
| Antecipações travadas | `antecipacoes` em `DRAFT/REQUESTED/REPROVED/DENY_BY_CONTRACTED` sem conversão | dias parada (3) |
| Cedentes que pararam | `antecipacoes` agrupadas por cedente da carteira | dias sem antecipar (45), mínimo de antecipações (2) |
| Fornecedores a cadastrar | `fornecedores_funil` estágio `a_cadastrar` com contato | — |
| Certificados a prospectar | `certificado_universo` das empresas da carteira | — |

### SDR
| Bloco | Fonte | Limiar |
|---|---|---|
| Inbound não contatado | `sdr_leads` origem `inbound`, estágio `a_contatar`, sem toque após a chegada | horas para virar urgente (4) |
| Leads perto de expirar | `sdr_leads` abertos, pelo último toque | SLA em dias (7), avisar faltando (2) |
| Conversas sem reunião | `conversas` do vendedor sem lead com reunião | dias parada (3) |
| No-shows | `sdr_leads` estágio `no_show` | — |
| Com fit, sem agendamento | `sdr_leads` com `fit` e sem `reuniao_em` | dias desde o fit (2) |
| Reuniões de hoje e amanhã | `sdr_leads.reuniao_em` | horizonte em dias (2) |

> **"Não contatado" não é `ultimo_toque_em is null`.** A rota de inbound carimba
> `ultimo_toque_em = distribuido_em` no nascimento do lead. A pergunta certa é se houve
> toque **depois** da chegada — sem isso, o bloco mais importante do SDR (aquele em que
> minutos importam) nunca encontrava nada.

### Closer
| Bloco | Fonte | Limiar |
|---|---|---|
| Aguardando documentação | `vendas` no estágio, pelo `atualizada_em` | dias parada (5) |
| Reuniões pendentes de aceite | `sdr_aceites` pendentes com destino nele | — |
| Crédito decidido | `vendas` + `analises_credito` aprovada/parcial/negada | — |
| Propostas sem resposta | `vendas` em `proposta_enviada` | dias parada (4) |
| Carteira ociosa | `clientes_onepay` da carteira do closer — parada há N dias **ou** apontada pelo temperature report. Traz as duas naturezas (`passivo` e `prospeccao_ativa`), e a tela filtra por elas | dias sem antecipar (30), limite mínimo (50k) |
| Novos clientes | `empresas.marco_ativacao` dentro da janela | janela em dias (60) |
| Certificados vencendo | `certificados` das empresas da carteira | avisar faltando (30) |
| Análises expirando | `analises_credito.expira_em` | avisar faltando (60) |

### De todos
Conversas paradas, aguardando minha resposta, próximos passos do Agente (05A) e tarefas
manuais.

> **Nomes.** Nenhum item chega à tela como CNPJ, como "Sem empresa" ou como um número de
> telefone. 183 dos 185 fornecedores do funil não têm ficha em `empresas` — mas todos têm
> nome na nota fiscal. O CNPJ é o último recurso, nunca o primeiro.
>
> Duas causas separadas produziam o mesmo sintoma, e cada uma tem a sua correção:
>
> - **`coalesce` não pula string vazia.** Onze empresas têm `nome_fantasia` = `''` (dez) ou
>   `'******'` (uma), e `coalesce(e.nome_fantasia, e.razao_social, …)` devolve o vazio —
>   coalesce só olha NULL. Quatro delas estão na carteira do Fabio, três com limite acima de
>   R$ 1 mi, e apareciam como quadrados mudos no mapa. `app__md_nome(text)` devolve o texto
>   só se ele tiver ao menos um alfanumérico.
> - **O nome do perfil não era lido.** 38 das 39 conversas do originador não têm empresa nem
>   contato, e o título caía no número do WhatsApp. Mas `conversas_nao_vinculadas.nome_sugerido`
>   — o nome do perfil de quem escreveu — já estava gravado para 35 delas, e ninguém fora da
>   fila de identificação o lia. A ordem passou a ser razão social → nome fantasia → contato
>   no CRM → nome do perfil → número.

> **"Só o que eu ainda não respondi" já era a régua.** `conversas_aguardando_resposta` filtra
> por `ultima_direcao = 'entrada'`. Conferido contra as mensagens: das 77 conversas abertas do
> Rodrigo, as 39 marcadas como 'entrada' têm mesmo uma mensagem recebida como última, e as 38
> marcadas como 'saida' têm uma enviada — nenhuma resposta de IA no meio. A flag não estava
> mentindo; o que enganava era o título sem nome.

> **A régua de dias sozinha perdia conta boa.** A Halsten tem R$ 1,4 mi parados e
> `requires_attention` no report, mas antecipou há dois dias — pela régua antiga ela sumia
> justamente do dia de quem devia estar olhando para ela. O sinal da plataforma entra como
> segunda porta, e a ordem é o limite ocioso, do maior para o menor.

> **O bloco nunca foi só de passivas.** `v_passiva` junta os papéis `gestao_passiva` e
> `vendedor`, e no papel `vendedor` cabem tanto a conta passiva quanto a que está em
> prospecção ativa. No Fabio são 8 passivas e 7 ativas — e as ativas respondem por R$ 13,4
> dos R$ 18,0 milhões ociosos, incluindo as três maiores. O título dizia "Carteira passiva
> ociosa" sobre uma lista majoritariamente ativa; passou a "Carteira ociosa", `meta`
> carrega o `gestao_operacao`, e o widget filtra entre ambas / passiva / ativa. O teto do
> bloco subiu de 12 para 20 porque um teto aplicado ANTES do filtro faz o filtro mentir.

## Comissão projetada — fora da tela

O indicador de comissão projetada **não existe mais**, em nenhum cargo. A faixa de
indicadores tem três: em jogo hoje, urgentes, e o do cargo.

Com ele saiu o cálculo que só a ele servia: em `carregarMeuDia()` iam embora a leitura
inteira de `commission_params`, a das contas dos itens projetáveis e a corrida do motor do
04k a cada carregamento da página. Um número que ninguém lê continua custando as consultas
que o produzem.

O motor continua de pé: `projetarComissao()` segue exportado do core e com os seus testes,
rodando o mesmo VOP (`valor × dias / N`), a mesma fase e a mesma taxa vigente do 04k. **Ele
ficou sem chamador** — o que saiu foi a chamada, não a régua, para que voltar a projetar em
outra tela não signifique reescrever a fórmula. O celular nunca teve o indicador.

## Abrir sem perder o lugar

Todo link do Meu Dia para uma tela nossa abre **numa aba do sistema**, via `<LinkEmAba>`
(`components/shell/link-em-aba.tsx`), que é o par `openTab` + `router.push` do shell.

Antes era `target="_blank"`, e ele resolvia a metade errada do problema: a tela de origem
continuava aberta, sim, mas numa aba do NAVEGADOR — fora da barra de abas, sem o estado do
shell e sem o voltar contextual. Pior: `RouteSync` recusa de propósito qualquer `<a>` com
`target` diferente de `_self` (`internalRoute()`), então o `target="_blank"` desligava o
sistema de abas exatamente onde ele estava sendo pedido.

Continua sendo um `<a>` com `href` de verdade: cmd+clique, botão do meio e "abrir em nova
aba" do menu do navegador seguem funcionando, e o `onClick` só muda o clique simples. Link
externo — site do cliente, tribunal — segue `target="_blank"`: aquilo não é tela nossa.

## Quem vê o dia de quem

- **Auxiliar do closer**: espelha integralmente o dia do superior. O cabeçalho diz
  "Carteira de {closer}". A tradução mora em `cargoDeVisao()` e em `app_meu_dia_cargo()`.
- **Gestor**: seletor no topo, **leitura**. Ele vê, mas não adia nem descarta — decidir o
  dia dos outros é diferente de olhar para ele. Quem pode **mexer** vem de
  `app_meu_dia_alvos()`: eu, e o meu closer quando sou auxiliar.

## Ajustar os limiares

**Comercial → Configurações → Meu Dia**, por tipo de vendedor. Quem edita é o gestor
comercial (Admin ou o perfil Comercial) — quem responde pelo time é quem calibra a régua
dele; deixar isso só com o Admin transformaria cada ajuste num pedido para outra pessoa,
e limiar que depende de pedido não é ajustado, é suportado.

A tela é **gerada pelo catálogo**. Não é economia de código: é o que garante que um bloco
novo nasça configurável. Um formulário escrito à mão produziria, na primeira adição, um
bloco que aparece para o vendedor e não aparece aqui — existe, incomoda, e ninguém
desliga.

A tabela `meu_dia_config` guarda **só o override** — chave ausente cai no padrão do
catálogo, e voltar um campo ao padrão APAGA a chave em vez de gravar o mesmo número.
Assim, se o padrão mudar amanhã, quem nunca mexeu acompanha; quem gravou "5" fica com 5.

## O resumo matinal

`/api/cron/meu-dia-resumo`, às **8h de São Paulo em dia útil** (`0 11 * * 1-5` em UTC).
Job em `apps/worker/src/jobs/comercial/meu-dia-resumo.ts`.

> *"Bom dia — 12 itens, 3 urgentes, R$ 340k em jogo"*, com deep link para a tela.

Duas decisões que separam hábito de ruído:

- **Dia vazio não notifica.** Um push dizendo "nada para hoje" ensina que a mensagem não
  precisa ser aberta — e a lição vale também para os dias em que precisava.
- **Dia útil, não todo dia.** Quem desliga a notificação por causa do sábado desliga para
  a terça junto.

O número vem de `app__md_montar`, a **mesma** função que a tela chama depois de autorizar.
Se o push contasse por conta própria, a pessoa abriria o app atrás de doze itens e
encontraria nove — e a partir daí não abriria mais.

Cada pessoa desliga em **Configurações → Notificações → "Resumo do Meu Dia, às 8h"**. A
preferência é separada de `push_web`/`push_mobile` porque a pergunta é outra: aquelas
dizem por onde avisar, esta diz se a lista de trabalho deve procurar a pessoa de manhã.
Sem o desligamento próprio, quem acha o resumo intrusivo desliga o push inteiro.

A calibragem tem insumo: `meu_dia.item_adiado` e `meu_dia.item_irrelevante`. A distinção
importa — adiar é escolha de agenda, marcar irrelevante é **voto contra a régua do bloco**,
e por isso o descarte pede motivo. Um bloco que acumula descartes com o mesmo motivo está
pedindo um limiar diferente.

## No celular

É onde a tela mais importa: é a primeira coisa aberta no café, antes do computador.

**Os mesmos widgets da web**, escolhidos pelo mesmo campo `visual` do catálogo — um bloco
novo nasce com o widget certo nas duas plataformas por dizer qual é. O filtro de grupo saiu
aqui também, e num telefone ele era pior ainda: o que o filtro escondia sumia da tela
inteira, sem nada dizendo que continuava existindo.

Três coisas mudam no desenho, e todas pelo mesmo motivo — **não existe hover num telefone**:

1. Onde a web mostra tooltip, aqui há **legenda em texto**. Ela não é enfeite: três dos seis
   slots categóricos ficam abaixo de 3:1 contra o branco, e a regra de alívio do método
   exige rótulo visível. No celular a legenda *é* o alívio.
2. O toque leva direto para a tela de trabalho, em vez de abrir um detalhe.
3. As bolhas pequenas ganham alvo de toque maior que a marca, pela legenda dos três maiores
   abaixo do gráfico — um gráfico de bolhas mudo, sem hover, seria bonito e inútil.

E duas coisas encolhem de propósito: o widget de **rolagem** vira os seis primeiros com "e
mais N", porque rolagem dentro de rolagem é briga de gesto; e o **treemap** perde quase todos
os rótulos, porque numa carteira de R$ 18 milhões o cliente de R$ 150 mil ganha um retângulo
pequeno de verdade. A área honesta vale mais que o rótulo em todos — quem precisa da lista
nominal tem a legenda de status e o toque em cada retângulo.

> **A paleta foi revalidada contra as superfícies do celular** (`#ffffff` / `#18181b`), que
> não são as da web. Os slots categóricos passam nas duas: pior par adjacente em ΔE 9,1
> (claro) e 8,4 (escuro) sob simulação de daltonismo. As quatro cores de status são
> reservadas do sistema e ficam abaixo do piso de separação para visão normal no par
> `low_operation` × `requires_attention` (ΔE 13,6); a mitigação documentada é ícone + rótulo,
> e por isso todo status nesta tela aparece **nomeado em texto**, nunca só pela cor.

A **ordem muda** em relação à web — a timeline abre a tela, e não os indicadores, porque quem
pega o telefone de manhã pergunta "o que eu tenho hoje", não "quanto vale o meu dia". Os
indicadores vêm logo abaixo, em carrossel horizontal, e o mapa da carteira do closer abre os
widgets.

O que na web é menu de três pontos, aqui é **swipe**: arrastar para a direita adia, para a
esquerda descarta, e o toque abre a tela onde o trabalho acontece. Adiar abre uma folha
com quatro opções (amanhã, depois de amanhã, semana que vem, 15 dias) em vez de um
calendário — escolher data exata com uma mão, no metrô, é o atrito que faz a pessoa
simplesmente não adiar, e item que não pode ser adiado acaba ignorado.

Uma coisa fica só na web: a **lista completa** quando um bloco estoura o teto. O painel do mês
saiu da home e virou `/comercial/painel`, um toque abaixo: ele responde "como está o meu
mês", que é consulta.

**As três ações passam por RPC** (`app_meu_dia_ocultar`, `app_meu_dia_reexibir`,
`app_meu_dia_concluir_tarefa`) e não por escrita direta na tabela. A web tem server
actions, o celular não tem — se cada um escrevesse a sua versão, uma emitiria o evento de
calibragem e a outra esqueceria. O alvo nunca vem da chamada: é `app_meu_dia_alvos()` quem
diz de quem é o dia que a pessoa mexe.

## O que as ações NÃO fazem

Nenhuma delas escreve no funil. Adiar uma NF não move a nota; descartar um lead não o
encerra. A tela é uma **leitura priorizada** do que já existe — se ela também escrevesse
no funil, "não é relevante" viraria uma forma silenciosa de perder negócio. Quem escreve
o funil é o card do funil, que o botão primário abre em outra aba.
