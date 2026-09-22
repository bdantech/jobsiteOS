-- 0233 — Pré-autorizações e parcelas do Sienge entram no funil (04s)
--
-- ─── O PRINCÍPIO INEGOCIÁVEL ────────────────────────────────────────────────
--
-- AS LISTAS NÃO SE MISTURAM NO BANCO — SÓ NA TELA.
--
-- Três tabelas independentes, cada uma espelhando fielmente a sua fonte:
-- `notas_fiscais` (que NÃO MUDA nesta migração, nem numa coluna), mais as duas
-- novas. A união acontece só na camada de leitura, numa projeção que não guarda
-- nada e que ninguém escreve.
--
-- A projeção precisa existir NO BANCO, e isso não é "misturar": o funil pagina,
-- ordena e filtra a lista inteira. Sem `union all` no nível da query seria preciso
-- puxar tudo das três fontes e ordenar em memória a cada abertura — a paginação
-- por OFFSET deixa de ser possível e a tela passa a baixar milhares de linhas para
-- pintar quarenta.
--
-- ─── POR QUE AS TABELAS NOVAS TÊM AS COLUNAS DE TRABALHO DA NF ──────────────
--
-- `faixa`, `estagio_funil`, `vendedor_id`, `receita_esperada`, `tac_estimada`, o
-- limite do sacado: o Prompt lista tudo isso como campo DERIVADO da projeção, e a
-- tentação é calculá-lo na view. Não dá — e a razão não é performance.
--
-- Estágio e dono são ESTADO HUMANO: alguém moveu o card, alguém assumiu o item. A
-- faixa é gravada pelo motor de reclassificação, que precisa comparar com a faixa
-- de ontem para saber se houve transição (é dessa comparação que sai o push "nova
-- oportunidade em faixa alta"). Uma view recalcula do zero a cada leitura e não tem
-- ontem. Por isso as colunas moram nas tabelas, exatamente como em `notas_fiscais`,
-- e a projeção só as expõe.
--
-- O card serve os três tipos porque o CONTRATO é o mesmo, e o contrato é o mesmo
-- porque as colunas são as mesmas. Era isso ou três cards.

-- ─── 1. A matriz de um CNPJ ─────────────────────────────────────────────────
--
-- Regra do sistema (§4.1): crédito, limite, carteira, roteamento, grupo econômico e
-- certificados são SEMPRE amarrados na MATRIZ. A SPE ou filial é detalhe da
-- operação, nunca a entidade que carrega a relação — uma construtora com trinta
-- SPEs teria trinta limites separados, cada um com um pedaço do risco e nenhum
-- deles descrevendo a empresa que de fato paga.
--
-- A pré-autorização traz as duas pontas e não precisa desta função. A NF traz só o
-- CNPJ escrito no documento, e é aqui que ela vira matriz — pela RAIZ (os 8
-- primeiros dígitos), que é o que a Receita usa para dizer "mesma pessoa jurídica".
--
-- Devolve o próprio CNPJ quando não há matriz conhecida. É o certo: sem informação,
-- a empresa é a matriz dela mesma, e inventar um CNPJ que não vimos seria pior que
-- não resolver nada.
create or replace function public.app__matriz_do_cnpj(p_cnpj text)
returns text
language sql
stable
set search_path to ''
as $$
  select case
    -- Filial `0001` já É a matriz. O atalho evita a busca em 99% dos casos.
    when p_cnpj is null or substr(p_cnpj, 9, 4) = '0001' then p_cnpj
    else coalesce(
      (select u.cnpj
         from public.mercado_universo u
        where left(u.cnpj, 8) = left(p_cnpj, 8)
          and substr(u.cnpj, 9, 4) = '0001'
        limit 1),
      p_cnpj)
  end
$$;

comment on function public.app__matriz_do_cnpj(text) is
  'A matriz do CNPJ pela raiz (8 primeiros dígitos). Devolve o próprio CNPJ quando '
  'a matriz não está no universo — sem informação, a empresa é a matriz dela mesma.';

grant execute on function public.app__matriz_do_cnpj(text) to authenticated;

-- O índice que torna a busca acima barata: só as MATRIZES, que são uma fração da
-- tabela. Um índice sobre `left(cnpj,8)` inteiro teria o tamanho do universo para
-- responder uma pergunta que só olha as filiais 0001.
create index if not exists mercado_universo_matriz_raiz_idx
  on public.mercado_universo (left(cnpj, 8))
  where substr(cnpj, 9, 4) = '0001';

-- ─── 2. Pré-autorizações ────────────────────────────────────────────────────
--
-- `status = WAITING_CONTRACTED` é o sinal mais quente do sistema inteiro: a
-- construtora já ofereceu, o crédito já existe, o dinheiro já está reservado, e o
-- fornecedor só não clicou. Não há nada a convencer — há alguém a lembrar. E tem
-- RELÓGIO (`expira_em`), que é o que separa este card de todos os outros: uma NF
-- que ninguém tocou hoje continua lá amanhã; uma oferta, não.
create table public.pre_autorizacoes (
  id_externo    integer primary key,

  status            text not null,
  status_anterior   text,
  origin            text not null,
  migrated          boolean,
  identification    text,

  criada_em      timestamptz,
  expira_em      timestamptz,
  solicitada_em  timestamptz,

  valor          numeric(14,2) not null,
  invoice_number text,
  -- O MESMO normalizador do 04e (zeros à esquerda e série ignorados; zeros à
  -- direita nunca). É por esta coluna que a oferta encontra a NF dela.
  numero_normalizado text,
  vencimento     date,

  -- As DUAS pontas do sacado. `sacado_cnpj` pode ser filial ou SPE; a matriz é o
  -- que vale para crédito, carteira e grupo econômico.
  sacado_cnpj        text not null check (sacado_cnpj ~ '^[0-9]{14}$'),
  sacado_matriz_cnpj text not null check (sacado_matriz_cnpj ~ '^[0-9]{14}$'),
  sacado_nome        text,
  sacado_empresa_id  uuid references public.empresas(id) on delete set null,

  fornecedor_cnpj       text not null check (fornecedor_cnpj ~ '^[0-9]{14}$'),
  fornecedor_nome       text,
  -- false = o fornecedor não tem cadastro, e o nome vem nulo. Não é buraco no
  -- payload: é a oportunidade de AQUISIÇÃO mais qualificada que existe.
  fornecedor_cadastrado boolean,
  fornecedor_empresa_id uuid references public.empresas(id) on delete set null,

  anticipation_id_externo integer,
  revoked_reason          text,

  sienge_bill_id            integer,
  sienge_installment_id     integer,
  sienge_installment_number integer,
  sienge_document_number    text,

  -- ── Deduplicação (§5) ──
  origem_exibida boolean not null default true,
  original_tipo  text check (original_tipo is null or original_tipo in ('nf', 'titulo')),
  original_id    text,

  -- ── As colunas de trabalho, idênticas às da NF ──
  faixa               text check (faixa is null or faixa in ('alta', 'boa', 'media')),
  faixa_motivo        text,
  faixa_regra_versao  integer,
  faixa_alterada_em   timestamptz,
  estagio_funil       text not null default 'a_prospectar'
    check (estagio_funil in ('a_prospectar', 'em_prospeccao', 'em_negociacao',
                             'antecipacao_andamento', 'convertida', 'perdida', 'expirada')),
  estagio_alterado_em timestamptz,
  perda_motivo        text,
  receita_esperada    numeric(14,2),
  taxa_usada          numeric(8,4),
  tac_estimada        numeric(14,2),
  seguro_estimado     numeric(14,2),
  dias_para_vencimento integer,
  credit_status            text,
  limite_disponivel_sacado numeric(14,2),
  limite_sacado_origem     text check (limite_sacado_origem is null
                                       or limite_sacado_origem in ('sacado', 'holding')),
  taxa_analise_am     numeric(8,4),
  taxa_analise_origem text check (taxa_analise_origem is null
                                  or taxa_analise_origem in ('sacado', 'holding')),
  vendedor_id         uuid references public.vendedores(id) on delete set null,
  vendedor_origem     text check (vendedor_origem is null
                                  or vendedor_origem in ('carteira', 'territorio', 'manual')),
  vendedor_definido_em timestamptz,

  raw            jsonb,
  sincronizada_em timestamptz not null default now()
);

create index pre_autorizacoes_status_expira_idx on public.pre_autorizacoes (status, expira_em);
create index pre_autorizacoes_partes_idx on public.pre_autorizacoes (fornecedor_cnpj, sacado_cnpj);
-- O casamento com a NF (§5) percorre exatamente esta tripla.
create index pre_autorizacoes_casamento_idx
  on public.pre_autorizacoes (sacado_matriz_cnpj, fornecedor_cnpj, numero_normalizado)
  where numero_normalizado is not null;
create index pre_autorizacoes_sienge_idx on public.pre_autorizacoes (sienge_bill_id, sienge_installment_id)
  where sienge_bill_id is not null;
create index pre_autorizacoes_vendedor_idx on public.pre_autorizacoes (vendedor_id);
create index pre_autorizacoes_funil_idx on public.pre_autorizacoes (estagio_funil, faixa);

comment on column public.pre_autorizacoes.sacado_matriz_cnpj is
  'A MATRIZ (contractor.headquartersTaxId). É ela que carrega crédito, carteira, '
  'roteamento e grupo econômico; `sacado_cnpj` (filial ou SPE) é detalhe da operação.';
comment on column public.pre_autorizacoes.origem_exibida is
  'false = escondida porque o documento ORIGINAL (NF ou título) já está no funil. '
  'Nada é apagado: a ocultação é reversível e auditável.';

-- ─── 3. Títulos Sienge ──────────────────────────────────────────────────────
--
-- Uma linha por PARCELA. As armadilhas do §2.2 estão codificadas aqui, e cada
-- uma delas é um jeito silencioso de errar:
--
--   `primeira_vez_visto` é a data de ENTRADA. `hidratado_em` muda a cada releitura
--   e NÃO serve como filtro de novidade — usá-lo faria a janela curta trazer
--   eternamente as mesmas parcelas, cada leitura reempurrando a data para frente.
--
--   `retencao` é TRI-ESTADO: 0 é "sem retenção", um valor é a retenção lida e NULL
--   é "o ERP não informou". Por isso a coluna é anulável e NÃO tem default 0 —
--   um default aqui transformaria "não sei" em "não tem" para sempre.
--
--   `bill_id` SÓ é único dentro de uma conexão. A PK é o `id` da API, que é global.
create table public.sienge_titulos (
  id_externo integer primary key,

  situation           text not null,
  situation_anterior  text,
  guard_reason        text,
  exception_code      text,

  primeira_vez_visto timestamptz,
  hidratado_em       timestamptz,

  installment_id     integer,
  installment_number integer,
  valor              numeric(14,2) not null,
  -- TRI-ESTADO. Nunca receba default: null ≠ 0.
  retencao           numeric(14,2),
  vencimento         date,

  erp_situacao    text,
  enviado_banco   boolean,
  tipo_pagamento  text,
  erp_pago_em     timestamptz,
  erp_removido_em timestamptz,

  nfe_candidate_access_key text,
  nfe_candidate_count      integer,
  write_back_status        text,
  write_back_repointed_em  timestamptz,

  bill_id              integer not null,
  bill_document_number text,
  bill_document_type   text,
  bill_origin          text,
  bill_status          text,
  bill_access_key      text,
  bill_issue_date      date,
  bill_total           numeric(14,2),
  bill_retencao_total  numeric(14,2),

  connection_id        integer,
  connection_subdomain text,

  -- O `contractor` do título é a construtora DONA DA CONEXÃO — a matriz. O payload
  -- não informa a SPE da parcela, mesmo quando o empreendimento é de uma, e por
  -- isso as duas colunas nascem iguais. `sacado_cnpj` pode ficar mais específico
  -- depois, quando a parcela virar oferta e a pré-autorização revelar a SPE.
  sacado_cnpj        text not null check (sacado_cnpj ~ '^[0-9]{14}$'),
  sacado_matriz_cnpj text not null check (sacado_matriz_cnpj ~ '^[0-9]{14}$'),
  sacado_nome        text,
  sacado_empresa_id  uuid references public.empresas(id) on delete set null,

  -- `credor_cnpj` NULO é credor pessoa física: não casa com `empresas`, fica fora
  -- do roteamento e fora do agrupamento por fornecedor. Juntá-los sob "sem CNPJ"
  -- criaria um fornecedor fictício com o volume somado de centenas de pessoas.
  credor_cnpj           text check (credor_cnpj is null or credor_cnpj ~ '^[0-9]{14}$'),
  credor_nome           text,
  credor_erp_id         integer,
  credor_pessoa_fisica  boolean not null default false,
  credor_empresa_id     uuid references public.empresas(id) on delete set null,
  credor_cadastrado     boolean,

  pre_autorizacao_id_externo integer,
  anticipation_id_externo    integer,
  anticipation_status        text,
  anticipation_net           numeric(14,2),

  numero_normalizado text,

  origem_exibida boolean not null default true,
  original_tipo  text check (original_tipo is null or original_tipo in ('nf', 'pre_autorizacao')),
  original_id    text,

  faixa               text check (faixa is null or faixa in ('alta', 'boa', 'media')),
  faixa_motivo        text,
  faixa_regra_versao  integer,
  faixa_alterada_em   timestamptz,
  estagio_funil       text not null default 'a_prospectar'
    check (estagio_funil in ('a_prospectar', 'em_prospeccao', 'em_negociacao',
                             'antecipacao_andamento', 'convertida', 'perdida', 'expirada')),
  estagio_alterado_em timestamptz,
  perda_motivo        text,
  receita_esperada    numeric(14,2),
  taxa_usada          numeric(8,4),
  tac_estimada        numeric(14,2),
  seguro_estimado     numeric(14,2),
  dias_para_vencimento integer,
  credit_status            text,
  limite_disponivel_sacado numeric(14,2),
  limite_sacado_origem     text check (limite_sacado_origem is null
                                       or limite_sacado_origem in ('sacado', 'holding')),
  taxa_analise_am     numeric(8,4),
  taxa_analise_origem text check (taxa_analise_origem is null
                                  or taxa_analise_origem in ('sacado', 'holding')),
  vendedor_id         uuid references public.vendedores(id) on delete set null,
  vendedor_origem     text check (vendedor_origem is null
                                  or vendedor_origem in ('carteira', 'territorio', 'manual')),
  vendedor_definido_em timestamptz,

  raw             jsonb,
  sincronizado_em timestamptz not null default now()
);

create index sienge_titulos_situacao_venc_idx on public.sienge_titulos (situation, vencimento);
-- `sacado_cnpj` JUNTO do bill_id, nunca o bill_id sozinho: ele só é único dentro
-- de uma conexão, e a consulta que o usa sozinho mistura dois clientes.
create index sienge_titulos_sacado_bill_idx on public.sienge_titulos (sacado_cnpj, bill_id);
create index sienge_titulos_bill_chave_idx on public.sienge_titulos (bill_access_key)
  where bill_access_key is not null;
create index sienge_titulos_nfe_candidate_idx on public.sienge_titulos (nfe_candidate_access_key)
  where nfe_candidate_access_key is not null;
create index sienge_titulos_parcela_idx on public.sienge_titulos (bill_id, installment_id);
create index sienge_titulos_preauth_idx on public.sienge_titulos (pre_autorizacao_id_externo)
  where pre_autorizacao_id_externo is not null;
create index sienge_titulos_vendedor_idx on public.sienge_titulos (vendedor_id);
create index sienge_titulos_funil_idx on public.sienge_titulos (estagio_funil, faixa);
create index sienge_titulos_conexao_bill_idx on public.sienge_titulos (connection_id, bill_id);

comment on column public.sienge_titulos.retencao is
  'TRI-ESTADO: 0 = sem retenção, valor = retenção lida, NULL = o ERP não informou. '
  'Nunca tratar NULL como zero — nem em soma, nem em exibição.';
comment on column public.sienge_titulos.primeira_vez_visto is
  'A data de ENTRADA (firstSeenAt). `hidratado_em` muda a cada releitura e NÃO '
  'serve como data de entrada nem como filtro de novidade.';
comment on column public.sienge_titulos.bill_id is
  'Só é único DENTRO de uma conexão. Nunca usar sozinho como chave — sempre com '
  'connection_id / sacado_cnpj.';

-- ─── 4. O livro das ocultações ──────────────────────────────────────────────
--
-- `notas_fiscais` NÃO ganha coluna nenhuma (§1), então a marca de "escondida por
-- dedup" mora aqui, numa tabela lateral que serve aos três tipos.
--
-- NADA É APAGADO. Ocultar é uma decisão da regra, e regra erra: o registro guarda
-- o motivo e o original, de modo que "por que este card sumiu?" tem resposta, e
-- reverter é apagar uma linha.
create table public.funil_ocultacoes (
  tipo          text not null check (tipo in ('nf', 'pre_autorizacao', 'titulo')),
  referencia_id text not null,
  motivo        text not null check (motivo in ('tem_original', 'duplicado_canal')),
  original_tipo text check (original_tipo is null or original_tipo in ('nf', 'pre_autorizacao', 'titulo')),
  original_id   text,
  criado_em     timestamptz not null default now(),
  primary key (tipo, referencia_id)
);

create index funil_ocultacoes_original_idx on public.funil_ocultacoes (original_tipo, original_id);

comment on table public.funil_ocultacoes is
  'Quem está escondido do funil por deduplicação (04s §5), e atrás de quem. '
  'Tabela lateral de propósito: o funil de NFs não pode ganhar coluna nova.';

-- ─── 5. O selo "já tem pré-autorização" ─────────────────────────────────────
--
-- Vive separado da ocultação porque responde outra pergunta. A ocultação diz "não
-- mostre este card"; o selo diz "mostre AQUELE card com este aviso". Uma NF com
-- oferta pendurada não está escondida — ela é o card mais quente da coluna.
create table public.funil_selos_preauth (
  tipo          text not null check (tipo in ('nf', 'pre_autorizacao', 'titulo')),
  referencia_id text not null,
  pre_autorizacao_id integer not null,
  status        text not null,
  criada_em     timestamptz,
  atualizado_em timestamptz not null default now(),
  primary key (tipo, referencia_id, pre_autorizacao_id)
);

-- ─── 6. RLS — as MESMAS regras que valem para a NF, sem exceção ─────────────
--
-- A política abaixo é uma CÓPIA LITERAL de `notas_fiscais_select`, lida do banco
-- vivo nesta migração e não reescrita de memória. Escrevê-la "equivalente" é como
-- um originador passa a ver a carteira de outro: as duas versões concordam em
-- todos os casos que alguém pensou em testar, e divergem no caso que ninguém
-- pensou.
--
-- Só SELECT, como na NF: quem escreve nestas tabelas é o worker, pela
-- service-role, que não passa por RLS.
alter table public.pre_autorizacoes enable row level security;
alter table public.sienge_titulos enable row level security;
alter table public.funil_ocultacoes enable row level security;
alter table public.funil_selos_preauth enable row level security;

create policy pre_autorizacoes_select on public.pre_autorizacoes
  for select using (
    (select public.app_tem_modulo('antecipacao'))
    and (
      (select public.app_gestor_comercial())
      or vendedor_id = any (coalesce((select public.app_vendedores_visiveis()), '{}'::uuid[]))
      or fornecedor_empresa_id = any (coalesce((select public.app_carteira_empresas()), '{}'::uuid[]))
      or sacado_empresa_id = any (coalesce((select public.app_carteira_empresas()), '{}'::uuid[]))
    )
  );

-- No título o papel de "fornecedor" é o CREDOR — é com ele que se fala sobre
-- antecipar a parcela. A forma da política é a mesma; só o nome da coluna muda.
create policy sienge_titulos_select on public.sienge_titulos
  for select using (
    (select public.app_tem_modulo('antecipacao'))
    and (
      (select public.app_gestor_comercial())
      or vendedor_id = any (coalesce((select public.app_vendedores_visiveis()), '{}'::uuid[]))
      or credor_empresa_id = any (coalesce((select public.app_carteira_empresas()), '{}'::uuid[]))
      or sacado_empresa_id = any (coalesce((select public.app_carteira_empresas()), '{}'::uuid[]))
    )
  );

-- As duas tabelas de apoio não carregam valor nem contraparte: são ponteiros. O
-- recorte por vendedor acontece nas tabelas que elas apontam, e repeti-lo aqui
-- obrigaria a um join na política — que roda por LINHA, em toda leitura do funil.
create policy funil_ocultacoes_select on public.funil_ocultacoes
  for select using ((select public.app_tem_modulo('antecipacao')));

create policy funil_selos_preauth_select on public.funil_selos_preauth
  for select using ((select public.app_tem_modulo('antecipacao')));

-- ─── 7. A projeção unificada ────────────────────────────────────────────────
--
-- `security_invoker = true` NÃO É DETALHE. Uma view executa com os privilégios de
-- quem a criou e, por padrão, IGNORA o RLS das tabelas de base — o originador A
-- passaria a enxergar as oportunidades do originador B através da projeção, com as
-- políticas das tabelas perfeitamente corretas. Já aconteceu nesta casa com
-- `notas_funil`, e é por isso que a opção é reafirmada em toda migração que mexe
-- numa view do funil.
--
-- O ramo da NF lê `notas_funil`, e não `notas_fiscais`: assim o contrato da NF
-- continua definido num lugar só. Se amanhã a tipagem do fornecedor ou o cálculo
-- do líquido mudarem lá, os três tipos mudam juntos — que é a promessa do card
-- único.
create view public.funil_oportunidades
with (security_invoker = true)
as
with parcelas_do_bill as (
  -- Quantas parcelas tem o título desta parcela — o "N de M" do card. Por
  -- (connection_id, bill_id) e nunca por bill_id sozinho.
  select connection_id, bill_id, count(*)::int as total
    from public.sienge_titulos
   group by connection_id, bill_id
)
-- ── NF ──
select
  'nf'::text                             as tipo,
  nf.access_key                          as id,
  nf.access_key,
  nf.fornecedor_cnpj,
  nf.fornecedor_nome,
  nf.fornecedor_empresa_id,
  nf.fornecedor_cadastrado,
  nf.fornecedor_tipagem,
  nf.fornecedor_tem_protesto,
  nf.fornecedor_suprimido,
  nf.fornecedor_sem_interesse,
  nf.fornecedor_uf,
  false                                  as credor_pessoa_fisica,
  nf.sacado_cnpj,
  nf.sacado_nome,
  public.app__matriz_do_cnpj(nf.sacado_cnpj) as sacado_matriz_cnpj,
  nf.sacado_empresa_id,
  nf.sacado_cadastrado,
  nf.valor,
  nf.vencimento,
  nf.emitida_em                          as data_base,
  nf.numero || coalesce('/' || nf.serie, '') as numero_exibicao,
  nf.status_sync                         as estado_origem,
  null::timestamptz                      as relogio,
  nf.dias_para_vencimento,
  nf.sacado_credito_status,
  nf.sacado_limite_disponivel,
  nf.sacado_limite_cobre_nota            as sacado_limite_cobre_valor,
  nf.receita_esperada,
  nf.taxa_usada,
  nf.tac_estimada,
  nf.seguro_estimado,
  nf.liquido_estimado,
  nf.faixa,
  nf.faixa_motivo,
  nf.estagio_funil,
  nf.estagio_alterado_em,
  nf.perda_motivo,
  nf.vendedor_id,
  nf.vendedor_origem,
  nf.operavel,
  -- A ÚNICA linha que varia por tipo, no mesmo lugar do card (§8).
  'nº ' || coalesce(nf.numero, '—') || coalesce('/' || nf.serie, '') as linha_contexto,
  selo.pre_autorizacao_id,
  selo.status                            as pre_autorizacao_status,
  selo.criada_em                         as pre_autorizacao_em,
  nf.conversao_antecipacao_id,
  nf.conversao_em_disputa
from public.notas_funil nf
left join public.funil_selos_preauth selo
       on selo.tipo = 'nf' and selo.referencia_id = nf.access_key
where not exists (
  select 1 from public.funil_ocultacoes o
   where o.tipo = 'nf' and o.referencia_id = nf.access_key
)

union all

-- ── Pré-autorização ──
select
  'pre_autorizacao'::text,
  pa.id_externo::text,
  null::text,
  pa.fornecedor_cnpj,
  -- "Sem cadastro" é informação, não buraco: é o card de AQUISIÇÃO.
  coalesce(pa.fornecedor_nome, 'Sem cadastro'),
  pa.fornecedor_empresa_id,
  coalesce(pa.fornecedor_cadastrado, false),
  case
    when not coalesce(pa.fornecedor_cadastrado, false) then 'aquisicao'
    when fco.last_anticipation is not null or fe.ultima_antecipacao is not null then 'recorrencia'
    else 'ativacao'
  end,
  coalesce(fpa.tem_protesto, false),
  fsup.valor is not null,
  fsi.cnpj is not null,
  coalesce(fe.uf, fu.uf),
  false,
  pa.sacado_cnpj,
  pa.sacado_nome,
  pa.sacado_matriz_cnpj,
  pa.sacado_empresa_id,
  se.id is not null,
  pa.valor,
  pa.vencimento,
  pa.criada_em,
  coalesce(pa.invoice_number, pa.sienge_document_number, pa.identification),
  pa.status,
  pa.expira_em,
  -- Calculado AO VIVO, como na NF: o que envelhece não é o registro, é o
  -- calendário. A coluna gravada existe só para o motor de faixa ver a transição.
  (pa.vencimento - current_date)::int,
  pa.credit_status,
  pa.limite_disponivel_sacado,
  pa.limite_disponivel_sacado >= pa.valor,
  pa.receita_esperada,
  pa.taxa_usada,
  pa.tac_estimada,
  pa.seguro_estimado,
  greatest(0::numeric, pa.valor - coalesce(pa.receita_esperada, 0) - coalesce(pa.tac_estimada, 0)
                                - coalesce(pa.seguro_estimado, 0)),
  pa.faixa,
  pa.faixa_motivo,
  pa.estagio_funil,
  pa.estagio_alterado_em,
  pa.perda_motivo,
  pa.vendedor_id,
  pa.vendedor_origem,
  true,
  -- O RELÓGIO em palavras. É o que a pré-autorização tem e os outros dois não.
  case
    when pa.expira_em is null then 'origem ' || pa.origin
    when pa.expira_em < now() then 'expirou em ' || to_char(pa.expira_em, 'DD/MM')
    else 'expira em ' || greatest(0, (pa.expira_em::date - current_date))::text || ' dias'
  end || ' · ' || pa.origin,
  pa.id_externo,
  pa.status,
  pa.criada_em,
  pa.anticipation_id_externo,
  false
from public.pre_autorizacoes pa
left join public.empresas fe on fe.id = pa.fornecedor_empresa_id
left join public.empresas se on se.id = pa.sacado_empresa_id
left join public.mercado_universo fu on fu.cnpj = pa.fornecedor_cnpj
left join public.protestos_atual fpa on fpa.cnpj = pa.fornecedor_cnpj
left join public.clientes_onepay fco on fco.cnpj = pa.fornecedor_cnpj
left join public.supressao fsup
       on fsup.escopo = 'empresa' and fsup.valor = pa.fornecedor_cnpj
      and (fsup.expira_em is null or fsup.expira_em >= current_date)
left join public.antecipacao_fornecedor_sem_interesse fsi on fsi.cnpj = pa.fornecedor_cnpj
where pa.origem_exibida
  and not exists (
    select 1 from public.funil_ocultacoes o
     where o.tipo = 'pre_autorizacao' and o.referencia_id = pa.id_externo::text
  )

union all

-- ── Título Sienge ──
select
  'titulo'::text,
  st.id_externo::text,
  -- A chave de acesso do título é a da NF que ele representa. Ela abre o mesmo
  -- documento no modal quando existe — e vem nula quando o ERP não a informou.
  coalesce(st.bill_access_key, st.nfe_candidate_access_key),
  st.credor_cnpj,
  coalesce(st.credor_nome, case when st.credor_pessoa_fisica then 'Credor PF' else 'Sem cadastro' end),
  st.credor_empresa_id,
  coalesce(st.credor_cadastrado, false),
  case
    when st.credor_pessoa_fisica then null
    when not coalesce(st.credor_cadastrado, false) then 'aquisicao'
    when cco.last_anticipation is not null or ce.ultima_antecipacao is not null then 'recorrencia'
    else 'ativacao'
  end,
  coalesce(cpa.tem_protesto, false),
  csup.valor is not null,
  csi.cnpj is not null,
  coalesce(ce.uf, cu.uf),
  st.credor_pessoa_fisica,
  st.sacado_cnpj,
  st.sacado_nome,
  st.sacado_matriz_cnpj,
  st.sacado_empresa_id,
  sse.id is not null,
  st.valor,
  st.vencimento,
  st.primeira_vez_visto,
  coalesce(st.bill_document_number, st.bill_id::text)
    || coalesce(', parcela ' || st.installment_number::text
                || coalesce('/' || pb.total::text, ''), ''),
  st.situation,
  null::timestamptz,
  (st.vencimento - current_date)::int,
  st.credit_status,
  st.limite_disponivel_sacado,
  st.limite_disponivel_sacado >= st.valor,
  st.receita_esperada,
  st.taxa_usada,
  st.tac_estimada,
  st.seguro_estimado,
  greatest(0::numeric, st.valor - coalesce(st.receita_esperada, 0) - coalesce(st.tac_estimada, 0)
                                - coalesce(st.seguro_estimado, 0)),
  st.faixa,
  st.faixa_motivo,
  st.estagio_funil,
  st.estagio_alterado_em,
  st.perda_motivo,
  st.vendedor_id,
  st.vendedor_origem,
  true,
  coalesce(st.bill_document_number, 'doc ' || st.bill_id::text)
    || coalesce(' · parcela ' || st.installment_number::text
                || coalesce('/' || pb.total::text, ''), '')
    || ' · ' || st.situation
    || coalesce(' · ' || st.guard_reason, ''),
  selo2.pre_autorizacao_id,
  selo2.status,
  selo2.criada_em,
  st.anticipation_id_externo,
  false
from public.sienge_titulos st
left join parcelas_do_bill pb
       on pb.bill_id = st.bill_id and pb.connection_id is not distinct from st.connection_id
left join public.empresas ce on ce.id = st.credor_empresa_id
left join public.empresas sse on sse.id = st.sacado_empresa_id
left join public.mercado_universo cu on cu.cnpj = st.credor_cnpj
left join public.protestos_atual cpa on cpa.cnpj = st.credor_cnpj
left join public.clientes_onepay cco on cco.cnpj = st.credor_cnpj
left join public.supressao csup
       on csup.escopo = 'empresa' and csup.valor = st.credor_cnpj
      and (csup.expira_em is null or csup.expira_em >= current_date)
left join public.antecipacao_fornecedor_sem_interesse csi on csi.cnpj = st.credor_cnpj
left join public.funil_selos_preauth selo2
       on selo2.tipo = 'titulo' and selo2.referencia_id = st.id_externo::text
where st.origem_exibida
  and not exists (
    select 1 from public.funil_ocultacoes o
     where o.tipo = 'titulo' and o.referencia_id = st.id_externo::text
  );

comment on view public.funil_oportunidades is
  'A projeção do funil (04s §6): NFs, pré-autorizações e parcelas do Sienge sob o '
  'MESMO contrato de card. Somente leitura, não guarda nada, ninguém escreve nela. '
  'security_invoker = true — sem isso a view ignoraria a RLS das tabelas de base.';

grant select on public.funil_oportunidades to authenticated;

-- ─── 8. Config ──────────────────────────────────────────────────────────────
--
-- Em `antecipacao_config`, e não numa tabela nova: é a mesma tela de configurações
-- do mesmo módulo, com o mesmo par chave/valor e a mesma RPC de escrita. Uma
-- segunda tabela de config no mesmo módulo é uma segunda tela mais tarde.
insert into public.antecipacao_config (chave, valor)
values (
  'funil_oportunidades',
  jsonb_build_object(
    -- A PARCELA vence a NF por default: é ela que vira oferta e é antecipada. Uma
    -- nota de R$ 55 mil com três parcelas, exibida inteira, esconde que só uma
    -- está disponível agora — e o originador liga oferecendo um valor que não existe.
    'prioridade_nf_vs_titulo', 'titulo',
    'recuperacao_dias', 15,
    'guard_reasons_recuperaveis', jsonb_build_array('SUPPLIER_CNPJ_MISSING', 'SUPPLIER_NOT_REGISTERED'),
    'aviso_expiracao_dias', 2,
    'janela_novidade_dias', 7,
    'janela_estado_dias', 92,
    'page_size', 200
  )
)
on conflict (chave) do nothing;

-- ─── 9. As duas ingestões novas ─────────────────────────────────────────────
--
-- Mesma política de retry e alerta dos outros syncs. O CHECK é recriado a partir
-- do que está NO BANCO HOJE mais os dois valores novos — reconstruí-lo da lista da
-- migração original apagaria o que migrações posteriores acrescentaram.
alter table public.mercado_ingestoes drop constraint if exists mercado_ingestoes_fonte_check;
alter table public.mercado_ingestoes add constraint mercado_ingestoes_fonte_check
  check (fonte in ('receita_cnpj', 'cno', 'lista', 'onepay_nf', 'onepay_certificados',
                   'onepay_antecipacoes', 'onepay_credit_analyses',
                   'onepay_pre_autorizacoes', 'onepay_sienge_titulos'));
