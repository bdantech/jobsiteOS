# Report Semanal Executivo (04q)

**Comercial → Relatórios**, e um PDF de três páginas por e-mail nos dias configurados.

Restrito a **gestor**, que aqui significa: tem o módulo Comercial e **não é vendedor**
(`app_report_gestor()`). `app_gestor_comercial()` não serve — ela é "perfil Admin ou
Comercial", e a auxiliar do closer tem perfil Comercial. O report mostra a carteira inteira,
o desempenho nominal de cada pessoa e a comissão de cada uma.

## Uma estrutura, três superfícies

A aba, o PDF e o corpo do e-mail consomem **exatamente** o mesmo objeto, e nenhum recalcula
nada. Um número que aparece na tela e outro no anexo, ambos "corretos" por réguas
diferentes, é o jeito mais rápido de o report deixar de ser levado a sério — e quem
descobre a divergência é sempre a pessoa para quem ele foi feito.

| Peça | Onde |
|---|---|
| Tipos + lógica derivada | `packages/core/src/reports/semanal.ts` (20 testes) |
| Aquisição e drill-down (04u) | ver a seção própria, no fim |
| Agregadores | `app__rp_operacao` / `_comercial` / `_carteira` no banco |
| Porta autorizada | `app_report_semanal(inicio, fim)` |
| Mecânica sem sessão (worker) | `app__rp_montar(inicio, fim)` |
| Série de 12 meses | `report_series` + `app_report_materializar_series()` |
| PDF | `apps/worker/src/jobs/reports/pdf.ts` (pdfkit) |
| Resumo de IA | `apps/worker/src/jobs/reports/resumo-ia.ts` |
| Orquestração e envio | `apps/worker/src/jobs/reports/semanal.ts` |
| Aba | `apps/web/src/components/comercial/relatorios/` |
| Celular | `apps/mobile/app/(tabs)/comercial/relatorios.tsx` |

`app__rp_montar` existe separado de `app_report_semanal` pelo mesmo motivo de `app__md_montar`
no Meu Dia: a service role do worker não tem `auth.uid()` e reprovaria na própria checagem
de gestor.

## A régua de três janelas

Todo indicador traz **12 meses** (total + média), **mês corrente** (parcial) e **semana**,
com a variação contra a média.

> **A média é sobre os meses QUE TÊM DADO, não sobre doze de calendário.**
>
> A operação começou em 20/07/2026. Dividir o total por doze diluiria tudo por nove meses em
> que a empresa não existia, e *toda* semana apareceria como "+180% acima da média" — o
> indicador viraria um elogio automático, que é o oposto de uma régua. `meses_com_dado` viaja
> no indicador e as três superfícies escrevem "média de 3 meses" em vez de fingir que são
> doze.

**`subir_e_pior` viaja junto.** Metade dos indicadores é ruim quando cresce: valor expirado,
limite ocioso, ex-clientes, no-shows, antecipações travadas. Sem esse campo a tela pintaria
de verde uma alta de 40% em valor que expirou sem ninguém tocar. `direcaoDa()` traduz, e é a
mesma função nas três superfícies.

**Variação `null` nunca é zero.** "Não dá para comparar" e "não variou" são leituras opostas,
e a segunda mente quando a primeira é a verdade.

**O mês é parcial e a estrutura diz quanto** (`mes_dias_decorridos` de `mes_dias_total`).
Comparar seis dias de setembro com a média de um mês inteiro sem avisar faria toda primeira
semana parecer um desastre.

## Fluxo e estoque: de quando é cada número

O report tem duas naturezas de número, e confundi-las é o erro mais fácil de cometer aqui.

**FLUXO** é o que aconteceu dentro da janela — volume convertido, VOP, receita, operações,
cedentes, comissão de cada vendedor, leads distribuídos, decisões de crédito, notas
capturadas. Preso pela data do evento (`convertida_em`, `evento_em`, `distribuido_em`,
`decidida_em`, `criada_em`). **Não se move**: o mesmo período relido em janeiro dá o mesmo
número.

**ESTOQUE** é o que *existe* num instante — limite ocioso, carteira, filas, antecipações
travadas, cobertura de certificados. Não tem "o da semana passada"; tem "o de tal dia".

`periodo.retrato_em` é a data em que os estoques foram lidos, e as duas superfícies pedem
coisas diferentes de propósito:

| | Fluxos | Estoques |
|---|---|---|
| **PDF / e-mail** | da janela | do **fim da janela** (`ao_vivo: false`) |
| **Tela** | da janela | de **agora** (`ao_vivo: true`) |

O PDF circula por e-mail e é citado meses depois: um número que se reescreve sozinho dentro
de um arquivo já lido é pior que um número errado. A tela responde "como está a carteira
agora", e um saldo de uma semana atrás ali seria inútil.

**Os dois estão certos, e vão divergir.** No fim da semana 35 o limite ocioso era R$ 62,6 mi;
uma semana depois, R$ 59,7 mi. `textoDoRetrato()` escreve a frase que diz qual é qual, e ela
aparece no cabeçalho do PDF, da aba e da tela do celular. `app_report_semanal(…, p_ao_vivo =>
false)` reproduz na tela exatamente os números do anexo.

### De onde vem o passado

**`clientes_onepay_snapshots`** — captura diária desde 25/07/2026, com os mesmos campos da
tabela viva. `app__rp_carteira_em(data)` devolve a captura mais recente que não é posterior à
data pedida (`max`, e não `= data`: um dia de sync falho não pode zerar a carteira do report;
`periodo.retrato_carteira_em` diz de que dia ela saiu). **Hoje ele lê a tabela viva**, não a
captura — a captura é de madrugada e divergia dela em R$ 500 mil, e o Meu Dia lê
`clientes_onepay` direto.

**`funil_transicoes`** — o log dos gatilhos de mudança de estágio, e a fonte de "reuniões
realizadas" e "MOUs". Antes esses dois saíam de `atualizado_em`, que é carimbo de última
*edição*: um lead tocado depois **saía** da semana em que a reunião aconteceu, e um lead
velho reeditado **entrava** numa semana em que nada ocorreu. O log começa em 30/08/2026 —
semanas anteriores vêm zeradas, e zero declarado é melhor que um número que se reescreve.

### O que continua sendo de hoje

Porque não existe histórico: `antecipacoes.status` e `analises_credito.estagio` (a plataforma
e a esteira sobrescrevem), a composição dos grupos em `certificado_universo`, e
`empresas.faturamento_anual` (saída do modelo do 04c — recalibrar o estimador muda o
"invisível" para trás). Nesses casos o que a linha afirma é a **data** que a colocou ali; o
rótulo que a acompanha é o de agora.

**A janela padrão é a semana ISO fechada** — segunda a domingo, já terminada. Abrir na semana
corrente compararia três dias com sete. A aritmética está em dois lugares (`app_report_semanal`
no banco e `janela.ts` no worker) e **precisa concordar**: uma primeira versão do SQL devolvia
a semana corrente parcial enquanto o worker devolvia a fechada, e a aba mostrava uma semana e
o anexo, outra.

## Onde os números têm ressalva

Três indicadores não são o que parecem, e a estrutura carrega a ressalva junto do valor.

**Tempo médio na esteira** só conta análises que **nasceram aqui**. 84 das 87 vieram do
backfill da Atradius, com `decidida_em` anterior a `criada_em` — a média sobre a base inteira
dá **−152 dias**. `esteira_base` diz sobre quantas análises a média foi calculada, e o PDF
escreve "base de 1; as importadas não medem".

**VOP do time** sai de `comissao_lancamentos_v2`, que é a **atribuição** — não o total
operado. Conta sem vendedor opera e não gera lançamento, e somar o operado aqui daria a
alguém crédito por uma conta que não é dele. O VOP dos KPIs, esse sim, é o operado inteiro,
calculado de `antecipacoes` com o `dias_referencia_vop` de `commission_params` (o mesmo
denominador da folha).

**Conversão de NF é medida na coorte da janela**: das notas capturadas no período, quantas já
converteram. "Notas convertidas no período" misturaria nota velha convertida agora e faria a
taxa da semana depender do estoque, não do trabalho da semana.

## O que está invisível por falta de certificado

O número que faz alguém agir, e o que ele custou para ficar honesto.

A estimativa é `faturamento_estimado / 12 × razão`, com a **razão medida**: nos 16 CNPJs que
*têm* certificado, a mediana de (NF/mês vista como sacado) ÷ (faturamento/12) é **0,1011**
(p25 0,044 · p75 0,207). Ela é recalculada a cada execução — quando o vigésimo cliente
entregar o certificado, corrige-se sozinha. Sem base para calibrar (menos de 5 clientes), a
função **não estima**: número inventado em PDF executivo vira decisão.

Três correções, cada uma medida:

1. **`faturamento/12` dava R$ 2,36 bilhões por mês.** O certificado do cliente mostra as notas
   emitidas *contra* ele — o custo dele com fornecedores, não a receita dele. Grandezas de
   ordem diferente.
2. **Somar matriz + SPEs contava o mesmo grupo quarenta vezes.** São 1.030 CNPJs, e o
   estimador atribui a cada SPE o porte do grupo.
3. **A chave do grupo é `empresa_id`, não a raiz do CNPJ.** A COSAMPA tem quatro raízes na
   mesma conta e aparecia quatro vezes na lista.

E o total é o **dos N maiores**, com o campo chamado `total_mes_do_topo`: extrapolar 16
observações para 600 grupos dava R$ 1,37 bi/mês, cem vezes o que a operação inteira converte,
e um total impossível destrói a credibilidade da página inteira. Hoje: **30 contas cegas, as
15 maiores somando R$ 33,7 mi/mês**.

## O resumo de IA

Três parágrafos — o que foi bem, o que preocupa, onde agir — por tool call, não por markdown
que alguém depois separa por regex.

**A garantia de que ele não inventa é estrutural**, e não o pedido no prompt (que também é
feito): o modelo recebe só `briefingParaIa()`, sem ferramenta e sem acesso a tabela. Se um
número não está no briefing, ele não existe para o resumo. O briefing corta as listas em cinco
itens e não leva id interno nenhum.

**Falhar ali devolve `null`, e não exceção.** Um PDF com onze blocos e sem os três parágrafos
continua respondendo tudo; um domingo sem report porque a API estava fora seria trocar o
essencial pelo desejável.

O resumo é escrito **quando o report é gerado**, e a aba lê o texto da execução. Chamá-lo a
cada abertura custaria dinheiro e daria três parágrafos diferentes para os mesmos números.

## O PDF

Três páginas A4, geradas com **pdfkit** — sem browser.

O worker roda em `node:22-alpine`, e Puppeteer ali exige o Chromium do apk (+~200 MB na
imagem) e 300–500 MB de RAM por render, num contêiner que é o executor de *todos* os jobs e
sobe direto da main. O preço da escolha está assumido: o layout do wireframe foi
reimplementado em primitivas, e há duas fontes de verdade visual a manter — por isso a paleta
e as medidas são constantes nomeadas no topo do arquivo.

Quatro bugs que só apareceram ao **renderizar e olhar**:

- **Saíam 9 páginas em vez de 3.** O rodapé escreve abaixo da margem inferior e o pdfkit
  tratava isso como "não coube", abrindo página nova a cada um. Zerar `page.margins.bottom`
  durante o rodapé é a forma suportada de dizer "eu sei onde estou desenhando".
- **`→` virava `!'`.** As 14 fontes padrão do PDF são WinAnsi e não têm seta, "diferente de"
  nem o menos tipográfico. Glifo ausente vira lixo, sem erro. Acentos e `·` estão no WinAnsi e
  continuam valendo.
- **Colunas coladas.** Sem calha, o valor alinhado à direita termina onde começa o texto da
  coluna seguinte: "15" e "14 inbound" saíram como "1514 inbound". E texto longo descia uma
  segunda linha atravessando a linha de baixo — resolvido com `height` na célula.
- **`String(43.1)` põe ponto decimal** num documento que usa vírgula em todo o resto.

Nome: `report-semanal-oneos-{ano}-S{semana}.pdf`, no bucket **privado** `reports-semanais`.
Privado porque o arquivo traz a carteira inteira e a comissão nominal de cada vendedor, e o
caminho não é difícil de adivinhar; a aba serve por URL assinada de 5 minutos.

## Agendamento e envio

| Cron | Quando | O quê |
|---|---|---|
| `/api/cron/reports-series` | 04:30 UTC, diário | reescreve `report_series` |
| `/api/cron/reports-semanal` | 09:00 UTC, diário | lê `report_config` e decide se envia |

**O cron acorda todo dia de propósito.** Os dias de envio são configuráveis na aba e a Vercel
só entende cron fixo; um cron de segunda cravado no `vercel.json` faria a tela mentir quando
alguém marcasse quarta. O dia da semana é calculado **no fuso da configuração** — um envio de
domingo às 22h de São Paulo dispara às 01h UTC de segunda, e o servidor acharia que é outro dia.

**O horário na tela é informativo, e a tela diz isso.** Os dias são obedecidos; a hora está no
cron. Um campo que parece mandar e não manda produz a conclusão errada quando o e-mail chega
em outra hora.

**Um e-mail por destinatário**, não um `to` com a lista: o report nomeia vendedor por vendedor,
e um "responder a todos" com a caixa de todo mundo à vista é o tipo de vazamento que ninguém
planeja. Retry 3×, mas **4xx que não é 429 desiste na hora** — e-mail inválido continua
inválido, e insistir só atrasa a fila.

O corpo leva o **resumo em texto**, e não "segue o anexo": metade de quem recebe às 6h lê no
celular, andando, sem abrir PDF nenhum.

O envio não usa o `TransporteResend` do core: aquele é o transporte do **ledger de
comunicação**, grava em `comunicacoes` e não sabe de anexo. O report não é uma conversa com um
cliente, e registrá-lo como tal poluiria a thread de quem por acaso também é destinatário.

## Quando o envio falha

1. A execução fica com `status = 'falhou'` e o erro em `report_execucoes.erro` — o histórico
   na aba mostra os dois.
2. Um evento `report.falhou` é emitido.
3. **O PDF já está guardado**: falha de envio não é falha de geração. Dá para baixar pelo
   histórico e encaminhar à mão enquanto a causa é resolvida.

Sem `RESEND_API_KEY` ou `RESEND_REMETENTE` no worker, nada sai e o motivo fica escrito na
execução. Com a lista de destinatários vazia, o report é gerado e guardado — a tela avisa.

## Reprodutibilidade

`report_execucoes.dados` guarda a estrutura inteira (~30 kB). É o que faz um report de três
meses atrás abrir com os números **daquela época**, depois de a nota ter mudado de estágio e o
cliente ter saído da carteira. Recalcular ao abrir mostraria um passado que nunca existiu.

O histórico da aba **não** traz `dados` na listagem: cinquenta semanas ficariam com 1,5 MB
para mostrar cinco colunas. Quem abre um report antigo pede o snapshot daquele.

## Aquisição e drill-down (04u)

Um bloco novo — **Aquisição da semana**, acima do funil — e uma regra para o report
inteiro: **clicou num número, abre a lista dos registros que o formam.** Nenhum cálculo que
já existia mudou; `app__rp_operacao`, `_comercial` e `_carteira` não foram tocadas.

| Peça | Onde |
|---|---|
| Matriz, totais, carimbo, série | `packages/core/src/reports/aquisicao.ts` |
| Agendadas × realizadas | `packages/core/src/reports/reunioes-janela.ts` |
| Semana, fechada × em aberto | `packages/core/src/reports/semanas.ts` |
| Catálogo do drill-down, deep link, CSV | `packages/core/src/reports/drilldown.ts` |
| Registros e agregado da Aquisição | `app__rp_aq_leads` / `_aq_reunioes` / `_aq_linhas` / `_aquisicao` |
| Série materializada | `report_aquisicao_semanal` + `app_report_materializar_aquisicao()` |
| Portas autorizadas | `app_report_aquisicao` · `app_report_aquisicao_historico` · `app_report_detalhe` |
| Mecânica do drill-down | `app__rp_detalhe(chave, inicio, fim, retrato, params, limite, offset)` |
| Conferência agregado × lista | `app__rp_conferir(inicio, fim, retrato)` |
| Card e histórico | `apps/web/src/components/comercial/relatorios/bloco-aquisicao.tsx` |
| Modal único | `apps/web/src/components/comercial/relatorios/drilldown-modal.tsx` |

### A semana

**Segunda a domingo. Fechada é a que o último dia já passou** — num domingo, a semana ainda
está correndo. É a definição do 04q, e não há outra: `app_report_semanal` no banco,
`janela.ts` no worker e `semanas.ts` no core fazem a mesma conta, e o teste do worker compara
as duas implementações em TypeScript dia a dia por dois meses.

**Uma semana pertence ao mês em que FECHA.** A de 28/09 a 04/10 é de outubro, inteira. Sem
isso a soma dos meses deixa de bater com a soma das semanas.

**A semana em aberto nunca entra em média nem em total.** Ela aparece — no topo, tracejada,
com o selo "em aberto" —, mas toda soma do histórico passa por `agregarSemanas()`, que a
recusa. Semana parcial comparada com semanas inteiras é a forma mais comum de enganar um
gestor com dado correto: três dias de leads ao lado de sete parecem uma queda de 60%.

### Coorte × janela × estoque

Todo número do report declara o que é.

| | O que é | Exemplo |
|---|---|---|
| **Coorte** | um grupo fixado pela data de ENTRADA, acompanhado até hoje | o funil; a matriz de Aquisição; a conversão de NF |
| **Janela** | o que ACONTECEU no período, de gente de qualquer época | taxa de fit; reuniões; volume; MOUs |
| **Estoque** | o que EXISTE num instante — não tem "o da semana", tem "o de tal dia" | limite ocioso; no-shows não remarcados; certificados |

O funil mostra `Realizados 3` e a linha de baixo, `Reuniões realizadas 32`. Os dois estão
certos: o primeiro é coorte (dos leads distribuídos nesta semana, 3 já tiveram reunião), o
segundo é janela (32 na semana, de leads de qualquer época). Sem a palavra ao lado, qualquer
gestor conclui que o report está quebrado — por isso o subtítulo do funil é permanente, e
não um hover.

**E "Reuniões realizadas" conta mudanças de estágio, não reuniões.** O número vem de
`funil_transicoes` para `reuniao_realizada` OU `qualificada`: o lead que passa pelas duas na
mesma semana conta duas vezes. Na semana 41 foram 32 transições de 19 leads. O 04u não mexe
no cálculo — só passou a dizer isso na tela e no PDF, e a lista que o número abre é de
transições, para bater. A contagem por reunião é o "Realizadas na semana" da Aquisição.

### "Ainda não avaliado" não é "sem fit"

A matriz é origem × qualificação, e a terceira coluna é obrigatória. `fit` no banco é
booleano **com nulo**: `true`, `false` e `null` já são os três estados, e nulo é "ninguém
avaliou". O lead que entrou na quinta e ninguém trabalhou não foi reprovado por ninguém; se
caísse em "sem fit", a semana corrente pareceria sempre pior que as fechadas, e alguém
tomaria decisão de canal em cima disso.

**Agendar reunião não define o fit.** Fit é avaliação de uma pessoa; a matriz e as reuniões
são duas contagens independentes. Um lead com fit que também teve reunião marcada conta nos
dois indicadores — em "com fit", na semana em que entrou, e em "agendadas", na semana em que
a reunião foi marcada. Um lead com reunião e sem avaliação continua "ainda não avaliado".
(A 0298 chegou a marcar o fit ao agendar, por leitura errada do pedido; a 0299 a desfez.)

**O lead conta na semana em que ENTROU, com o fit que tem hoje.** Entrou na semana 40 e foi
avaliado na 42: aparece na 40, como "com fit". A pergunta é "do que entrou naquela semana, o
que se mostrou bom". Consequência: a linha de uma semana fechada **amadurece**, e é por isso
que a materialização reescreve as treze semanas, e não só a que acabou de fechar.

**Outbound é tudo que não é inbound** — `distribuicao` e `manual` em `sdr_leads.origem`, a
mesma leitura do "45 in · 53 out" que o report já fazia. A coluna é NOT NULL; a linha "Sem
origem" existe para a reunião sem lead e para o dia em que isso deixar de ser verdade, e só
aparece quando tem alguma coisa.

Dos não avaliados, o card diz quantos **expiraram sem contato**: voltaram ao pool e não
serão avaliados neste ciclo. Estão na coluna certa — ninguém os avaliou —, mas não são
"ainda".

### Agendadas e realizadas são conjuntos diferentes

| | Conta no dia em que | De onde |
|---|---|---|
| **Agendada** | foi MARCADA | `vendedor_eventos.criado_em` |
| **Realizada** | ACONTECEU | `vendedor_eventos.inicio_em`, com evidência |
| Cancelada | foi cancelada | `cancelado_em` |
| Remarcada | foi remarcada | evento `sdr.reuniao_agendada` com `remarcada = true` |
| No-show | o lead foi marcado | transição para `no_show` |

Quem marcou na sexta realiza na semana seguinte. Agendadas mede o esforço de prospecção;
realizadas, o que o time executou. **Nenhuma taxa sai dividindo uma pela outra**, e o módulo
não tem função que faça isso.

A reunião é UMA linha de `vendedor_eventos`, e remarcar **atualiza** essa linha (0201). É o
que faz uma remarcação não contar duas vezes como agendada — e é também um limite: a reunião
conta como realizada na data em que o evento está HOJE, porque não há histórico de
`inicio_em`.

**Realizada exige evidência**: a transcrição do Fireflies chegou, ou o último desfecho do
lead é reunião realizada / qualificada. Evento cuja hora passou sem nada registrado não é
contado como realizado — vai para **"sem desfecho"**, uma contagem discreta que é fila de
higiene. Contar por "a hora passou" inflaria o número justamente com as reuniões de que
ninguém sabe dizer se houve.

**"Realizadas sem captura"** é reunião realizada sem transcrição e sem `bot_entrou_em`. Só
conta a partir de 05/10/2026, quando a captura (05C) começou: antes disso toda reunião é
"sem captura", e o indicador nasceria em 100% para depois parecer que melhorou sozinho.

### As duas vidas do bloco

Na **tela** ele recalcula a cada abertura e diz "atualizado agora, às HH:MM". No **PDF e no
e-mail** ele é o snapshot do envio, com "dados de dd/mm às HH:MM" impresso. Sem o carimbo,
alguém abre o e-mail de segunda na quarta — quando mais leads já foram avaliados —, compara
com a tela e conclui que um dos dois está errado.

O card da tela oferece a **semana em aberto** ao lado da fechada, com o aviso de que "ainda
não avaliado" é grande ali por definição.

### O drill-down

Um modal só, para tudo. O cabeçalho repete a regra do número — coorte, janela ou estoque, e
de qual período — para que a lista possa ser conferida contra o total. Nunca troca de página.

- **50 linhas por página, até `max_linhas_drilldown`** (5.000 por padrão). Acima do teto a
  tela mostra o teto e o **CSV traz o conjunto completo**, buscado em lotes de mil enquanto a
  pessoa continua lendo. Separador `;` e vírgula decimal, com BOM: é o que o Excel em pt-BR
  abre sem assistente.
- **O total do modal tem de bater com o número clicado.** O número viaja para o modal, e se a
  lista devolver outro, o modal DIZ — em vez de mostrar a lista como se nada fosse. Valor em
  reais confere pela soma, centavo a centavo; contagem confere pelo total de linhas.
- **`app__rp_conferir()` é o teste.** Para cada número clicável ela compara o que o report
  exibe com o que `app__rp_detalhe` devolve: 78 checagens por semana. `bate = false` é bug.
  Mora no banco porque é onde os dois lados moram — um teste no core só compararia um mock
  com outro. Rode depois de mexer em qualquer agregador:

  ```sql
  select * from app__rp_conferir('2026-10-05', '2026-10-11', '2026-10-11') where not bate;
  ```

  Cada ramo de `app__rp_detalhe` repete o `where` do agregador correspondente. Quem altera
  um, altera o outro.
- **Permissão.** O report é só de gestor (`app_report_gestor()`), e o drill-down usa a mesma
  régua. Não existe número que alguém veja e cuja lista não possa abrir — por isso nenhum
  ficou sem clique. Vendedor não entra na página.
- **PDF não clica.** Cada número é um link (anotação sobre a área do número) para
  `/comercial/relatorios/semanal?execucao=…&detalhe=…&p.origem=…`, que abre o report web
  **naquele snapshot** com o modal já aberto. O rodapé diz que os links existem. Depende de
  `APP_BASE_URL` no worker; sem ela o PDF sai sem links.

Dois ajustes de apresentação que o drill-down obrigou, e nenhum de cálculo:

- **Certificados.** A legenda subtraía os "vencendo" dos válidos (que não os contêm) e os
  deixava dentro de "sem certificado". Agora são três baldes disjuntos que somam o universo,
  e cada um abre a sua lista. Os números do report são os mesmos.
- **Receita.** O prompt pedia a receita decomposta em juros, TAC e demais. A plataforma só
  envia o spread total (`totalSpreadAmount`); a lista mostra spread, taxa a.m., retenção e
  líquido, e o cabeçalho diz que a decomposição não existe na origem.

### A materialização

`report_aquisicao_semanal` guarda as treze semanas fechadas mais recentes, uma linha por
origem. O cron `/api/cron/reports-series` (04:30 UTC) a reescreve **direto no banco**, sem
passar pelo worker.

`app_report_aquisicao_historico()` confere, antes de ler, se algum lead, evento ou transição
mudou depois da última materialização, e reescreve se mudou. São quatro `max` contra
recalcular treze semanas a cada abertura — e é o que mantém a célula do histórico igual à
lista que ela abre, que é sempre ao vivo.

### Permissões das funções internas

As `app__rp_*` são mecânica: `security definer`, sem checagem de sessão, feitas para o
worker. A 0192 as deixou com o grant padrão do Supabase — **EXECUTE para `anon`** —, e
`rpc/app__rp_montar` devolvia o report inteiro, com a comissão de cada vendedor, a quem
tivesse a chave pública do projeto. A 0297c revogou de `public`, `anon` e `authenticated`
em todas, antigas e novas. Só o worker (service role) as chama; a tela usa as portas
`app_report_*`, que conferem o gestor.

### Configuração

Em **Configurar envio**: o teto de linhas do drill-down e se o bloco de Aquisição entra no
PDF. Destinatários e dias de envio não mudaram.

## Fora de escopo

Relatórios customizáveis, exportação para Excel, report por vendedor individual e comparação
com metas. Do 04u: CAC e origem por campanha, comparação entre vendedores dentro da
Aquisição, e drill-down em tela que não seja o report.
