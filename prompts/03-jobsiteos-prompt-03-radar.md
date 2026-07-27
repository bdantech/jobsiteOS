# JOBSITEOS — Claude Code Prompt 03: Módulo Radar
## Enriquecimento com controle de custo: domínios, contatos (Apollo), protestos (DirectD) e sync de clientes Onepay

> Builds on Prompt 01 (foundation, Tool Registry, `empresas`, `empresa_eventos`, `notify()`) and Prompt 02 (Mercado: `mercado_universo`, `mercado_socios`, grupos, filter engine in `packages/core`, `apps/worker`). Read the existing codebase first and reuse its patterns — especially the **filter engine** and the **worker job architecture**. Every feature ships on **web AND mobile** unless marked `webOnly`. UI in pt-BR, code in English. Migrations via Supabase MCP, `.sql` files in `/supabase/migrations` remain source of truth.

---

## 1. Princípio central

Enriquecimento custa dinheiro real. O módulo inteiro é desenhado em torno de três garantias:

1. **Nunca enriquecer sem aprovação humana explícita**, com custo estimado na tela antes do "ok".
2. **Nunca pagar duas vezes pelo mesmo dado** — TTL (prazo de validade) por tipo de dado + cache negativo (registrar também quando a fonte não retornou nada).
3. **Sempre esgotar as fontes gratuitas antes das pagas** — a cascata de domínio é o exemplo canônico.

Fluxo universal de qualquer enriquecimento: **Seleção → Estimativa → Aprovação → Execução → Reconciliação**.

## 2. Banco de dados

```sql
-- ─── Domínio (resolvido em cascata, ver §3) ────────────────────
alter table empresas add column dominio text;
alter table empresas add column dominio_origem text;      -- rfb | contato | lista | heuristica | claude_busca | manual
alter table empresas add column dominio_confianca text;   -- alta | media | baixa
alter table empresas add column dominio_validado_em timestamptz;
alter table empresas add column dominio_evidencia text;   -- URL/prova de onde veio
alter table mercado_universo add column dominio text;
alter table mercado_universo add column dominio_origem text;
alter table mercado_universo add column dominio_confianca text;
create index on empresas (dominio);

-- ─── Log unitário de enriquecimento (a fonte da verdade de custo e TTL) ───
create table enriquecimentos (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,              -- dominio | contatos | protestos
  fonte text not null,             -- rfb | heuristica | claude_busca | apollo | directd_sp | directd_nacional
  -- alvo: empresa OU domínio (contatos são deduplicados por domínio, ver §4)
  empresa_id uuid references empresas(id),
  cnpj text,
  dominio text,
  lote_id uuid,
  status text not null,            -- sucesso | sem_dados | erro | aguardando_webhook
  custo_estimado numeric(10,4),
  custo_real numeric(10,4),
  unidades_retornadas int,         -- ex.: nº de contatos revelados
  payload jsonb,                   -- resposta bruta da fonte
  erro text,
  executado_em timestamptz default now()
);
create index on enriquecimentos (tipo, cnpj, executado_em desc);
create index on enriquecimentos (tipo, dominio, executado_em desc);
create index on enriquecimentos (lote_id);

-- ─── Lotes ─────────────────────────────────────────────────────
create table lotes_enriquecimento (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,              -- dominio | contatos | protestos
  nome text,
  definicao_filtro jsonb not null, -- filter tree (mesmo formato do Mercado)
  parametros jsonb default '{}',   -- ex.: { incluir_fora_sp: true, revelar_telefone: false }
  total_itens int,
  custo_estimado_min numeric(12,2),
  custo_estimado_esperado numeric(12,2),
  custo_real numeric(12,2) default 0,
  status text not null default 'rascunho', -- rascunho | aguardando_aprovacao | aprovado | executando | concluido | cancelado | falhou
  aprovado_por uuid references usuarios(id),
  aprovado_em timestamptz,
  criado_por uuid references usuarios(id),
  criado_em timestamptz default now(),
  concluido_em timestamptz
);
create table lote_itens (
  id uuid primary key default gen_random_uuid(),
  lote_id uuid references lotes_enriquecimento(id) on delete cascade,
  cnpj text,
  dominio text,
  empresa_id uuid references empresas(id),
  status text default 'pendente',  -- pendente | processando | aguardando_webhook | sucesso | sem_dados | erro | pulado
  custo_real numeric(10,4),
  resultado jsonb,
  erro text,
  atualizado_em timestamptz default now()
);
create index on lote_itens (lote_id, status);

-- ─── Protestos (HISTÓRICO — nunca sobrescrever) ────────────────
create table protestos_consultas (
  id uuid primary key default gen_random_uuid(),
  cnpj text not null,
  empresa_id uuid references empresas(id),
  fonte text not null,             -- directd_sp | directd_nacional
  consultado_em timestamptz default now(),
  tem_protesto boolean,
  qtd_protestos int,
  valor_total numeric(14,2),
  cartorios jsonb,                 -- detalhe por cartório/UF
  payload jsonb,                   -- resposta bruta
  custo numeric(10,4)
);
create index on protestos_consultas (cnpj, consultado_em desc);
-- View de estado atual: último snapshot por CNPJ
create view protestos_atual as
  select distinct on (cnpj) * from protestos_consultas order by cnpj, consultado_em desc;

-- ─── Clientes Onepay (sync diário, ver §7) ─────────────────────
create table clientes_onepay (
  cnpj text primary key,
  onepay_company_id int unique not null,
  empresa_id uuid references empresas(id),
  nome text,
  status text,
  operation_status text,
  credit_limit numeric(14,2),
  available_limit numeric(14,2),
  consumed_limit numeric(14,2),
  consumed_pct numeric(6,4),
  consumed_pct_2m numeric(6,4),
  last_anticipation timestamptz,
  days_without_anticipation int,
  anticipations_last_2m int,
  gross_value_last_2m numeric(16,2),
  primeira_vez_visto timestamptz default now(),
  atualizado_em timestamptz default now()
);
create table clientes_onepay_snapshots (
  id uuid primary key default gen_random_uuid(),
  cnpj text not null,
  capturado_em date not null,
  dados jsonb not null,
  unique (cnpj, capturado_em)
);

-- ─── Lista de supressão (consultada ANTES de qualquer toque) ───
create table supressao (
  id uuid primary key default gen_random_uuid(),
  escopo text not null,            -- email | telefone | whatsapp | empresa
  valor text not null,             -- endereço, número ou CNPJ
  motivo text not null,            -- descadastro | hard_bounce | solicitacao_lgpd | nao_abordar
  observacao text,
  criado_por uuid references usuarios(id),
  criado_em timestamptz default now(),
  unique (escopo, valor)
);

-- ─── Configuração do Radar (settings) ──────────────────────────
create table radar_config (
  chave text primary key,
  valor jsonb not null,
  atualizado_por uuid references usuarios(id),
  atualizado_em timestamptz default now()
);
```

Estender `contatos` (do Prompt 01): `apollo_person_id text`, `email_status text` (verified | guessed | unavailable — **armazenar, não filtrar por ele nesta fase**), `linkedin_url text`, `departamento text`, `senioridade text`, `enriquecido_em timestamptz`, `telefone_status text` (pendente | recebido | indisponivel).

### Seeds de `radar_config`

```jsonc
"custos": {
  "dominio_claude": 0.10,        // R$ por empresa pesquisada
  "contato_apollo": 1.20,        // R$ por contato revelado (ajustar ao plano)
  "protesto_sp": 0.36,
  "protesto_nacional": 3.50
},
"ttl_dias": {
  "dominio": 180, "dominio_sem_dados": 360,
  "contatos": 180, "contatos_sem_dados": 360,
  "protestos_cliente": 30, "protestos_prospeccao": 90
},
"orcamento": {
  "teto_mensal_total": 5000,     // R$ — bloqueia execução ao estourar
  "alerta_percentual": 0.8,      // notifica admins em 80%
  "max_itens_por_lote": 2000
},
"cargos_alvo": {
  // usados para filtrar quem revelar no Apollo (§4). Editáveis na UI.
  "titulos": ["sócio","socio","proprietário","proprietario","fundador","CEO","diretor",
    "diretor financeiro","CFO","gerente financeiro","financeiro","controller","controladoria",
    "gerente administrativo","suprimentos","compras","comprador","procurement",
    "engenheiro","engenharia","gerente de obras","diretor de obras","planejamento",
    "COO","diretor executivo","sócio-diretor"],
  "departamentos": ["finance","operations","engineering","procurement","executive"],
  "senioridades": ["owner","founder","c_suite","partner","vp","head","director","manager"],
  "max_contatos_por_empresa": 4
},
"apollo": { "revelar_telefone_em_lote": false, "bulk_size": 10 },
"protestos": { "clientes_sempre_nacional": true, "prospeccao_incluir_fora_sp_default": false }
```

## 3. Cascata de resolução de domínio

Ordem obrigatória — **só avança quando a etapa anterior não resolve**. Etapas 1–4 são gratuitas e rodam como job do worker sobre qualquer seleção; a 5 é lote pago com aprovação.

1. **E-mail da Receita** (`mercado_universo.email_rfb`): extrai o domínio, descarta provedores genéricos (lista configurável: gmail, hotmail, outlook, live, yahoo, uol, terra, bol, ig, globo, r7, msn, icloud). → `origem = rfb`, confiança **média**.
2. **E-mails de contatos já existentes** (`contatos.email`): mesma lógica. → `origem = contato`, confiança **média**.
3. **Coluna de site das listas importadas**, quando existir. → `origem = lista`, confiança **média**.
4. **Heurística + validação**: gera 4–8 candidatos a partir de razão social e nome fantasia (remove LTDA/S.A./EIRELI/ME/EPP, remove acentos e pontuação, slug completo + núcleo distintivo, extensões `.com.br`, `.com`, `.eng.br`). Valida em três níveis: **(a)** resolve DNS → **(b)** tem registro MX → **(c)** buscar o **CNPJ da empresa no HTML da página** (rodapé/sobre) e, secundariamente, a razão social. → `origem = heuristica`; confiança **alta** se o CNPJ foi encontrado na página, **média** com DNS+MX+nome, **baixa** só com DNS.
5. **Busca com Claude (lote pago)**: para o resíduo. Para cada empresa, chamada à Anthropic API (`claude-sonnet-4-6`) **com a ferramenta de web search habilitada** (`{"type": "web_search_20250305", "name": "web_search"}`) — a busca é obrigatória; sem ela o modelo alucina domínios plausíveis. Prompt: razão social, nome fantasia, município, UF, CNPJ; instrução para pesquisar e retornar **apenas JSON**:
   ```json
   { "dominio": "exemplo.com.br" | null, "confianca": "alta|media|baixa",
     "evidencia": "URL onde encontrou", "motivo": "texto curto" }
   ```
   **O resultado NUNCA é aceito direto**: passa pela mesma validação da etapa 4 (DNS → MX → CNPJ na página). Se falhar na validação, registra `sem_dados`. → `origem = claude_busca`.

Grava sempre em `enriquecimentos` (tipo `dominio`) com status, inclusive `sem_dados` (cache negativo).

## 4. Contatos (Apollo)

**Unidade de cobrança é o DOMÍNIO, não o CNPJ.** SPEs e filiais de um mesmo grupo compartilham domínio — enriquecer por CNPJ pagaria N vezes pela mesma empresa. Ao concluir, os contatos são vinculados à empresa-mãe e **replicados/associados a todos os CNPJs do grupo** que compartilham aquele domínio.

Sequência por domínio:

1. `GET https://api.apollo.io/api/v1/organizations/enrich?domain={dominio}` — dados firmográficos + `organization_id`. Guarda em `empresas.dados_apollo` (jsonb) e usa para complementar campos vazios (site, LinkedIn, headcount, indústria).
2. `POST https://api.apollo.io/api/v1/mixed_people/api_search` com a organização — lista de pessoas. **Filtra pelos `cargos_alvo` de `radar_config`** (títulos, departamentos, senioridades) e limita a `max_contatos_por_empresa` (default 4), priorizando senioridade mais alta. Esta etapa não revela contato — é seleção.
3. `POST https://api.apollo.io/api/v1/people/bulk_match` em blocos de **10 pessoas por chamada** (mais barato em chamadas que `people/match` em loop). Parâmetros: `reveal_personal_emails=true`; `reveal_phone_number` conforme `radar_config.apollo.revelar_telefone_em_lote` (default **false**).

**Telefone é assíncrono**: quando `reveal_phone_number=true`, `webhook_url` é obrigatório e os números chegam depois, separadamente — não vêm na resposta. Implementar:
- Endpoint público `POST /api/webhooks/apollo` — **idempotente** (o Apollo reenvia), autenticado por token no path/query (`APOLLO_WEBHOOK_SECRET`).
- Item fica em `aguardando_webhook`; timeout configurável (default 30 min) marca como `sem_dados` sem travar o lote.

**Créditos e limites** (relevantes para a reconciliação e o throttle):
- Os endpoints de enriquecimento consomem créditos de forma síncrona; a resposta do bulk traz `credits_consumed` — usar para preencher `custo_real` e reconciliar contra o estimado.
- Não há consumo adicional quando a fonte não encontra e-mail/telefone → custo real costuma ficar **abaixo** do estimado pessimista.
- Rate limits são por endpoint e por plano, com janelas de minuto/hora/dia, **não publicados**: ler os headers de rate limit da resposta e implementar throttle adaptativo (backoff ao aproximar do limite). O endpoint bulk é limitado a ~50% do limite por minuto do endpoint individual.
- A busca de pessoas trava em 50.000 registros (100/página, 500 páginas) — irrelevante no volume atual, mas não paginar além disso.

Contatos criados/atualizados em `contatos` com `origem = 'apollo'`, `apollo_person_id` (dedup), `email_status` (armazenado, **não usado como filtro**), `enriquecido_em`.

## 5. Protestos (DirectD)

Dois endpoints, custo muito diferente:
- **SP**: `GET https://apiv3.directd.com.br/api/ProtestosSP?CNPJ={cnpj}` — R$ 0,36. **Cobre apenas cartórios de SP.**
- **Nacional**: `GET https://apiv3.directd.com.br/api/ProtestosOnline?CNPJ={cnpj}` — R$ 3,50.

Roteamento:
- **Clientes** (`clientes_onepay`): **sempre nacional**, independente de UF. É decisão de crédito — cobertura parcial é risco, não economia.
- **Prospecção** (universo/SOM/demais camadas): objetivo é ter um "cheiro" de saúde. Empresas com `uf = 'SP'` → endpoint SP. Empresas fora de SP → **não são incluídas silenciosamente**: o estimador do lote mostra a escolha explícita, ex.: *"312 empresas fora de SP — incluir usando o endpoint nacional (R$ 3,50 cada, +R$ 1.092) ou pular?"* (`parametros.incluir_fora_sp`, default false).

Implementar como **provedor plugável** (interface comum: `consultar(cnpj) → { tem_protesto, qtd, valor_total, cartorios, custo }`), com registro de provedores por tipo de dado e cobertura por UF — score e negativação entram depois sem refatoração.

**Sempre inserir novo registro em `protestos_consultas`** (nunca update). A derivada é o que importa: comparar com a consulta anterior e, se mudou de "sem protesto" para "com protesto" (ou o valor cresceu além de um limiar), emitir evento `protesto.detectado` / `protesto.agravado`.

### Rotina mensal de clientes (cron)
Job mensal do worker: para cada empresa em `clientes_onepay`, consultar protestos **nacional** para: (a) o CNPJ da matriz, e (b) todos os CNPJs do grupo marcados como **SPE ativa** (`is_spe = true` e situação cadastral ativa) ou flagados manualmente. Registra tudo como um lote automático (`lotes_enriquecimento` com `criado_por = null`, status já aprovado — é política, não pedido ad hoc), respeitando o teto de orçamento.

## 6. Fluxo de lote (a UI central do módulo)

### 6.1 Seleção — **reusa o filter engine do Mercado**
Mesmo formato de filter tree, mesma UI de construção de filtros. Variáveis novas registradas no catálogo:
`tem_dominio`, `dominio_confianca`, `dominio_consultado_em`, `contatos_enriquecidos_em`, `qtd_contatos`, `protestos_consultados_em`, `tem_protesto`, `e_cliente_onepay`, `dias_sem_antecipar`, `consumed_pct`.

**Exclusão automática por TTL**: a seleção remove itens enriquecidos dentro do TTL do tipo (e dentro do TTL maior de `sem_dados`), mostrando quantos foram excluídos por esse motivo. Toggle "forçar re-enriquecimento" ignora o TTL (com aviso de custo).

### 6.2 Estimativa
Tela mostra: total de itens elegíveis, quantos excluídos por TTL, **custo mínimo** (só quem tem match provável) e **custo esperado** (aplicando a taxa histórica de sucesso da própria operação, calculada de `enriquecimentos`), quebra por endpoint/fonte, orçamento do mês já consumido e saldo. Bloqueia se estourar `teto_mensal_total`; alerta em `alerta_percentual`.

### 6.3 Aprovação e execução
Aprovar → status `aprovado` → worker consome a fila com throttle por fonte. Progresso item a item na tela (Realtime), com contadores por status e custo acumulado em tempo real.

### 6.4 Reconciliação
Ao concluir: `custo_real` do lote (soma dos itens), comparação com o estimado, taxa de sucesso por fonte. Esses números realimentam a estimativa dos próximos lotes.

## 7. Sync diário dos clientes Onepay

Cron diário (Vercel Cron → worker): `GET {ONEPAY_BI_URL}/api/v1/temperature-report`, paginado (`page`, `pageSize`, `totalPages`). Payload por item:

```json
{ "companyId": 123, "name": "CONSTRUTORA EXEMPLO LTDA", "taxId": "12345678000190",
  "creditLimit": 500000, "availableLimit": 350000, "consumedLimit": 150000,
  "lastAnticipation": "2026-07-20T14:32:00.000Z", "anticipationsLast2Months": 8,
  "grossValueLast2Months": 420000.5, "status": "active", "daysWithoutAnticipation": 4,
  "consumedPct": 0.3, "consumedPct2m": 0.84, "operationStatus": "operating_normally" }
```

Processamento:
1. Normaliza `taxId` para CNPJ de 14 dígitos (texto).
2. Upsert em `clientes_onepay`; insere snapshot diário em `clientes_onepay_snapshots` (histórico é o que permite ver tendência).
3. Casa com `empresas` por CNPJ. **Se não existir**: cria a empresa (promovida, `estagio = 'cliente'`, `tipo = 'construtora'`), enriquece campos cadastrais a partir de `mercado_universo` quando houver, e emite evento `cliente.novo_detectado`.
4. Se existir e `estagio != 'cliente'`, promove o estágio e emite `estagio.alterado`.
5. Compara com o snapshot anterior e emite eventos: `cliente.dormente` (`daysWithoutAnticipation` cruzou limiar configurável, default 15), `cliente.limite_quase_esgotado` (`consumedPct >= 0.9`), `cliente.status_operacional_alterado` (mudança em `operationStatus`), `cliente.reativado`.

Esses eventos alimentam notificações agora e serão gatilhos do motor de toques depois.

## 8. Lista de supressão

Consultada **antes de qualquer toque em qualquer canal**, por e-mail, telefone, whatsapp ou CNPJ. Helper obrigatório em `packages/core`: `estaSuprimido({ escopo, valor }) → boolean`, e um guard que qualquer módulo de comunicação futuro **deve** chamar. UI simples (webOnly): listar, adicionar, remover, importar CSV, com motivo obrigatório. Registrar em `audit_log` toda inclusão/remoção.

## 9. Registry, tools de IA, eventos

Registrar módulo `radar` com tools:
- `radar.status_enriquecimento` (read): cobertura por camada — % com domínio, % com contato, % com protesto consultado.
- `radar.buscar_contatos_empresa` (read): contatos conhecidos de uma empresa/CNPJ.
- `radar.protestos_empresa` (read): histórico de consultas de protesto de um CNPJ.
- `radar.criar_lote` (mutates): monta um lote a partir de descrição em linguagem natural (a IA constrói o filter tree) — **cria em `rascunho`/`aguardando_aprovacao`, nunca executa**.
- `radar.suprimir` (mutates): adiciona à lista de supressão.

Eventos: `dominio.resolvido`, `contatos.enriquecidos`, `protesto.detectado`, `protesto.agravado`, `lote.aguardando_aprovacao`, `lote.concluido`, `orcamento.alerta`, `orcamento.estourado`, `cliente.novo_detectado`, `cliente.dormente`, `cliente.limite_quase_esgotado`, `cliente.status_operacional_alterado`.

Seeds de `notificacao_regras`: `lote.aguardando_aprovacao` → perfil Admin; `orcamento.alerta` e `orcamento.estourado` → Admin; `protesto.detectado` em cliente → Admin + perfil Crédito (criar perfil se não existir); `cliente.dormente` → Comercial.

## 10. Entregáveis

**Worker**: jobs `radar/dominios-cascata` (etapas 1–4), `radar/dominios-claude` (etapa 5), `radar/contatos-apollo`, `radar/protestos`, `radar/protestos-clientes-mensal`, `radar/sync-clientes-onepay` (diário). Throttle adaptativo por fonte, retry com backoff, escrita em `enriquecimentos` + `lote_itens`.

**Web**: Painel do Radar (cobertura de enriquecimento por camada, gasto do mês vs. teto, lotes recentes); construtor de lote (seleção → estimativa → aprovação) para os três tipos; detalhe do lote com progresso e reconciliação; lista de supressão; settings do Radar (custos unitários, TTLs, cargos-alvo, orçamento, parâmetros Apollo/protestos); painel de clientes Onepay (tabela com limites, dias sem antecipar, sinais).

**Mobile**: Painel do Radar (leitura), detalhe de lote (leitura + **aprovar/rejeitar** — aprovação de custo no celular é caso de uso real), contatos e protestos na Company 360, painel de clientes Onepay (leitura). Construtor de lote e settings = `webOnly`.

**Core**: novas variáveis no catálogo de filtros; `estaSuprimido()`; interface de provedores de dados de crédito; normalizador de CNPJ compartilhado.

**Env**: `APOLLO_API_KEY`, `APOLLO_WEBHOOK_SECRET`, `DIRECTD_API_KEY`, `ONEPAY_BI_URL`, `ONEPAY_BI_TOKEN` (se houver auth), `ANTHROPIC_API_KEY` (já existe).

**Docs**: README do Radar — cascata de domínio, política de TTL, como ajustar custos e cargos-alvo, procedimento quando um lote falha, e como o webhook do Apollo deve ser exposto publicamente em dev (ex.: túnel) e em produção.

## 11. Fora de escopo (próximos prompts)

Score e negativação (Carteira), motor de toques/cadências, WhatsApp Hub, ingestão do sinal SEFAZ.
