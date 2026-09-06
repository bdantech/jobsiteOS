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

## Fora de escopo

Relatórios customizáveis, exportação para Excel, report por vendedor individual e comparação
com metas.
