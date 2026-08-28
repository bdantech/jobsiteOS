# JOBSITEOS — Claude Code Prompt 08: Módulo Jurídico
## Processos judiciais com sync Escavador, cálculo de dívida, parecer com IA e cronograma da ação

> Builds on Prompts 01–04m. Reuse: worker patterns, `empresas` + event log, `notas_fiscais`/`antecipacoes` (04/04e), scorecard (04d), calendário do Comercial (04g), Anthropic API, Supabase Storage, `notify()`. UI pt-BR, code English. Migrations via Supabase MCP.
> **Escopo**: apenas **judicial** e apenas contra **sacados** devedores. Cobrança extrajudicial vem depois (Prompt 07) e poderá ser vinculada a um processo já existente — deixar o campo preparado.

---

## 1. Conceito

A entidade central é o **processo**. A empresa já chega ao módulo com ações em andamento, então o fluxo começa importando o que existe (via Escavador, pelos nossos CNPJs) e não pela originação da cobrança.

## 2. Modelo

```sql
create table processos (
  numero_cnj text primary key,                 -- formato 0000000-00.0000.0.00.0000
  -- partes
  empresa_devedora_id uuid references empresas(id),  -- resolvida pelo CNPJ no polo passivo
  cnpj_devedor text,
  nosso_cnpj text,                             -- qual entidade nossa figura no processo
  polo_nosso text,                             -- ativo | passivo
  titulo_polo_ativo text, titulo_polo_passivo text,
  -- capa
  classe text, assunto text, area text,
  orgao_julgador text, comarca text, uf text,
  tribunal_sigla text, tribunal_nome text, grau int, sistema text,
  valor_causa numeric(16,2),
  data_distribuicao date, data_inicio date, data_arquivamento date,
  segredo_justica boolean, arquivado boolean, fisico boolean,
  status_predito text,                         -- ATIVO | INATIVO (classificação do Escavador)
  url_tribunal text,
  -- gestão interna
  situacao_interna text not null default 'em_andamento',
    -- em_andamento | suspenso | acordo | ganho | perdido | encerrado
  advogado_id uuid references advogados(id),
  fase_atual text,                             -- ver §5
  fase_desde date,
  observacoes text,
  vinculo_cobranca_id uuid,                    -- reservado para o Prompt 07
  -- sync
  data_ultima_movimentacao date,
  qtd_movimentacoes int,
  data_ultima_verificacao timestamptz,
  ultima_sincronizacao timestamptz,
  raw jsonb,
  criado_em timestamptz default now()
);
create index on processos (empresa_devedora_id);
create index on processos (situacao_interna, fase_atual);

create table processo_movimentacoes (
  id bigint primary key,                       -- id do Escavador (idempotente)
  numero_cnj text references processos(numero_cnj) on delete cascade,
  data date not null,
  tipo text,                                   -- ANDAMENTO | PUBLICAÇÃO
  conteudo text not null,
  fonte_nome text, fonte_sigla text, grau int,
  fase_detectada text,                         -- ver §5
  relevante boolean default false,             -- marcada pelo classificador
  criado_em timestamptz default now()
);
create index on processo_movimentacoes (numero_cnj, data desc);

create table processo_envolvidos (
  id uuid primary key default gen_random_uuid(),
  numero_cnj text references processos(numero_cnj) on delete cascade,
  nome text, tipo_pessoa text, cpf_cnpj text,
  tipo text, tipo_normalizado text, polo text,
  advogados jsonb,
  unique (numero_cnj, nome, polo)
);

create table advogados (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  tipo text not null,                          -- interno | externo
  escritorio text,
  oab_numero text, oab_uf text,
  email text, telefone text,
  usuario_id uuid references usuarios(id),     -- quando interno e usuário da plataforma
  ativo boolean default true
);

-- Operações cobradas no processo (o que estamos executando)
create table processo_operacoes (
  id uuid primary key default gen_random_uuid(),
  numero_cnj text references processos(numero_cnj) on delete cascade,
  antecipacao_id_externo int,                  -- 04e
  access_key text,                             -- NF, quando aplicável
  valor_original numeric(14,2) not null,
  vencimento date not null,
  descricao text
);

-- Cálculo de dívida (memória de cálculo versionada)
create table processo_calculos (
  id uuid primary key default gen_random_uuid(),
  numero_cnj text references processos(numero_cnj) on delete cascade,
  data_calculo date not null,
  data_base date not null,                     -- até quando corrigir
  parametros jsonb not null,                   -- juros, multa, índice, honorários usados
  principal numeric(14,2), correcao numeric(14,2), juros numeric(14,2),
  multa numeric(14,2), honorarios numeric(14,2), custas numeric(14,2),
  total numeric(14,2) not null,
  memoria jsonb not null,                      -- linha a linha por operação
  gerado_por uuid references usuarios(id),
  criado_em timestamptz default now()
);

-- Custas e honorários efetivamente gastos
create table processo_custos (
  id uuid primary key default gen_random_uuid(),
  numero_cnj text references processos(numero_cnj) on delete cascade,
  tipo text not null,                          -- custas | honorarios | pericia | diligencia | outros
  descricao text, valor numeric(12,2) not null,
  data date not null,
  comprovante_url text,
  registrado_por uuid references usuarios(id)
);

-- Recuperações recebidas
create table processo_recuperacoes (
  id uuid primary key default gen_random_uuid(),
  numero_cnj text references processos(numero_cnj) on delete cascade,
  valor numeric(14,2) not null, data date not null,
  origem text,                                 -- penhora | acordo | pagamento_espontaneo | leilao
  observacao text
);

-- Prazos e audiências (alimentam o calendário do 04g)
create table processo_prazos (
  id uuid primary key default gen_random_uuid(),
  numero_cnj text references processos(numero_cnj) on delete cascade,
  tipo text not null,                          -- prazo | audiencia | pericia
  descricao text not null,
  data timestamptz not null,
  responsavel_id uuid references advogados(id),
  concluido boolean default false,
  criado_por uuid references usuarios(id)
);

-- Pareceres de IA
create table processo_pareceres (
  id uuid primary key default gen_random_uuid(),
  numero_cnj text references processos(numero_cnj) on delete cascade,
  parecer_markdown text not null,
  proximo_passo text not null,
  risco text,                                  -- baixo | medio | alto
  modelo text, tokens int,
  gerado_por uuid references usuarios(id),
  criado_em timestamptz default now()
);

create table juridico_sync_log (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,                          -- busca_cnpj | atualizacao_processo | callback | monitoramento
  numero_cnj text, cnpj text,
  status text, creditos_utilizados int,
  erro text, executado_em timestamptz default now()
);
```

## 3. Integração Escavador (API v2)

Base: `https://api.escavador.com/api/v2` · Auth: header `Authorization: Bearer {ESCAVADOR_TOKEN}` + `X-Requested-With: XMLHttpRequest` · **Rate limit 500 req/min** (implementar throttle) · custo por requisição vem no header **`Creditos-Utilizados`** → gravar em `juridico_sync_log` e exibir gasto acumulado.

Endpoints usados:
1. **Descobrir processos**: `GET /envolvido/processos?cpf_cnpj={nosso_cnpj}` — parâmetros úteis: `status=ATIVO`, `tribunais[]`, `data_minima`, `ordem`, `limit` (50/100). Paginação por **cursor** (`links.next`). Antes de varrer, usar `GET /envolvido/resumo?cpf_cnpj=` (barato) para saber a quantidade.
2. **Capa detalhada**: `GET /processos/numero_cnj/{numero}` — retorna `fontes[]` (uma por grau/tribunal) com `capa` (classe, assunto, área, órgão julgador, `valor_causa`, datas), `envolvidos[]` com CNPJ e advogados com OAB. **Consolidar**: usar a fonte de menor grau como principal e guardar as demais em `raw`.
3. **Movimentações**: `GET /processos/numero_cnj/{numero}/movimentacoes` — paginado por cursor; upsert por `id` (idempotente).
4. **Atualização sob demanda**: `POST /processos/numero_cnj/{numero}/solicitar-atualizacao` com `{"enviar_callback": 1}` → o robô busca no tribunal. Status via `GET .../status-atualizacao` (PENDENTE | SUCESSO | NAO_ENCONTRADO | ERRO).
5. **Monitoramento de novos processos**: `POST /monitoramentos/novos-processos` com `{ "termo": "<nosso CNPJ ou razão social>" }` — o Escavador dispara callback `novo_processo` quando surgir ação nova. Cadastrar um monitoramento por entidade nossa; listar/remover pelos endpoints correspondentes.
6. **Tribunais**: `GET /tribunais` para popular filtros.

**Callbacks**: expor `POST /api/webhooks/escavador` — valida o token enviado no header `Authorization` (`ESCAVADOR_CALLBACK_TOKEN`), é **idempotente** por `uuid` do payload (o Escavador reenvia até 11 vezes com backoff). Eventos tratados: `novo_processo` (cria processo, notifica) e `atualizacao_processo_concluida` (dispara re-sync daquele CNJ).

**Nossos CNPJs**: settings `juridico_config.nossos_cnpjs[]` (matriz, FIDC, securitizadora etc.), cada um com apelido. A descoberta roda para todos.

**Vínculo com empresa**: ao importar, procurar nos `envolvidos` do polo oposto ao nosso um CNPJ que exista em `empresas`; achou → vincula. Não achou → enfileira em `cnpj_lookup_fila` e deixa `empresa_devedora_id` nulo com aviso na UI (fila de vinculação manual).

## 4. Agenda de monitoramento (settings)

`juridico_config.monitoramento`: **dias da semana** (checkboxes — vale para todos os processos), horário, e escopo (`apenas_ativos` default true). O job roda nos dias marcados: para cada processo ativo, busca movimentações novas e, conforme `forcar_atualizacao_tribunal` (bool, default false — custa crédito), dispara `solicitar-atualizacao`.
**Atualização individual**: botão "Atualizar agora" no processo → `solicitar-atualizacao` + re-sync ao receber o callback, com feedback de status na tela.

## 5. Cronograma da ação (fases e alertas)

Classificador determinístico (palavras-chave sobre `conteudo` das movimentações, tabela de regras editável) atribui `fase_detectada`:
`distribuicao → citacao → contestacao_embargos → instrucao → sentenca → recurso → transito_julgado → cumprimento_execucao → penhora → leilao_expropriacao → arquivamento`.

- `processos.fase_atual` = fase mais avançada detectada; `fase_desde` = data da movimentação que a marcou.
- **Cronograma visual** no detalhe do processo: barra por fase com **tempo decorrido em cada uma** e o total desde a distribuição.
- **Alerta de lentidão**: benchmark de dias por fase em `juridico_config.benchmark_fases` (seeds razoáveis, editáveis; ex.: citação 60d, contestação 45d, sentença 180d, penhora 90d). Fase estourou o benchmark → badge vermelho, evento `processo.fase_lenta` e notificação ao advogado responsável + gestor.
- **Processo parado**: sem movimentação há X dias (config, default 60) → evento `processo.sem_movimentacao`.

## 6. Cálculo da dívida

Botão "Gerar cálculo" no processo: soma as `processo_operacoes` e aplica, com parâmetros configuráveis (`juridico_config.calculo`, versionados no próprio `processo_calculos.parametros`):
`correção monetária` (índice configurável — IPCA/IGP-M/INPC/TR/customizado, tabela de índices mensais editável e importável), `juros de mora` (% a.m., simples ou compostos), `multa` (%), `honorários` (%), e as `processo_custos` do período.

Saída: total atualizado + **memória de cálculo linha a linha por operação** (principal, período, índice aplicado, juros, multa) — exportável em **CSV e PDF** para o advogado juntar aos autos. Histórico de cálculos preservado (nunca sobrescrever).

## 7. Parecer jurídico com IA

Botão "Gerar parecer" (sob demanda; custo de tokens). Entrada: capa completa, todas as movimentações (ou as últimas N + as marcadas relevantes), fase atual e tempos, valor da causa, cálculo mais recente, custos incorridos, recuperações, dados da empresa devedora (score, protestos, situação cadastral, outros processos nossos contra ela).

Saída em markdown, seções fixas: **(1)** situação atual em linguagem simples · **(2)** o que aconteceu até aqui (resumo cronológico) · **(3)** riscos e pontos de atenção · **(4)** **próximo passo recomendado** (campo estruturado `proximo_passo`, curto e acionável) · **(5)** avaliação de risco (`baixo|medio|alto`) · **(6)** perguntas para o advogado responsável.

Restrições no prompt: usar **apenas** os dados fornecidos; nunca afirmar prazo processual sem base na movimentação; declarar quando a informação é insuficiente; **não é peça jurídica nem substitui o advogado** (aviso fixo no rodapé do parecer na UI). Parecer é editável e versionado.

## 8. UI (novo módulo Jurídico)

**Lista/kanban** por `situacao_interna`, com filtros por empresa, tribunal, UF, fase, advogado, valor. Colunas: processo, devedor, valor da causa, valor atualizado, fase (com badge de lentidão), última movimentação, advogado.
**Detalhe do processo**: capa completa, cronograma de fases, timeline de movimentações (com destaque para as relevantes), envolvidos e advogados, operações cobradas, cálculo atual + histórico, custos e recuperações (com **saldo líquido**: recuperado − custos), prazos/audiências, parecer de IA, botões "Atualizar agora" / "Gerar cálculo" / "Gerar parecer".
**Dashboard**: total em litígio, valor atualizado da carteira, recuperado no ano, custo acumulado, processos por fase, top devedores, alertas de lentidão e de processos parados.
**Company 360**: seção "Jurídico" com os processos daquela empresa e o valor em disputa.
**Admin**: cadastro de advogados, nossos CNPJs, agenda de monitoramento, benchmarks de fase, parâmetros e índices de cálculo, regras do classificador.

**Mobile**: lista e detalhe (leitura), cronograma, parecer, prazos/audiências, registro de custo com foto do comprovante, push de movimentação relevante e de prazo próximo. Cadastros e configurações = `webOnly`.

## 9. Integrações com o resto do sistema

- **Prazos e audiências** aparecem no calendário do 04g do advogado (quando usuário) e do gestor.
- **Scorecard (04d)**: empresa com processo nosso ativo → **knockout de crédito** (nova regra: `tem_processo_nosso_ativo` como variável e condição de knockout). Adicionar ao catálogo de filtros.
- **Ex-clientes (04h)**: processo ativo reforça o motivo de churn "Inadimplência/default" (sugestão, não automático).
- **Eventos**: `processo.importado`, `processo.movimentacao_relevante`, `processo.fase_alterada`, `processo.fase_lenta`, `processo.sem_movimentacao`, `processo.novo_detectado` (callback), `processo.encerrado`, `calculo.gerado`, `parecer.gerado`, `recuperacao.registrada`.
- **Notificações**: movimentação relevante e fase lenta → advogado responsável; novo processo detectado → gestores + jurídico; prazo a vencer (D-3 e D-1) → responsável.
- **Tools**: `juridico.processos_empresa` (read), `juridico.resumo_carteira` (read), `juridico.atualizar_processo` (mutates), `juridico.gerar_calculo` (mutates), `juridico.gerar_parecer` (mutates).

## 10. Entregáveis

**Worker**: `juridico/descobrir-processos` (por nossos CNPJs, sob demanda + agendado), `juridico/sincronizar` (nos dias configurados), `juridico/processar-callback`, `juridico/classificar-fases`, `juridico/alertas` (diário: lentidão, parados, prazos).
**Core**: cliente Escavador (throttle 500/min, paginação por cursor, contabilização de créditos), classificador de fases, motor de cálculo de dívida — todos com testes.
**Env**: `ESCAVADOR_TOKEN`, `ESCAVADOR_CALLBACK_TOKEN`.
**Docs**: README — como cadastrar a URL de callback no painel do Escavador, custo por tipo de chamada, como ajustar benchmarks e índices, limites do parecer de IA.

## 11. Fora de escopo (Prompt 07 e além)

Cobrança extrajudicial (notificação, protesto, acordo pré-judicial), peticionamento, download de autos, monitoramento de diários oficiais, processos onde não somos parte (esse é o dado de risco do Radar, não este módulo).
