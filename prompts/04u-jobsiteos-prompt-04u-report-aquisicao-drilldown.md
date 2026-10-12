# JOBSITEOS — Claude Code Prompt 04u: Aquisição e drill-down no report semanal

> Estende o **Prompt 04q (report semanal executivo)**. Reuse: blocos e layout já existentes do report, `leads` e distribuição (04i), reuniões e `reunioes` (05C), funil de NFs (04/04s), carteira (04k), certificados (04b), comissões (04k), Meu Dia (04p) para o padrão de modal.
> **Nada que já existe no report muda de cálculo ou de posição** — entra um bloco novo, entram drill-downs, e dois rótulos são corrigidos (§1).
> UI pt-BR, código em inglês. Migrations via Supabase MCP.

---

## 1. Correção de rótulo — fazer antes do resto

No card **Funil comercial da semana** convivem hoje dois números que medem coisas diferentes e não dizem isso:

| No card | O que realmente é |
| --- | --- |
| Funil: `Realizados 3` | **coorte** — dos leads distribuídos *nesta semana*, 3 já tiveram reunião realizada |
| Linha: `Reuniões realizadas 32` | **janela** — 32 reuniões aconteceram nesta semana, de leads de qualquer época |
| Funil: `Com fit 4 (8,5%)` | coorte sobre contatados da semana |
| Linha: `Taxa de fit 21,7%` | janela, sobre tudo que foi avaliado na semana |

Os dois são legítimos e os dois são necessários — mas 3 ao lado de 32 sem explicação faz qualquer gestor concluir que o report está quebrado. Corrigir assim:

- O funil ganha subtítulo permanente: **"Coorte — dos leads distribuídos nesta semana, até onde chegaram"** (já existe uma versão disso; deixar explícito e sempre visível, não só no hover).
- A linha de estatísticas ganha cabeçalho **"Na semana, independentemente de quando o lead entrou"**.
- Cada número de coorte ganha ícone de informação com a frase da regra. Esse rótulo não é enfeite: é o que permite que o bloco novo (§2) conviva com o funil sem contradição aparente.

A mesma distinção vale para tudo que entra deste prompt em diante. **Todo número do report declara se é coorte ou janela.**

---

## 2. Bloco novo — Aquisição

Novo card no report, acima do funil comercial: **Aquisição da semana**.

### 2.1 A matriz

Grade de origem × qualificação, em contagem absoluta e percentual da linha:

|  | Com fit | Sem fit | Ainda não avaliado | Total |
| --- | --- | --- | --- | --- |
| **Inbound** | n | n | n | n |
| **Outbound** | n | n | n | n |
| **Total** | n | n | n | n |

**"Ainda não avaliado" é coluna obrigatória, não detalhe.** Lead que entrou na quinta e ninguém trabalhou ainda não é "sem fit". Se ele cair silenciosamente no balde de "sem fit", a semana corrente sempre parecerá ter qualidade pior que as fechadas — e alguém vai tomar decisão de canal em cima disso. Na semana corrente essa coluna é sempre grande; é o esperado, e o card diz isso em uma linha.

Se `origem` vier nula em algum lead, mostrar linha **Sem origem** em vez de distribuir por chute, e sinalizar como problema de cadastro.

### 2.2 Reuniões

No mesmo card, duas contagens com o rótulo da §1:

- **Agendadas na semana** — reuniões *marcadas* durante a semana, independentemente de quando acontecem.
- **Realizadas na semana** — reuniões que *aconteceram* durante a semana, independentemente de quando foram marcadas.

Mais, em linha secundária: canceladas, remarcadas e no-shows da semana.

São conjuntos diferentes e os dois importam: agendadas mede o esforço de prospecção da semana, realizadas mede o que o time de fato executou. **Nunca apresentar um como se fosse o outro**, e nunca derivar taxa dividindo um pelo outro sem deixar claro que são populações distintas (quem agendou na sexta realiza na semana seguinte).

Quebrar as duas por origem (inbound/outbound) também, já que é a mesma pergunta do §2.1 um passo adiante.

**Checagem de integridade (05C)**: reunião marcada como realizada sem transcrição do Fireflies e sem `bot_entrou_em` entra numa contagem discreta "realizadas sem captura — n". Não é acusação; é higiene de dado, e vale ver crescer.

### 2.3 Sempre atual na semana mais recente

O report tem duas vidas e elas precisam concordar:

- **Visão web**: o bloco de Aquisição recalcula a cada abertura. Mostra **"atualizado agora"** com o horário.
- **PDF / e-mail**: carrega o snapshot do momento do envio, com **"dados de dd/mm às HH:MM"** impresso no bloco.

Sem esse carimbo, alguém abre o e-mail de segunda na quarta-feira, compara com a tela e conclui que um dos dois está errado. Com ele, a diferença se explica sozinha.

### 2.4 Drill-downs do bloco

Toda célula da matriz e toda contagem de reunião é clicável, abrindo **modal** (nunca troca de página — padrão do 04p) com a lista nominal: empresa, contato, origem, responsável, data de entrada, estágio atual e, nas reuniões, data/hora e quem conduziu. Ordenação default por data desc, com exportar CSV.

---

## 3. Histórico — "mais detalhes"

Botão **Mais detalhes** no card de Aquisição abre modal com duas visões, em abas:

**(a) Semanas fechadas do mês corrente** — uma linha por semana já encerrada, com a mesma matriz (inbound/outbound × com fit/sem fit/não avaliado) e as duas contagens de reunião. A semana corrente aparece no topo, marcada **"em aberto"**, visualmente distinta, e **nunca entra em média ou total** — semana parcial comparada com semanas inteiras é a forma mais comum de enganar um gestor com dado correto.

**(b) Últimos três meses** — série semanal completa, com gráfico de linha por série (inbound com fit · inbound sem fit · outbound com fit · outbound sem fit) mais a tabela equivalente embaixo. Agregado mensal ao lado. Mesma regra: semana em aberto fora dos agregados.

Em ambas, cada célula e cada ponto do gráfico abre a lista nominal daquele recorte.

**Definição de semana**: reusar exatamente a que o 04q já usa (não redefinir). Semana fechada = aquela cujo último dia já passou. Deixar a definição escrita no README, porque relatório com duas definições de semana é relatório que ninguém confia.

---

## 4. Drill-down em tudo que já existe

Padrão único para o report inteiro: **clicou num gráfico, numa barra, num indicador ou num número — abre modal com os registros que formam aquele número.** Nunca troca de página. Cabeçalho do modal repete a regra do número (coorte ou janela, qual período) para que a lista possa ser conferida contra o total.

| Elemento hoje no report | O modal lista |
| --- | --- |
| **Volume convertido** | operações convertidas na janela: empresa, sacado, NF, valor, data, responsável |
| **VOP operado** | operações com valor cedido, dias de antecipação e VOP calculado |
| **Receita gerada** | operações com a receita decomposta (juros, TAC, demais) |
| **Limite ocioso** | sacados com limite aprovado, saldo utilizado e ocioso, data da aprovação |
| **Funil comercial — cada etapa** | os leads daquela etapa da coorte, com data de distribuição e responsável |
| **Taxa de fit** | leads avaliados na janela, com o veredito e quem avaliou |
| **Reuniões realizadas** | as reuniões da janela, com condutor, empresa e link da transcrição (05C) |
| **No-shows não remarcados** | as reuniões em no-show sem reagendamento |
| **MOUs** | os MOUs da janela |
| **Ciclo 1º contato → 1ª operação** | os casos que completaram o ciclo, com os dois marcos e a duração |
| **Funil de NFs — cada barra (faixa × série)** | as NFs daquela faixa e período, com sacado, fornecedor, valor, vencimento e estágio |
| **Capturadas** | as NFs capturadas na janela |
| **Expirou sem trabalho** | as NFs que venceram sem ação, ordenadas por valor desc |
| **Carteira — cada barra por gestor** | os clientes daquele gestor, com data da última operação e valor acumulado |
| **Contas paradas** | já tem link; padronizar no mesmo modal |
| **Certificados — válidos / sem certificado** | as contas de cada balde, com matriz/SPE, validade e NF estimada escondida |
| **As 15 maiores sem certificado** | a lista nominal com o valor estimado de cada uma |
| **Time — cada barra** | as conversões daquela pessoa, com VOP atribuído e comissão por operação |
| **Exige atenção — cada linha** | já tem link; padronizar no mesmo modal |

### 4.1 Regras do drill-down

- **Paginação e teto**: 50 linhas por página, teto de `max_linhas_drilldown` (config, default 5.000). Acima disso, mostrar o teto e oferecer exportar CSV do conjunto completo em background.
- **Exportar CSV** em todo modal.
- **RLS**: a lista respeita a permissão de quem abriu. Gestor vê tudo; vendedor vê a própria carteira. Um número agregado que o usuário pode ver mas cuja lista ele não pode abrir **não vira clicável** — melhor sem link que com link que devolve lista vazia.
- **O total do modal tem que bater com o número clicado.** Divergência é bug, não arredondamento. Escrever teste comparando o agregado de cada bloco contra o `count` da query de detalhe.
- **PDF não clica**: no PDF, cada número que tem drill-down ganha o link "ver no sistema" apontando para o report web com o modal já aberto (deep link por querystring).

---

## 5. Dados

Checar antes de criar coluna — boa parte já existe:

```sql
-- leads: confirmar que existem e estão sempre preenchidos
--   origem        text    -- inbound | outbound  (o report já mostra "45 in · 53 out")
--   fit           text    -- com_fit | sem_fit | null (= ainda não avaliado)
--   fit_avaliado_em timestamptz
--   fit_avaliado_por uuid
```

Se `fit` hoje for booleano, **migrar para três estados** — booleano não distingue "sem fit" de "ainda não avaliado", que é a coluna que o §2.1 exige. Migração: `false` existente vira `sem_fit` apenas onde `fit_avaliado_em` estiver preenchido; o resto vira nulo.

```sql
-- reunioes (05C): confirmar os dois carimbos distintos
--   agendada_em    timestamptz  -- quando foi MARCADA
--   inicio         timestamptz  -- quando ACONTECE / aconteceu
--   status         text         -- agendada | realizada | cancelada | no_show | remarcada
--   remarcada_de   uuid
```

Sem `agendada_em` separado de `inicio` não há como responder "quantas foram agendadas na semana" — se faltar, criar e fazer backfill com `created_at`.

**Agregação**: materializar o bloco de Aquisição por semana em `report_aquisicao_semanal` (origem × fit × semana, mais as contagens de reunião), atualizada por job ao fechar cada semana e recalculada sob demanda para a semana corrente. Três meses de série semanal recalculada a cada abertura do modal é consulta cara e desnecessária.

---

## 6. Settings, entregáveis e testes

**Settings** (Comercial → Report semanal): `max_linhas_drilldown` · incluir ou não o bloco de Aquisição no PDF · destinatários e dias de envio (já existem no 04q, não mexer).

**Core**, com testes:
- `aquisicao.ts` — a matriz por janela. **Testes**: lead sem origem; lead sem avaliação de fit; lead avaliado depois da semana em que entrou (conta na semana de entrada, não na de avaliação — e isso vai no README); semana sem nenhum lead.
- `reunioes-janela.ts` — agendadas vs realizadas. **Testes**: marcada na semana 1 e realizada na semana 2 (conta em cada uma na sua métrica); remarcada (não pode contar duas vezes como agendada); cancelada antes de acontecer; no-show.
- `semanas.ts` — fechada vs em aberto, reusando a definição do 04q. **Teste**: a semana em aberto nunca entra em média nem em total.
- Teste de consistência: para cada bloco do report, o agregado exibido bate com o `count` da query de drill-down.

**Entregáveis**: card de Aquisição no report web e no PDF · modal "Mais detalhes" com as duas abas · drill-down em todos os elementos da tabela do §4 · rótulos de coorte/janela do §1 · tabela materializada e job · deep link para o PDF · README com as definições de semana, de coorte × janela, e da regra de "ainda não avaliado".

---

## 7. Fora de escopo

Mudar qualquer cálculo já existente do report (só rótulo) · drill-down em tela que não seja o report · novas métricas de aquisição além das pedidas (CAC, origem por campanha) · exportar o report inteiro em Excel · comparação entre vendedores dentro do bloco de Aquisição.
