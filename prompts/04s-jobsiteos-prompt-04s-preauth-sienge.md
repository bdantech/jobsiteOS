# JOBSITEOS — Claude Code Prompt 04s: Pré-autorizações e Títulos Sienge no Funil
## Duas novas fontes de oportunidade, unificadas **só na apresentação**

> Builds on Prompts 01–05B. Reuse pesado: funil de NFs e seus componentes de kanban/card (04), sync e matching de antecipações (04e), motor de faixas e filter engine (02/04), roteamento de originador (04g), outbox e agrupamento por fornecedor (04/05A), comissões (04k), esteira de crédito (04d), Company 360, event log. UI pt-BR, code English. Migrations via Supabase MCP.
> **Localização**: as novas fontes aparecem **dentro do funil de NFs já existente**, em **Antecipação → Funil de NFs** e no **painel do originador em Comercial** (as duas superfícies que já mostram esse funil hoje).

---

## 1. Princípio inegociável

**As listas não se misturam no banco — só na tela.**

Três tabelas independentes, cada uma espelhando fielmente sua fonte: `notas_fiscais` (já existe, **não muda**), `pre_autorizacoes` (nova) e `sienge_titulos` (nova). A união acontece **apenas na camada de leitura**, através de uma projeção read-only.

> **Por que a projeção precisa existir no banco (e por que isso não é "misturar")**: o funil pagina, ordena e filtra a lista inteira. Sem um `UNION ALL` no nível da query, seria preciso puxar tudo das três fontes e ordenar em memória a cada abertura — paginação quebra e a tela fica lenta. A projeção é **somente leitura, não armazena nada e não é escrita por ninguém**; o armazenamento continua separado.

**O funil atual não pode ser alterado.** Nenhuma coluna de `notas_fiscais` muda, nenhum comportamento existente muda, e o card e as ações são **exatamente os mesmos** para os três tipos. O que muda é que a lista passa a ter três origens.

## 2. Fontes

### 2.1 `GET /api/v1/pre-authorizations`
Ofertas de antecipação feitas pela construtora ao fornecedor. Campos relevantes: `id`, `status`, `origin`, `migrated`, `identification`, `createdAt`, `expiresAt`, `requestedAt`, `amount`, `invoiceNumber`, `dueDate`, `contractor` (name, taxId, **headquartersTaxId**), `contracted` (name, taxId, registered), `anticipationId`, `revokedReason`, `sienge` (billId, installmentId, installmentNumber, documentNumber).

- **`status = WAITING_CONTRACTED` é o sinal mais quente do sistema inteiro**: a construtora já ofereceu, o crédito já existe, e o fornecedor só não clicou. E tem **relógio** (`expiresAt`, tipicamente poucos dias).
- `contracted.name` vem `null` quando o fornecedor não tem cadastro (`registered: false`) — esses são oportunidade de **aquisição** de cedente.
- `contractor.taxId` pode ser filial ou SPE; `headquartersTaxId` é a matriz. **Guardar os dois** e usar a matriz para crédito, grupo econômico e certificados (04b).
- `origin = sienge` só existe em pré-autorizações pós-migração (`migrated: false`); as migradas por integração saem como `integration`.

### 2.2 `GET /api/v1/sienge-installments`
Uma linha por **parcela** de título do ERP. Campos relevantes: `id`, `situation`, `guardReason`, `exceptionCode`, `firstSeenAt`, `hydratedAt`, `installmentId`, `installmentNumber`, `amount`, `withheldTax`, `dueDate`, `erpSituation`, `sentToBank`, `paymentType`, `erpPaidAt`, `erpRemovedAt`, `nfeCandidate` (accessKey, count), `writeBack`, `bill` (billId, documentNumber, documentType, origin, status, **accessKey**, issueDate, totalAmount, withheldTaxTotal), `connection`, `contractor`, `creditor`, `anticipation`.

Armadilhas que **precisam** estar no código:
- **`firstSeenAt` é a data de entrada; `hydratedAt` muda a cada releitura e NÃO serve como data de entrada nem de filtro de novidade.**
- **`withheldTax` e `bill.withheldTaxTotal` são tri-estado**: `0` = sem retenção · valor = retenção lida · **`null` = o ERP não informou** — nunca tratar `null` como zero (nem em soma, nem em exibição).
- **`bill.billId` só é único dentro de uma conexão** — nunca usar sozinho como chave; sempre com `connection.id`/`contractor`. A PK da nossa tabela é o `id` da API.
- **`creditor.taxId` vem `null` para credor pessoa física** — não casa com `empresas`; exibir marcado como credor PF e manter fora do roteamento e do agrupamento por fornecedor.
- `removed_in_erp` vence as demais situações, e mantém `anticipation` preenchido como histórico da operação cancelada.

## 3. Sincronização

Ambos: paginados (`page_size` até 200), datas em **horário de Brasília**, **janela máxima de 92 dias**, e o filtro de data incide sobre `createdAt` (pré-auth) / `firstSeenAt` (títulos).

**Duas passadas — e a segunda não é opcional:**
1. **Novidade, a cada 4h** (encadeada após o sync de NFs do 04): janela curta de 7 dias sobre a data de entrada.
2. **Estado, diária (madrugada)**: varredura completa dos 92 dias. *Necessária porque o filtro de data é sobre a entrada, não sobre a atualização: uma pré-autorização criada há 20 dias que expirou hoje, ou um título que mudou de `ready_to_create` para `offer_created`, jamais apareceriam numa janela curta.*

Idempotente por `id` da API (upsert). Toda transição de `status`/`situation` grava o valor anterior e emite evento. Registrar execução em `mercado_ingestoes` (fontes `onepay_pre_autorizacoes` e `onepay_sienge_titulos`), com a mesma política de retry e alerta dos demais syncs.

## 4. Modelo

```sql
create table pre_autorizacoes (
  id_externo int primary key,
  status text not null, status_anterior text,
  origin text not null, migrated boolean,
  identification text,
  criada_em timestamptz, expira_em timestamptz, solicitada_em timestamptz,
  valor numeric(14,2) not null,
  invoice_number text, numero_normalizado text,      -- normalizador do 04e
  vencimento date,
  sacado_cnpj text not null, sacado_matriz_cnpj text, sacado_nome text,
  fornecedor_cnpj text not null, fornecedor_nome text, fornecedor_cadastrado boolean,
  anticipation_id_externo int,
  revoked_reason text,
  sienge_bill_id int, sienge_installment_id int,
  sienge_installment_number int, sienge_document_number text,
  -- deduplicação (§5)
  origem_exibida boolean default true,               -- false = escondida porque há original
  original_tipo text, original_id text,              -- 'nf' + access_key | 'titulo' + id
  raw jsonb, sincronizada_em timestamptz default now()
);
create index on pre_autorizacoes (status, expira_em);
create index on pre_autorizacoes (fornecedor_cnpj, sacado_cnpj);

create table sienge_titulos (
  id_externo int primary key,                        -- id da API (globalmente único)
  situation text not null, situation_anterior text,
  guard_reason text, exception_code text,
  primeira_vez_visto timestamptz, hidratado_em timestamptz,
  installment_id int, installment_number int,
  valor numeric(14,2) not null,
  retencao numeric(14,2),                            -- TRI-ESTADO: null ≠ 0
  vencimento date,
  erp_situacao text, enviado_banco boolean, tipo_pagamento text,
  erp_pago_em timestamptz, erp_removido_em timestamptz,
  nfe_candidate_access_key text, nfe_candidate_count int,
  write_back_status text, write_back_repointed_em timestamptz,
  bill_id int not null, bill_document_number text, bill_document_type text,
  bill_origin text, bill_status text, bill_access_key text,
  bill_issue_date date, bill_total numeric(14,2), bill_retencao_total numeric(14,2),
  connection_id int, connection_subdomain text,
  sacado_cnpj text not null,                         -- contractor.taxId = matriz dona da conexão
  sacado_matriz_cnpj text not null,                  -- igual ao acima; ver §4.1
  sacado_nome text,
  credor_cnpj text, credor_nome text, credor_erp_id int,
  credor_pessoa_fisica boolean default false,        -- credor_cnpj null
  pre_autorizacao_id_externo int, anticipation_id_externo int,
  anticipation_status text, anticipation_net numeric(14,2),
  numero_normalizado text,
  origem_exibida boolean default true,
  original_tipo text, original_id text,
  raw jsonb, sincronizado_em timestamptz default now()
);
create index on sienge_titulos (situation, vencimento);
create index on sienge_titulos (sacado_cnpj, bill_id);
create index on sienge_titulos (bill_access_key);
```

**`notas_fiscais` não é alterada.** Para marcar uma NF escondida por dedup, usar uma tabela lateral (nada de coluna nova no funil existente):

```sql
create table funil_ocultacoes (
  tipo text not null,                 -- 'nf' | 'pre_autorizacao' | 'titulo'
  referencia_id text not null,        -- access_key | id_externo
  motivo text not null,               -- 'tem_original' | 'duplicado_canal'
  original_tipo text, original_id text,
  criado_em timestamptz default now(),
  primary key (tipo, referencia_id)
);
```

### 4.1 Amarração sempre na matriz (SPE e filial)

**Regra do sistema: crédito, limite, carteira, roteamento, grupo econômico e certificados (04b) são sempre amarrados na MATRIZ.** A SPE ou filial é guardada como detalhe da operação, nunca como a entidade que carrega a relação.

As duas fontes se comportam de forma diferente, e o código precisa saber disso:

- **Pré-autorização — traz as duas**: `contractor.taxId` pode ser filial ou SPE, e `contractor.headquartersTaxId` é a matriz. Guardar os dois (`sacado_cnpj` e `sacado_matriz_cnpj`) e **usar a matriz** para tudo que é relação.
- **Título Sienge — traz só a matriz**: o `contractor` do título é a construtora **dona da conexão com o ERP**, que é a matriz. O payload **não informa a SPE** da parcela, mesmo quando o empreendimento é de uma. Portanto `sacado_cnpj = sacado_matriz_cnpj` para títulos, e a granularidade de SPE simplesmente não existe nessa fonte.

**Consequência prática no casamento título → pré-autorização**: quando a parcela vira oferta, o sacado pode "ficar mais específico" — o título aponta para a matriz e a pré-autorização pode apontar para a SPE. Isso **não é divergência**: normalizar os dois pela matriz para casar, e enriquecer o registro do título com a SPE descoberta na pré-auth (`sacado_cnpj` passa a ser o da SPE, `sacado_matriz_cnpj` permanece). O card sempre exibe a matriz, com a SPE como detalhe quando houver.

Para `notas_fiscais`, resolver a matriz pelo CNPJ raiz (8 primeiros dígitos) ou pelo grupo econômico já mapeado (02) — sem alterar a tabela: a matriz entra como campo derivado na projeção.

## 5. Deduplicação — a regra

**Hierarquia: o original tem precedência sobre o derivado.** Quando uma NF ou um título já virou pré-autorização, **lista-se o original** e o card exibe um selo **"já tem pré-autorização"** com o status e a data. A pré-autorização correspondente não vira card próprio.

**Como casar:**
- **Pré-auth ↔ título**: direto por id — a pré-auth traz `sienge.billId`/`installmentId`, e o título traz `anticipation.preAuthorizationId`. Sem ambiguidade.
- **Pré-auth ↔ NF**: quando `origin = nfe` (ou quando houver `invoiceNumber`), casar por **sacado + fornecedor + número normalizado** com o **mesmo normalizador do 04e** (zeros à esquerda e série ignorados; zeros à direita nunca), desempatando por valor (±1%) e vencimento (±5 dias). Ambíguo → **não esconde nada**: mantém os dois visíveis e registra na fila de revisão do 04e. *Esconder por palpite é pior que mostrar duplicado.*
- **Pré-auth sem original** (`origin` = manual, integration, file, lite, ou `nfe` sem NF nossa): ela **é** o original — vira card normalmente.

**Título ↔ NF (o caso que a doc não cobre e precisa de decisão)**: o mesmo recebível pode chegar por dois caminhos — a NF pelo certificado do fornecedor e o título pela conexão Sienge da construtora. O `bill.accessKey` e o `nfeCandidate.accessKey` permitem o casamento direto com `notas_fiscais.access_key`.
Implementar sob config **`funil_config.prioridade_nf_vs_titulo`**, com **default `'titulo'`**:
- `'titulo'` (default) — exibe a **parcela**, esconde a NF, e o card da parcela mostra "NF nº X, parcela N de M". *Justificativa: a parcela é a unidade que vira oferta e é antecipada; a NF de R$ 55k com três parcelas esconderia que só uma está disponível agora.*
- `'nf'` — exibe a NF e esconde os títulos, com nota "no canal Sienge".
Sem `accessKey` dos dois lados, **não deduplicar** (casar por número aqui é arriscado porque parcela ≠ nota).

Tudo isso roda num job (`funil/deduplicar`) após cada sync, escrevendo em `funil_ocultacoes` e nos campos `origem_exibida`/`original_*`. **Nada é apagado** — ocultação é reversível e auditável.

## 6. Projeção unificada (a camada visual)

Uma view read-only `funil_oportunidades` com `UNION ALL` das três fontes, expondo **o mesmo contrato** que o card e o motor de faixas já consomem:

| Campo do contrato | NF | Pré-autorização | Título Sienge |
|---|---|---|---|
| `tipo` | `nf` | `pre_autorizacao` | `titulo` |
| `id` | access_key | id_externo | id_externo |
| `fornecedor_cnpj/nome` | supplier | contracted | creditor (null se PF) |
| `sacado_cnpj/nome` | recipient | contractor (+ matriz) | contractor |
| `valor` | amount | amount | amount (da parcela) |
| `vencimento` | dueDate | dueDate | dueDate |
| `data_base` | emitida_em | createdAt | firstSeenAt |
| `numero_exibicao` | nº + série | invoiceNumber | documentNumber + parcela N |
| `estado_origem` | status_sync | status | situation |
| `relogio` | — | **expira_em** | — |

Campos derivados calculados igual para os três: `dias_para_vencimento`, `fornecedor_cadastrado`, `sacado_cadastrado`, `sacado_matriz_cnpj`, `sacado_credito_status`, `sacado_limite_cobre_valor`, `receita_esperada`, `faixa`, `vendedor_id`. **O motor de faixas e o filter engine não mudam** — passam a ler a projeção em vez de `notas_fiscais` direto. Adicionar `tipo` ao catálogo de variáveis do filter engine, para permitir filtro e regras por origem.

A view filtra `origem_exibida = true` e exclui o que está em `funil_ocultacoes`.

### 6.1 RLS — as mesmas regras que valem para NF, sem exceção

As duas tabelas novas recebem **exatamente as mesmas políticas de RLS já aplicadas em `notas_fiscais`**: originador enxerga apenas o que está roteado para ele (`vendedor_id`), quem tem `vendedor_acessos` enxerga os concedidos, perfis gestores enxergam tudo, e o acesso ao módulo continua governado pelo Tool Registry. Ler as políticas atuais de `notas_fiscais` no repositório e **replicá-las literalmente** — não reescrever de memória, não inventar variação.

Para isso, o `vendedor_id` precisa ser resolvido para pré-autorizações e títulos pelo **mesmo motor de roteamento** (04g §3), no job de sync. Item sem dono fica com `vendedor_id` nulo e cai na fila de atribuição do gestor, como já acontece com NF.

> **Armadilha de Postgres que precisa estar no código**: uma view executa com os privilégios de quem a criou e, por padrão, **ignora o RLS das tabelas de base**. A projeção tem que ser criada com `security_invoker = true`:
> ```sql
> create view funil_oportunidades with (security_invoker = true) as ...
> ```
> Sem isso, o originador A passa a enxergar as oportunidades do originador B através da view, mesmo com as políticas corretas nas tabelas. Incluir um teste automatizado que autentica como dois originadores diferentes e confirma o isolamento na view — não só nas tabelas.

## 7. O que entra no funil (config `funil_config.entram`)

**Pré-autorizações**: `WAITING_CONTRACTED` (sempre, prioridade máxima) · `EXPIRED`, `REVOKED`, `AUTOMATICALLY_REVOKED` dentro de janela de recuperação (default 15 dias) · `ANTICIPATION_REQUESTED` **não entra** (já converteu).

**Títulos**: `ready_to_create` · `awaiting_evaluation` · `held_by_client_filter` · `not_eligible` **apenas com `guardReason` recuperável** (lista em config; ex.: `SUPPLIER_CNPJ_MISSING` é trabalho de originador — basta cadastrar o fornecedor) · `offer_created` entra **como original com o selo de pré-autorização** (§5) · `paid_in_erp` e `removed_in_erp` **não entram no funil**, mas alimentam métrica de perda (§9).

## 8. UI — cards iguais, com um selo de tipo

**O mesmo componente de card serve os três tipos.** Nada de card alternativo, nada de layout próprio por fonte: quem olha o funil vê uma lista homogênea, e só o selo diz de onde veio cada item.

**Campos obrigatórios do card — idênticos aos da NF hoje, preenchidos para os três tipos:**

| Campo do card | NF | Pré-autorização | Título Sienge |
|---|---|---|---|
| **Selo de tipo** | `NF` | `Pré-aut.` | `Título` |
| Fornecedor (nome) | supplier | contracted (`"Sem cadastro"` quando `name` é null) | creditor (ou `"Credor PF"`) |
| Badge de tipagem do fornecedor | aquisição / ativação / recorrência — mesma regra | idem | idem |
| Valor | amount | amount | amount da **parcela** |
| Outras oportunidades vivas do mesmo fornecedor | `+3 itens · R$ 180k` — **contando os três tipos** | idem | idem |
| Receita esperada | mesma fórmula | idem | idem |
| Dias para vencimento (com cor de urgência) | dueDate | dueDate | dueDate |
| Sacado + status de crédito | recipient | contractor | contractor |
| Faixa (alta/boa/média) | motor atual | idem | idem |

**Uma única linha de contexto** varia por tipo, no mesmo lugar do card: NF → número/série · Pré-auth → **"expira em X dias"** (cor de urgência quando ≤ 2) e a origem · Título → documento, **parcela N/M**, situação e `guardReason` quando houver.

**Selo adicional "já tem pré-autorização"** (com status e data) no card do original, conforme §5.

**Filtro por tipo** na barra do funil (multi-seleção: NF · Pré-aut. · Título), persistido por usuário, e disponível também como variável do filter engine (`tipo`) para segmentos e regras.

Ordenação default inalterada (receita esperada), mas **pré-autorizações `WAITING_CONTRACTED` com relógio curto sobem** — regra de desempate, não de ordenação nova.

Vale nas duas superfícies: **Antecipação → Funil de NFs** (tudo) e **painel do originador no Comercial** (só o roteado para ele). **Mobile idem**, com o mesmo card e as mesmas ações de swipe.

## 9. Integrações (sem quebrar o que existe)

- **Roteamento (04g)**: mesma precedência (carteira explícita → território → fila sem dono), agora sobre a projeção.
- **Outbox (04/05A)**: o agrupamento por fornecedor passa a considerar **os três tipos** — um fornecedor com 2 NFs, 1 pré-auth e 1 título recebe **um toque só**, com o valor somado. Cooldown e supressão inalterados.
- **Conversão (04e)**: pré-auth converte quando `status = ANTICIPATION_REQUESTED` com `anticipationId`; título converte quando `anticipation.anticipationId` é preenchido. **Casamento direto por id — sem matching fuzzy.**
- **Comissão (04k) — atenção ao duplo lançamento**: o fato gerador continua sendo **a antecipação** (`origem_tipo = 'nf_convertida'`, `origem_id` = id da antecipação), nunca o card. Como NF, pré-auth e título podem apontar para a mesma antecipação, manter a unicidade por `(papel, origem_tipo, origem_id, vendedor_id)` garante **um lançamento só**. Os cards são caminhos de descoberta, não fatos geradores.
- **Métricas de perda** (novo bloco no dashboard do funil e no report semanal 04q): títulos `paid_in_erp` (pagos no ERP sem antecipar — o dinheiro estava lá e passou), `not_eligible` por `guardReason`, e pré-autorizações expiradas/revogadas com valor somado.

## 10. Eventos, tools e entregáveis

**Eventos**: `preauth.sincronizada`, `preauth.status_alterado`, `preauth.expirando` (D-2), `preauth.expirada`, `titulo.sincronizado`, `titulo.situacao_alterada`, `titulo.nao_elegivel_recuperavel`, `titulo.pago_no_erp`, `funil.item_ocultado`.
**Notificações**: `preauth.expirando` → originador titular (push — é o item mais perecível do sistema); `titulo.nao_elegivel_recuperavel` → originador.
**Tools**: `funil.oportunidades` (read — aceita filtro por tipo), `funil.preauths_expirando` (read).
**Worker**: `funil/sync-preautorizacoes` e `funil/sync-titulos` (4/4h curto + diário completo, §3), `funil/deduplicar` (após cada sync).
**Core**: clientes das duas APIs com paginação e janela de 92 dias; normalização de CNPJ e de número (reuso do 04e); resolução de matriz (§4.1); construtor da projeção; motor de dedup **com testes** cobrindo: pré-auth com original NF, pré-auth com original título, pré-auth órfã, título ↔ NF por accessKey nos dois modos de config, ambiguidade (não oculta), `removed_in_erp` com anticipation preenchido, retenção `null` ≠ 0, credor PF, `billId` repetido entre conexões, título de matriz casando com pré-auth de SPE.
**Segurança**: políticas de RLS replicadas de `notas_fiscais` nas duas tabelas novas, view com `security_invoker = true`, e teste de isolamento entre dois originadores lendo **pela view** (§6.1).
**Env**: reutiliza `ONEPAY_BI_URL`/token.
**Docs**: README — as três fontes, a regra de dedup e a config de prioridade, por que `hydratedAt` não é data de entrada, e o tri-estado da retenção.

## 11. Fora de escopo

Alterar qualquer comportamento do funil de NFs atual · criar estágios ou ações novas · escrever de volta no Sienge (`writeBack` é só leitura aqui) · pré-autorizações de cedente · agir sobre `paid_in_erp` (só métrica).
