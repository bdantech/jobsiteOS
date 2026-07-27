# JOBSITEOS — Claude Code Prompt 04: Módulo Antecipação (Funil de NFs)
## Sync de notas, faixas de probabilidade, receita esperada, outbox em modo sombra

> Builds on Prompts 01–03 (foundation, Mercado + filter engine, Radar + supressão/protestos/clientes Onepay). Read the codebase first; reuse the filter engine, worker architecture, `notify()`, event log, and `supressao`. Every feature ships on **web AND mobile** unless marked `webOnly`. UI pt-BR, code English. Migrations via Supabase MCP.

---

## 1. Conceito — o "misto"

- **A NF é a unidade do funil**: dinâmica (novas a cada sync), perecível (expira com o vencimento), classificada em faixas por regra.
- **O fornecedor é a unidade de abordagem**: tipagem comercial, cooldown de toques, agrupamento de mensagens. Ninguém recebe um toque por nota; recebe um toque pelo conjunto de notas vivas.
- Mesma separação já usada no Mercado: **`faixa`** = classificação computada por regra versionada (alta | boa | media | null); **`estagio_funil`** = movido por ação (a_prospectar → em_prospeccao → em_negociacao → antecipacao_andamento → convertida | perdida | expirada).

## 2. Banco de dados

```sql
-- ─── Notas fiscais (accessKey = chave natural, sync idempotente) ───
create table notas_fiscais (
  access_key text primary key,           -- 44 dígitos, único nacional
  nf_id_externo text,                    -- "id" do payload (NFe-12345)
  tipo text not null,                    -- NFe | NFSe
  direction text not null,               -- received | issued
  numero text, serie text,
  valor numeric(14,2) not null,
  emitida_em timestamptz,
  vencimento date,
  vencimento_origem text,                -- xml | endpoint | estimado
  status_sync text,                      -- status vindo do endpoint
  sacado_cnpj text not null,             -- recipient.taxId (14 dígitos texto)
  sacado_nome text,
  sacado_cadastrado boolean,
  fornecedor_cnpj text not null,         -- supplier.taxId
  fornecedor_nome text,
  fornecedor_cadastrado boolean,
  contato_sacado jsonb,                  -- recipient.contact
  -- classificação e funil
  faixa text,                            -- alta | boa | media | null (fora das faixas)
  faixa_regra_versao int,
  faixa_motivo text,                     -- por que está/saiu (ex.: 'expirada', 'suprimido')
  estagio_funil text not null default 'a_prospectar',
  estagio_alterado_em timestamptz,
  estagio_alterado_por uuid,
  perda_motivo text,
  -- economia
  receita_esperada numeric(12,2),
  taxa_usada numeric(6,3),
  dias_para_vencimento int,              -- recalculado no job diário
  -- crédito (snapshot no momento do sync; histórico em tabela própria)
  credit_status text, credit_role text,
  credit_limite numeric(14,2), credit_disponivel numeric(14,2),
  raw_xml text,                          -- guardar SEMPRE (semente do Pricing)
  sincronizada_em timestamptz,
  criada_em timestamptz default now(),
  atualizada_em timestamptz default now()
);
create index on notas_fiscais (fornecedor_cnpj, faixa);
create index on notas_fiscais (sacado_cnpj);
create index on notas_fiscais (faixa, estagio_funil);
create index on notas_fiscais (vencimento);

-- Itens da NF extraídos do XML (semente do Pricing — extrair já)
create table nota_itens (
  id uuid primary key default gen_random_uuid(),
  access_key text references notas_fiscais(access_key) on delete cascade,
  ordem int,
  codigo text, descricao text, ncm text, cfop text,
  unidade text, quantidade numeric(14,4),
  valor_unitario numeric(14,4), valor_total numeric(14,2)
);
create index on nota_itens (access_key);

-- Histórico de análise de crédito por sacado (a derivada importa)
create table credito_snapshots (
  id uuid primary key default gen_random_uuid(),
  cnpj text not null,
  capturado_em timestamptz default now(),
  status text, role text, via_headquarters boolean,
  credit_limit numeric(14,2), available_limit numeric(14,2), consumed_limit numeric(14,2),
  expiration_date date, monthly_rate_d0 numeric(6,3), monthly_rate_d1 numeric(6,3),
  origem text default 'sync_nf'
);
create index on credito_snapshots (cnpj, capturado_em desc);

-- Tipagem comercial do fornecedor (computada, cacheada)
alter table empresas add column tipagem_antecipacao text;
  -- aquisicao   → não cadastrado na plataforma
  -- ativacao    → cadastrado, nunca antecipou
  -- recorrencia → já antecipou, mas tem NF viva fora do funil de conversão
alter table empresas add column ultima_antecipacao date;

-- Regras de faixa (versionadas, mesmo padrão da pirâmide)
create table faixa_regras (
  id uuid primary key default gen_random_uuid(),
  faixa text not null,                   -- alta | boa | media
  versao int not null,
  definicao jsonb not null,              -- filter tree
  ativa boolean default false,
  criada_por uuid references usuarios(id),
  criada_em timestamptz default now(),
  unique (faixa, versao)
);

-- Config de disparo por faixa (modo sombra nesta fase)
create table faixa_disparos (
  faixa text primary key,
  email_habilitado boolean default false,
  whatsapp_habilitado boolean default false,
  whatsapp_contas uuid[] default '{}',   -- quais números usar (round-robin)
  cooldown_dias int default 7,           -- mín. entre toques ao MESMO fornecedor
  template_email text,                   -- placeholder simples nesta fase
  template_whatsapp text
);

-- Contas de WhatsApp (cadastro apenas — integração real no próximo prompt)
create table whatsapp_contas (
  id uuid primary key default gen_random_uuid(),
  apelido text not null,
  numero text not null,
  provedor text default 'wasender',
  token_encrypted text,                  -- criptografar com pgcrypto/pgsodium; NUNCA exibir de volta
  usuario_responsavel uuid references usuarios(id),
  ativo boolean default true,
  criada_em timestamptz default now()
);

-- Outbox (modo sombra: registra o que SERIA enviado)
create table mensagens_outbox (
  id uuid primary key default gen_random_uuid(),
  canal text not null,                   -- email | whatsapp
  fornecedor_cnpj text not null,
  destinatario text,                     -- email/telefone escolhido
  whatsapp_conta_id uuid references whatsapp_contas(id),
  faixa text,
  access_keys text[] not null,           -- NFs agrupadas neste toque
  valor_total numeric(14,2),
  assunto text, corpo text,              -- mensagem gerada
  status text not null default 'pendente_envio',
    -- pendente_envio (sombra) | aprovada | enviada | falhou | descartada
  motivo_descarte text,
  criada_em timestamptz default now()
);
create index on mensagens_outbox (fornecedor_cnpj, criada_em desc);
create index on mensagens_outbox (status);
```

**Supressão** (reusar tabela `supressao` do Radar — adicionar colunas):
```sql
alter table supressao add column expira_em date;   -- null = eterna
alter table supressao add column contexto text;    -- 'antecipacao' | 'geral' | ...
```
- **Soft** (ex.: "sem interesse agora"): `expira_em = hoje + 90 dias` (configurável). Job diário remove expiradas — o fornecedor volta a ser elegível.
- **Eterna** (LGPD, multinacional que nunca antecipa): `expira_em = null`.
- Fornecedor suprimido: suas NFs continuam no universo, mas `faixa = null` com `faixa_motivo = 'suprimido'`.

## 3. Sync (4 em 4 horas)

Endpoint: `GET {ONEPAY_BI_URL}/api/v1/...` (nfs sincronizadas — env `ONEPAY_NF_URL`), paginado, com `period.startDate/endDate`.

- **Agenda**: 06:30, 10:30, 14:30, 18:30, 22:30, 02:30 **America/Sao_Paulo**. Vercel Cron é UTC → `30 9,13,17,21,1,5 * * *`. Disparo → job no worker.
- **Janela com sobreposição**: buscar desde o último sync bem-sucedido menos 6h (colchão para atrasos do lado de lá). A sobreposição é segura porque o processamento é **idempotente por `access_key`** (upsert): nota nova insere, repetida atualiza — mudanças de status (cancelamento) e de `creditAnalysis` chegam como update da mesma linha.
- Por nota: normalizar CNPJs (14 dígitos texto); upsert `notas_fiscais`; inserir `credito_snapshots` **somente se algo mudou** vs. último snapshot do sacado; parsear `raw_xml`:
  - **Vencimento**: extrair de `cobr/dup/dVenc` (pode haver múltiplas parcelas — usar a primeira em aberto; se várias, registrar todas em `nota_itens`? não — parcelas em jsonb `parcelas` na própria nota). Se não houver no XML nem no endpoint: `vencimento = emitida_em + 30 dias`, `vencimento_origem = 'estimado'`. Sempre gravar a origem.
  - **Itens**: extrair `det/prod` (código, descrição, NCM, CFOP, unidade, quantidade, vUnCom, vProd) para `nota_itens`. Falha de parse não bloqueia o sync — loga e segue (o XML fica guardado para reprocessar).
- Vincular fornecedor/sacado a `empresas` por CNPJ (criar como no sync de clientes se não existir e for cadastrado na plataforma; caso contrário, apenas referenciar o CNPJ).
- Recalcular tipagem do fornecedor e **receita esperada**:
  `receita_esperada = valor × (monthlyRateD0/100) × (dias_para_vencimento/30)` — usar a taxa do snapshot de crédito mais recente do sacado; se ausente, taxa default de `antecipacao_config`. Guardar `taxa_usada`.
- Registrar execução em `mercado_ingestoes` (fonte `onepay_nf`), mesma política de retry/alerta dos demais syncs.

## 3.1 Enriquecimento cadastral do fornecedor (e de qualquer CNPJ fora do recorte)

Fornecedores chegam pelo sync apenas com nome e CNPJ — e muitos têm CNAE fora do recorte de construção (comércio de materiais, indústria), portanto **não existem em `mercado_universo`**. Sem dado cadastral (capital, Simples, idade, situação), as variáveis de faixa e a Company 360 ficam cegas para eles. Resolver com **fila + cascata de APIs públicas gratuitas** (worker):

- Ao upsert de uma NF cujo `fornecedor_cnpj` (ou `sacado_cnpj`) não tem dado cadastral nem em `mercado_universo` nem em `empresas`, inserir o CNPJ em `cnpj_lookup_fila`.
- Job `antecipacao/lookup-cadastral` consome a fila com cascata de provedores gratuitos, em ordem: **(1)** `https://minhareceita.org/{cnpj}` · **(2)** `https://brasilapi.com.br/api/cnpj/v1/{cnpj}` · **(3)** ReceitaWS free (`https://receitaws.com.br/v1/cnpj/{cnpj}`, máx. 3 req/min — último recurso, throttle rígido). Interface de provedor plugável (mesmo padrão dos protestos), retry entre provedores, backoff em HTTP 429.
- CNPJs que falharem em todos os provedores permanecem `pendente` na fila com contador de `tentativas`; o job re-tenta pendências antigas em toda execução (prioridade para as mais recentes). Após N tentativas (config, default 10), marca `nao_encontrado` e emite evento para revisão manual.
- Resultado normalizado é inserido em **`mercado_universo`** com `origem_ingestao = 'lookup'` e `fora_recorte_cnae = true` quando o CNAE não é do recorte (nova coluna, default false) — assim TODO o resto do sistema (filter engine, reconciliação com `empresas`, Company 360) funciona sem código novo. **Adicionar `fora_recorte_cnae = false` como condição da regra seed do TAM** para o universo comercial não ser poluído por fornecedores de fora do setor (eles existem no staging, mas não sobem na pirâmide).

```sql
create table cnpj_lookup_fila (
  cnpj text primary key,
  motivo text,                     -- 'fornecedor_nf' | 'sacado_nf' | 'manual'
  status text default 'pendente',  -- pendente | resolvido_api | nao_encontrado | erro
  tentativas int default 0,
  criado_em timestamptz default now(),
  resolvido_em timestamptz
);
alter table mercado_universo add column origem_ingestao text default 'receita_dump';
alter table mercado_universo add column fora_recorte_cnae boolean default false;
```

## 3.2 Ponto focal de contato do fornecedor

```sql
alter table contatos add column ponto_focal boolean default false;
-- no máximo um por empresa:
create unique index contatos_ponto_focal_unico on contatos (empresa_id) where ponto_focal = true;
```

- Marcar/desmarcar na lista de contatos da Company 360 (**web e mobile** — estrela/badge "Ponto focal"; marcar um novo desmarca o anterior automaticamente, em transação).
- **Toda escolha de destinatário segue a hierarquia**: ponto focal → senão, melhor contato disponível (com canal válido e não suprimido). Vale para a outbox (§6) e para os botões de contato de um toque no mobile (§9), que pré-selecionam o ponto focal.
- Evento `contato.ponto_focal_definido` no timeline da empresa.

## 4. Faixas e reclassificação

- Regras **alta / boa / media** com o filter engine (mesma UI da pirâmide: editor visual, preview de impacto "esta regra move X notas", versões, ativação). Avaliadas em ordem alta → boa → media; primeira que casa define a faixa.
- **Catálogo de variáveis** (nível NF, com joins): `fornecedor_cadastrado`, `sacado_cadastrado`, `sacado_credito_status`, `sacado_limite_disponivel`, `sacado_limite_cobre_nota` (disponivel ≥ valor), `fornecedor_tipagem`, `fornecedor_tem_protesto`, `fornecedor_e_cliente_onepay`, `fornecedor_ja_antecipou`, `dias_para_vencimento`, `valor`, `receita_esperada`, `direction`, `tipo_nf`, `fornecedor_suprimido`, `sacado_uf`, `fornecedor_uf`.
- **Job diário de reclassificação + expiração** (e após cada sync): recalcula `dias_para_vencimento`; notas com `dias_para_vencimento < minimo_operavel` (config, default 7) saem das faixas (`faixa = null`, `faixa_motivo = 'expirada'`; se estavam em prospecção ativa, `estagio_funil = 'expirada'` + evento). Sem esse job o funil apodrece em duas semanas.
- Seeds (versão 1, ativas — o operador regula com o tempo):
  - **alta**: `fornecedor_cadastrado = true` AND `sacado_credito_status = 'APPROVED'` AND `sacado_limite_cobre_nota = true` AND `dias_para_vencimento entre 15 e 120`
  - **boa**: `sacado_credito_status = 'APPROVED'` AND `fornecedor_cadastrado = false` AND `dias_para_vencimento entre 15 e 120`
  - **media**: `sacado_cadastrado = true` AND `sacado_credito_status != 'APPROVED'` AND `dias_para_vencimento ≥ 15`

## 5. Funil (UI principal)

- **Kanban por estágio** (web; lista agrupada no mobile), com colunas a_prospectar / em_prospeccao / em_negociacao / antecipacao_andamento e a coluna de encerradas (convertida | perdida | expirada). Filtro por faixa, tipagem, sacado, valor.
- **Card = NF**, mas com contexto de fornecedor: badge da tipagem (aquisição/ativação/recorrência), contagem de outras NFs vivas do mesmo fornecedor ("+3 notas · R$ 180k total"), receita esperada, dias para vencimento (com cor de urgência), sacado + status de crédito.
- **Ordenação default: `receita_esperada` decrescente** dentro da faixa — trabalhar onde há mais ROI.
- Ações no card: mover estágio (com motivo obrigatório em perdida), marcar fornecedor sem interesse (abre escolha: **90 dias** ou **eterna**, com motivo), abrir Company 360 do fornecedor/sacado, ver notas agrupadas do fornecedor.
- **Visão por sacado** (aba própria): para cada construtora, `available_limit` vs. **demanda do pipeline** (soma das NFs em faixa contra ela); barra de contenção; evento `sacado.limite_insuficiente` quando demanda > disponível.
- **Sacados a prospectar** (o flywheel inverso, aba própria): sacados com `recipient.registered = false` que recebem NFs de fornecedores que **já operam**, ranqueados por volume agregado. Ação: promover a empresa no Mercado / marcar para abordagem.
- **Métricas por faixa** (dashboard): funil entrou_na_faixa → contatada → respondeu → antecipou (convertida), taxa e valor por faixa e por versão de regra — é o que permite regular os critérios com dados. Derivado de `empresa_eventos` + estágios.

## 6. Disparo em modo sombra

- Toggles por faixa em `faixa_disparos` (e-mail on/off, WhatsApp on/off, quais contas, cooldown).
- Job após cada reclassificação: para cada faixa com canal habilitado, **agrupa as NFs elegíveis por fornecedor**, verifica: `supressao` (via `estaSuprimido()`), cooldown (última mensagem ao fornecedor na `outbox` dentro de `cooldown_dias` → pula), contato disponível seguindo a hierarquia do §3.2 (**ponto focal primeiro**; senão melhor contato com canal válido; sem nenhum → `descartada` com motivo `sem_contato` — insumo direto para lote do Radar).
- Gera a mensagem a partir do template da faixa com variáveis (`{fornecedor_nome}`, `{qtd_notas}`, `{valor_total}`, `{sacado_principal}`, `{receita_estimada_fornecedor?}` — placeholders simples nesta fase) e grava na `mensagens_outbox` com `status = 'pendente_envio'`. **NADA é enviado neste prompt.**
- Tela **Outbox** (webOnly): fila do que seria enviado, com corpo renderizado, filtros por canal/faixa/status, ações descartar (com motivo) e — futuro — aprovar. É a validação da régua antes de ligar os canais.
- Cadastro de contas WhatsApp (webOnly): CRUD com token criptografado (nunca reexibido; só "definido em {data}" + substituir), teste de formato, ativo/inativo, responsável.

## 7. Eventos e notificações

Eventos (sempre ligados ao CNPJ correspondente em `empresa_eventos` quando a empresa existe): `nf.sincronizada` (apenas primeira vez), `nf.faixa_alterada`, `nf.expirada`, `nf.convertida`, `nf.perdida`, `fornecedor.sem_interesse`, `fornecedor.tipagem_alterada`, `sacado.limite_insuficiente`, `sacado.credito_alterado` (mudança relevante no snapshot), `outbox.mensagem_gerada`, `toque.manual` (vendedor ligou/abriu WhatsApp/e-mail pelo app — payload: canal, contato).

Seeds `notificacao_regras`: `sacado.limite_insuficiente` → perfis Admin + Crédito; `nf.convertida` → Comercial; `sacado.credito_alterado` (downgrade) → Crédito; `nf.faixa_alterada` para faixa **alta** → Comercial (push mobile com deep link no card).

## 8. Registry e tools de IA

Módulo `antecipacao`:
- `antecipacao.resumo_funil` (read): contagens e valores por faixa/estágio, top oportunidades por receita esperada.
- `antecipacao.notas_fornecedor` (read): NFs vivas de um fornecedor com contexto de crédito do sacado.
- `antecipacao.capacidade_sacado` (read): limite vs. demanda de um sacado.
- `antecipacao.mover_estagio` (mutates): move NF de estágio.
- `antecipacao.marcar_sem_interesse` (mutates): supressão soft/eterna de fornecedor com motivo.

## 9. Entregáveis

**Worker**: job `antecipacao/sync-nfs` (4/4h, idempotente por accessKey, parser XML com vencimento/parcelas/itens), `antecipacao/reclassificar` (diário + pós-sync, com expiração), `antecipacao/gerar-outbox`, `antecipacao/limpar-supressoes-expiradas` (diário).
**Web**: Kanban do funil, visão por sacado, sacados a prospectar, dashboard de métricas por faixa, editor de regras de faixa (padrão pirâmide), config de disparos por faixa, Outbox, cadastro WhatsApp, settings do módulo (`minimo_operavel`, taxa default, cooldown default, janela de vencimento).
**Mobile — o funil é experiência de primeira classe, desenhada para o vendedor na rua**:
- **Funil como tela principal do módulo**: segmented control por estágio (a prospectar / em prospecção / em negociação / em andamento) + filtro rápido por faixa e tipagem; lista ordenada por receita esperada; pull-to-refresh; busca por fornecedor/sacado.
- **Card otimizado para ação imediata**: fornecedor, valor total agrupado, badge de tipagem, dias para vencimento com cor de urgência, sacado + status de crédito. **Swipe actions**: mover estágio (direita) e sem interesse (esquerda, abrindo escolha 90 dias/eterna).
- **Ações de contato de um toque**: ligar (`tel:`), abrir conversa no WhatsApp (**deep link `wa.me/{numero}` — abre o app do próprio vendedor**, sem relação com as contas de API cadastradas) com mensagem pré-preenchida do template da faixa, e e-mail (`mailto:`). Cada uso registra evento `toque.manual` no `empresa_eventos` com canal — assim o cooldown da outbox também enxerga toques manuais e não atropela o vendedor.
- **Detalhe da NF/fornecedor**: todas as notas vivas do fornecedor, contexto de crédito do sacado (limite disponível vs. valor), histórico de toques, botão para Company 360.
- **Push**: nova NF em **faixa alta** → push para o perfil Comercial (deep link direto no card). Configurável nas preferências de notificação.
- Visão por sacado e sacados a prospectar: leitura. Editor de regras, Outbox e cadastros = `webOnly`.
**Core**: variáveis novas no catálogo do filter engine; parser de XML NFe em `packages/core` (reutilizável pelo Pricing futuro); cálculo de receita esperada.
**Env**: `ONEPAY_NF_URL`, `ONEPAY_NF_TOKEN` (se houver).
**Docs**: README — semântica das faixas vs. estágios, política de expiração, como funciona o modo sombra e o que falta para ligar envios (Prompt 05).

## 10. Fora de escopo (Prompt 05+)

Envio real de e-mail e WhatsApp (integrações, warmup, respostas), inbox de WhatsApp multi-conta, cadências multi-toque, IA gerando mensagem personalizada (aqui é template), sinal SEFAZ no Mercado.
