# Módulo Antecipação (Prompt 04)

O **funil de notas fiscais**. Duas unidades, deliberadamente separadas:

- **A NF é a unidade do funil** — dinâmica (novas a cada sync), perecível (expira com o
  vencimento), classificada em faixas por regra versionada.
- **O fornecedor é a unidade de abordagem** — tipagem comercial, cooldown de toques,
  agrupamento de mensagens. Ninguém recebe um toque por nota; recebe um toque pelo
  conjunto de notas vivas.

## `faixa` não é `estagio_funil`. Comece por aqui.

É a mesma distinção de `camada` vs. `estagio` no Mercado, e pelo mesmo motivo:
misturar as duas transforma um sinal automático numa opinião editável.

|  | `faixa` | `estagio_funil` |
| --- | --- | --- |
| O que é | Classificação **computada** por regra versionada | Posição no funil |
| Valores | `alta` \| `boa` \| `media` \| `null` | `a_prospectar` → `em_prospeccao` → `em_negociacao` → `antecipacao_andamento` → `convertida` \| `perdida` \| `expirada` |
| Quem muda | O job de reclassificação | **Ação humana** (RPC `app_mover_estagio_nf`) |
| Onde se muda o critério | Regras de faixa (`/antecipacao/faixas`) | Não se muda: é o registro do que aconteceu |

Ninguém "move" uma nota de faixa. Muda-se a regra, ou muda-se o dado. Quando a faixa
sai, `faixa_motivo` diz por quê: `regra`, `expirada`, `suprimido` ou `fora_das_faixas`.

## Precedência da classificação

O job aplica, nesta ordem, **antes** de qualquer regra:

1. `fornecedor_suprimido` → fora das faixas (`suprimido`)
2. `dias_para_vencimento < minimo_operavel` (default 7) → fora das faixas (`expirada`)
3. `alta` → `boa` → `media`, a primeira que casar
4. nenhuma → fora das faixas (`fora_das_faixas`)

As duas guardas ficam **fora** das regras de propósito. Repeti-las nas três regras e
esquecer numa delas seria mandar mensagem para quem pediu para não ser abordado.

## Política de expiração

**Sem o job diário o funil apodrece em duas semanas.** As notas não mudam — o
calendário muda. Uma nota que estava em faixa alta com 40 dias de prazo vira, sozinha,
uma nota impossível de operar, e continuaria no topo do Kanban ordenada por uma receita
esperada que também está errada (a receita depende do prazo).

O job diário (`/api/cron/antecipacao-diario`, 05:00 UTC) faz, nesta ordem — que é uma
cadeia de dependências, não uma preferência:

1. **Supressões expiradas** — um fornecedor cuja supressão caiu hoje precisa voltar a
   ser elegível *antes* de a faixa ser recalculada.
2. **Lookup cadastral** — o dado que chega agora é o que as variáveis de faixa vão ler.
3. **Reclassificar** — recalcula `dias_para_vencimento`, `receita_esperada`, faixa e
   expiração; move para `expirada` o estágio de quem estava em prospecção ativa.
4. **Outbox** — só faz sentido sobre faixas já corretas.

Sair da faixa **não** é sair do funil: uma nota que só deixou de casar a regra continua
`a_prospectar` (a regra pode voltar a casar amanhã). Quem sai do funil é quem expirou.

## O modo sombra, e o que falta para ligar os envios

Ligar um canal em `/antecipacao/disparos` **não liga envio**. Liga a *geração* da fila:
o job produz a mensagem exata que sairia, com o destinatário que seria escolhido, e a
deixa em `mensagens_outbox` com `status = 'pendente_envio'`. **Nada sai neste prompt.**

É de propósito que a validação venha antes do canal: ligar canais primeiro e conferir
depois é como se queima uma base de contatos.

Três portas antes de gerar, cada uma por um motivo diferente:

| Porta | Por quê |
| --- | --- |
| `estaSuprimido()` | É um pedido explícito de não ser abordado (ou LGPD) |
| Cooldown | Protege a relação — e conta **toque manual** do vendedor, para a régua não atropelar quem acabou de ligar |
| Contato | Sem canal válido não há mensagem. O descarte com motivo `sem_contato` é insumo direto para um lote de contatos no Radar |

**Para ligar os envios (Prompt 05) falta:** o transporte de e-mail (Resend já está nas
deps do web), o cliente do provedor de WhatsApp lendo o token do Vault, o passo de
`aprovada` → `enviada` com retry e registro de falha, warmup por número, e o tratamento
de **resposta** (que é o que transforma a outbox num inbox). A tabela, o agrupamento, a
escolha de destinatário, o cooldown e o round-robin entre contas **já existem** — o que
falta é o transporte, não a régua.

## Supressão: soft vs. eterna

`supressao` é **uma** lista (a do Radar), agora com validade:

- **Soft** (`expira_em = hoje + 90 dias`, configurável): "sem interesse agora". O job
  diário remove a linha e o fornecedor volta a ser elegível.
- **Eterna** (`expira_em = null`): LGPD, ou a multinacional que nunca vai antecipar.
  Nunca expira, e o job de limpeza **não a toca**.

`estaSuprimido()` e a view `notas_funil` aplicam o **mesmo** predicado de validade. Se
discordassem, um fornecedor sumiria do Kanban e continuaria recebendo mensagem — ou o
contrário.

## Ponto focal

`contatos.ponto_focal`, no máximo um por empresa (índice parcial único). Existe porque
"melhor contato disponível" é heurística, e heurística escolhe o estagiário do
financeiro quando ele é o único com e-mail preenchido.

**Toda** escolha de destinatário segue a mesma hierarquia — ponto focal → melhor
contato com canal válido e não suprimido. Vale para a outbox **e** para os botões de
contato de um toque no mobile. Se o app escolhesse diferente da automação, o vendedor
ligaria para uma pessoa e a mensagem automática iria para outra.

Marcar um desmarca o anterior **na mesma transação** (`app_definir_ponto_focal`): duas
chamadas do cliente deixariam uma janela em que a segunda falha e a empresa fica sem
ponto focal nenhum.

## Enriquecimento cadastral de fornecedores (§3.1)

Fornecedores chegam pela NF só com nome e CNPJ, e a maioria tem CNAE **fora** do recorte
de construção — portanto não existe em `mercado_universo`. Sem dado cadastral, as
variáveis de faixa e a Company 360 ficam cegas justamente para o lado do funil que mais
cresce.

`cnpj_lookup_fila` + cascata de APIs públicas **gratuitas**:

1. `minhareceita.org` — espelho do dump oficial, o mais completo e rápido
2. `brasilapi.com.br` — mesma origem, outra hospedagem (cobre a queda da primeira)
3. `receitaws.com.br` — **último recurso**, 3 req/min no plano free, throttle rígido

O resultado normalizado entra em **`mercado_universo`** com `origem_ingestao = 'lookup'`
e `fora_recorte_cnae = true` quando o CNAE não é 41/42/43. A partir daí todo o resto do
sistema — filter engine, reconciliação com `empresas`, Company 360 — funciona sem uma
linha de código nova. E a regra do TAM exige `fora_recorte_cnae = false`, então eles
existem no staging **sem** poluir a pirâmide comercial.

Só marca `nao_encontrado` quando alguma fonte respondeu dizendo que não conhece, ou
quando as tentativas acabaram (default 10). Um dia de rede ruim não condena um CNPJ a
nunca mais ser consultado.

## Onde está o quê

- **Banco**: migrations `0045`–`0053`.
  - `notas_fiscais` (chave natural `access_key`) + `nota_itens` + `credito_snapshots`
  - `faixa_regras` (versionadas, uma ativa por faixa) + `faixa_disparos`
  - `whatsapp_contas` (token no **Vault**) + `mensagens_outbox`
  - `cnpj_lookup_fila` + `antecipacao_config`
  - views: `notas_funil` (a superfície única), `antecipacao_fornecedores`,
    `antecipacao_sacados`, `antecipacao_sacados_a_prospectar`
  - RPCs: `app_mover_estagio_nf`, `app_marcar_sem_interesse`, `app_salvar_faixa_regra`,
    `app_ativar_faixa_regra`, `app_salvar_faixa_disparo`, `app_salvar_whatsapp_conta`,
    `app_descartar_mensagem`, `app_definir_ponto_focal`, `app_registrar_toque_manual`,
    `app_salvar_antecipacao_config`, `antecipacao_metricas_faixa`,
    `antecipacao_resumo_funil`
- **Core** (`packages/core/src/antecipacao/`): schemas e vocabulário, `faixas.ts` (o
  **segundo** engine de filtros — catálogo próprio sobre `notas_funil`), `nfe-xml.ts` (o
  parser, semente do Pricing), `economia.ts` (receita esperada, tipagem, urgência,
  templates), mutations. Registry: `antecipacaoModule` — **não** é webOnly.
- **Worker** (`apps/worker/src/jobs/antecipacao/`): `sync-nfs`, `reclassificar`,
  `outbox`, `lookup-cadastral`, `supressoes`; config em `apps/worker/src/antecipacao/`.
- **Web** (`apps/web/src/app/(app)/antecipacao/` + `components/antecipacao/`): Kanban,
  por sacado, sacados a prospectar, métricas por faixa, regras de faixa, disparos,
  Outbox, contas WhatsApp, settings.
- **Mobile** (`apps/mobile/app/(tabs)/antecipacao/` + `src/features/antecipacao/`):
  funil (tela principal), detalhe do fornecedor, por sacado, a prospectar.

## O engine de filtros agora tem duas instâncias

`criarFiltroEngine(catalogo)` em `packages/core/src/mercado/filters.ts`. Os
compiladores (PostgREST, SQL, JSON resolvido) são compartilhados; o **catálogo** não:

| Engine | Catálogo | View |
| --- | --- | --- |
| `mercadoEngine` | `CATALOGO` | `mercado_explorador` |
| `faixaEngine` | `CATALOGO_FAIXAS` | `notas_funil` |

Um catálogo único deixaria uma regra de faixa referenciar `capital_social` e compilar
para uma coluna que a view do funil não tem — erro que só aparece quando a
reclassificação noturna falha sobre 40 mil notas. O isolamento nos dois sentidos é
testado (`src/antecipacao/faixas.test.ts`).

O construtor visual (`apps/web/src/components/filtros/`) é genérico sobre o engine; a
pirâmide passou a usar a versão compartilhada com o engine do Mercado amarrado.

## O sync (§3)

- **Agenda**: 06:30, 10:30, 14:30, 18:30, 22:30, 02:30 America/São_Paulo →
  `30 9,13,17,21,1,5 * * *` em UTC (`apps/web/vercel.json`).
- **A janela é o que o endpoint permite**, e ele oferece dois filtros
  **mutuamente exclusivos** (mandar os dois → 400):

  | Filtro | O que traz | Limite |
  | --- | --- | --- |
  | `sync_hours=N` | notas **sincronizadas** nas últimas N horas | N ∈ [1, 4] |
  | `start_date`/`end_date` | notas **emitidas** no intervalo | máximo 10 dias |

  O incremental é o `sync_hours` — é literalmente a pergunta do job. Mas o teto é 4h e o
  cron roda de 4 em 4: a cobertura é contígua e **sem folga**. Daí três modos
  (`packages/core/src/antecipacao/sync-plano.ts`, testado):

  - **incremental** — gap ≤ 4h → `sync_hours = ceil(gap)`. O arredondamento para cima é
    o único colchão que o teto permite (~1h).
  - **recuperação** — gap > 4h (corrida falhou ou atrasou) ou primeira execução → janela
    por **emissão**, fatiada em blocos de ≤10 dias.
  - **varredura** — o job diário revarre os últimos 30 dias de emissão. É o que fecha,
    em até 24h, o buraco que o teto de 4h deixa quando uma corrida falha.

  Tudo isso é barato porque o processamento é **idempotente por `access_key`**: nota
  nova insere, repetida atualiza — e cancelamento e mudança de `creditAnalysis` chegam
  como UPDATE da mesma linha, que é exatamente o que se quer. Sobrepor não custa nada.

  **A recuperação é uma aproximação**, e vale saber: ela filtra por emissão, não por
  sincronização. Uma nota antiga sincronizada durante o buraco não cai nela — cai na
  varredura diária, desde que tenha sido emitida nos últimos 30 dias. Fora disso, só
  aumentando `varredura_dias`.
- **O XML é guardado sempre** (`raw_xml`). É a semente do Pricing. Falha de parse
  **loga e segue**: valor e vencimento também vêm do endpoint, o erro fica em
  `xml_parse_erro` e o XML fica para reprocessar.
- **Vencimento**: `cobr/dup/dVenc` (primeira parcela em aberto) → endpoint → emissão +
  30 dias. `vencimento_origem` é **sempre** gravada: uma data estimada não pode se
  passar por uma data real de duplicata.
- **Snapshot de crédito só quando algo mudou.** O valor está na derivada (o limite caiu,
  o status virou), não em 40 mil linhas idênticas por dia.
- **Receita esperada** = `valor × (taxa_mensal / 100) × (dias / 30)`, com a
  `monthlyRateD0` do snapshot mais recente do **sacado** (é o risco dele que
  precifica), caindo no default de `antecipacao_config`. A taxa usada é gravada em
  `taxa_usada`, senão a receita de ontem é impossível de auditar depois que a taxa muda.
- Registra execução em `mercado_ingestoes` com fonte **`onepay_nf`** — mesma política de
  retry/alerta dos outros syncs, mesma tela de Ingestões, mesmo botão de reexecutar.

## Notificações

| Evento | Quem | Como |
| --- | --- | --- |
| `sacado.limite_insuficiente` | Admin + Crédito | fan-out (sino) |
| `nf.convertida` | Comercial | fan-out (sino) |
| `sacado.credito_alterado` | Crédito | fan-out (sino) |
| nova NF em faixa **alta** | Comercial + Admin | **`notify()` no worker** — sino **e** push, com deep link |

O último não pode ser uma regra de `notificacao_regras` por duas razões: o gatilho de
fan-out casa apenas o **tipo** (uma regra em `nf.faixa_alterada` dispararia também ao
sair da faixa e ao entrar em média — ruído suficiente, num sync 6× ao dia, para o time
desligar as notificações), e o gatilho **não faz push**. Migration `0051` remove a regra
para que o sino não mostre a mesma notícia duas vezes. A notificação é **agrupada por
rodada**: uma por nota transformaria um sync de 40 notas em 40 buzinas no bolso.

## Mobile: o funil é experiência de primeira classe

- **Tela principal do módulo**, não um dashboard: quem abre no celular está na rua.
- Segmented control por estágio + chips de faixa e tipagem, lista ordenada por receita
  esperada, pull-to-refresh, busca.
- **Swipe** no card: direita move estágio, esquerda marca sem interesse. As duas abrem
  uma folha, porque as duas exigem escolha (qual estágio; 90 dias ou eterna) e motivo —
  um swipe que executa direto seria irreversível por acidente.
- **Ações de um toque**: `tel:`, `wa.me` (abre o app **do próprio vendedor**, sem relação
  com as contas de API cadastradas) com mensagem pré-preenchida do template da faixa, e
  `mailto:`. Cada uso registra `toque.manual` — e é esse evento que o cooldown da outbox
  lê. O registro **não bloqueia** a ação: discar é o que o usuário pediu.
- Editor de regras, Outbox, disparos, contas de WhatsApp e settings são `webOnly` e
  **não** estão declarados no stack mobile.

## Limitações conhecidas

- **O sync nunca rodou contra o endpoint real**, mas o contrato é conhecido: o recurso é
  `{ONEPAY_BI_URL}/api/v1/invoices` (confirmado) e os filtros estão travados por teste.
  O que resta desconhecido é o FORMATO do payload. Como é a mesma
  API e o mesmo token do sync de clientes, **nenhuma variável nova precisa ser
  provisionada**: sem `ONEPAY_NF_URL`/`ONEPAY_NF_TOKEN`, ele cai em `ONEPAY_BI_URL` +
  caminho padrão e em `ONEPAY_BI_TOKEN`. Se o recurso tiver outro nome, o conserto é
  definir `ONEPAY_NF_URL` com a URL completa — uma variável, sem deploy de código.
  O parser do payload é tolerante de propósito: aceita `data`/`items`, campos
  ausentes e a `accessKey` vindo do XML quando o JSON não a traz. Se o *formato* for
  diferente, o ponto de ajuste é a interface `NfPayload` em
  `jobs/antecipacao/sync-nfs.ts` — nada mais depende do formato bruto.
- **`notas_funil` é `security_invoker`.** Um usuário com `antecipacao` mas sem `radar`
  ou `mercado` vê `fornecedor_tem_protesto` e `fornecedor_uf` como null — as tabelas de
  base são de outros módulos. A **classificação** não é afetada: o worker usa service
  role. É o mesmo comportamento (e a mesma decisão) de `mercado_explorador`.
- **O Kanban não tem drag-and-drop.** Mover para "perdida" exige motivo, e um gesto de
  arrastar que abre um diálogo obrigatório é pior que um menu. O menu do card faz o mesmo
  em dois cliques, com o motivo onde ele precisa estar.
- **`nota_itens` não é lido por ninguém ainda.** É a base do Pricing, extraída agora
  porque o XML está passando agora.
