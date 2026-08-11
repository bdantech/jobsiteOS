-- =============================================================================
-- 0102 — Duas correções de recorte, uma em cada ponta do funil.
--
-- §1  "Fornecedores a prospectar" passa a exigir CRÉDITO APROVADO no sacado.
-- §2  A lista de clientes Onepay ganha protesto do grupo, faturamento e gestão.
-- =============================================================================


-- ─── §1  O sacado precisa ter crédito aprovado ──────────────────────────────
--
-- A 0101 usou `sacado_cadastrado` como qualificador do lead. ESTAVA FRACO, e a
-- base mostra o tamanho do erro: na janela de 90 dias, dos sacados cadastrados,
--
--     cadastrado + APPROVED         5.199 notas    56 sacados
--     cadastrado + SEM ANÁLISE     12.069 notas   172 sacados   <- 70% da lista
--
-- Ou seja: sete de cada dez linhas eram fornecedores emitindo contra empresas que
-- estão na plataforma mas não têm limite aprovado. Para essas não existe operação
-- para oferecer — o lead não é lead, é ruído com cara de lead.
--
-- HOLDING OU SPE. A aprovação nem sempre está no CNPJ que aparece na nota: em 18
-- dos 78 sacados que entram, o crédito foi aprovado noutro CNPJ do MESMO GRUPO
-- (é a holding cliente cuja SPE emite/recebe, o caso que a 0097 já modelou).
-- Exigir aprovação no CNPJ da nota descartaria esses 18 em silêncio.
--
-- POR QUE `mercado_universo` E NÃO `empresas` para achar o grupo: a policy de
-- `mercado_universo` (0060) libera para quem tem `antecipacao` as linhas cujo CNPJ
-- aparece numa nota que a pessoa pode ler — e tanto o sacado aprovado quanto a SPE
-- aparecem. Passar por `empresas` exigiria o módulo `empresas`, que o perfil
-- Comercial tem hoje mas não é garantido — e o custo de errar aqui é a tela vir
-- vazia sem dizer por quê, que é exatamente o buraco que a 0060 tapou.

create view public.antecipacao_sacados_com_credito
with (security_invoker = true) as
  with aprovados as (
    -- Por SACADO, não por nota. `credit_status` chega na nota, e a análise costuma
    -- chegar depois das primeiras: exigir o flag em cada linha faria o mesmo sacado
    -- ser aprovado numa nota e desconhecido na anterior.
    select nf.sacado_cnpj as cnpj
    from public.notas_fiscais nf
    group by nf.sacado_cnpj
    having bool_or(nf.credit_status = 'APPROVED')
  ),
  grupos as (
    select distinct u.grupo_id
    from public.mercado_universo u
      join aprovados a on a.cnpj = u.cnpj
    where u.grupo_id is not null
  )
  select t.cnpj, bool_or(t.proprio) as aprovacao_propria
  from (
    select a.cnpj, true as proprio from aprovados a
    union all
    select u.cnpj, false from public.mercado_universo u join grupos g on g.grupo_id = u.grupo_id
  ) t
  group by t.cnpj;

grant select on public.antecipacao_sacados_com_credito to authenticated;

comment on view public.antecipacao_sacados_com_credito is
  'CNPJs que podem sustentar uma operação: crédito aprovado no próprio CNPJ, ou '
  'noutro CNPJ do mesmo grupo (a holding cliente cuja SPE aparece na nota). É o '
  'qualificador de "fornecedores a prospectar" — sem limite aprovado do outro lado '
  'não há antecipação a oferecer.';

comment on column public.antecipacao_sacados_com_credito.aprovacao_propria is
  'true = o APPROVED está neste CNPJ. false = entrou pelo grupo (holding/SPE). São '
  '18 dos 78 sacados da janela, e descartá-los seria perder operação real.';


-- A lista refeita. Mesmas colunas de 0101 — o que muda é QUAIS notas entram, e o
-- `create or replace` mantém tipos e dependências.
--
-- `sacado_cadastrado` sai do WHERE: crédito aprovado é condição mais forte e o
-- torna redundante (e recuperar as 5 notas de sacado aprovado que vinham sem o
-- flag `cadastrado` é ganho, não perda).
--
-- O "não cadastrado" do FORNECEDOR sobe para um NOT EXISTS sobre todas as notas
-- dele, não só as que passaram no filtro: estar na plataforma é propriedade do
-- fornecedor, não de um subconjunto das suas notas. Na 0101 isso teria custado
-- 1,2s; com o recorte por crédito o conjunto caiu de 17.050 para 5.887 linhas e o
-- anti-join sai por 240ms.

create or replace view public.antecipacao_fornecedores_a_prospectar as
  select
    f.fornecedor_cnpj,
    max(coalesce(fu.razao_social, f.fornecedor_nome)) as fornecedor_nome,
    (array_agg(f.fornecedor_empresa_id) filter (where f.fornecedor_empresa_id is not null))[1]
      as fornecedor_empresa_id,
    max(f.fornecedor_uf) as fornecedor_uf,
    max(fu.municipio) as fornecedor_municipio,
    max(fu.cnae_principal) as fornecedor_cnae_principal,
    max(fu.situacao_cadastral) as fornecedor_situacao_cadastral,
    count(*)::int as notas,
    count(*) filter (where f.operavel)::int as notas_operaveis,
    count(distinct f.sacado_cnpj)::int as sacados,
    sum(f.valor) as valor_agregado,
    max(f.emitida_em) as ultima_nota_em,
    min(f.emitida_em) as primeira_nota_em
  from public.notas_funil f
    join public.antecipacao_sacados_com_credito cc on cc.cnpj = f.sacado_cnpj
    left join public.mercado_universo fu on fu.cnpj = f.fornecedor_cnpj
  where f.emitida_em >= (now() - interval '90 days')
    and not exists (
      select 1 from public.notas_fiscais n2
      where n2.fornecedor_cnpj = f.fornecedor_cnpj
        and n2.fornecedor_cadastrado
    )
  group by f.fornecedor_cnpj;

alter view public.antecipacao_fornecedores_a_prospectar set (security_invoker = on);

comment on view public.antecipacao_fornecedores_a_prospectar is
  'Fornecedores fora da plataforma que emitiram, nos últimos 90 dias, contra sacado '
  'COM CRÉDITO APROVADO (no próprio CNPJ ou no grupo), ranqueados por número de '
  'notas. Só essas notas contam: um fornecedor que emite 100 notas e 6 para sacado '
  'aprovado aparece com 6.';

comment on column public.antecipacao_fornecedores_a_prospectar.notas is
  'Notas para sacados com crédito aprovado nos últimos 90 dias — não o total emitido '
  'pelo fornecedor. É a ordenação padrão da lista.';


-- ─── §2  A lista de clientes Onepay ─────────────────────────────────────────
--
-- Três perguntas que hoje exigem sair da tela: quanto o GRUPO deve em protesto,
-- quanto a empresa fatura, e se a conta é prospecção ativa ou passiva.
--
-- PROTESTO DO GRUPO, e não do CNPJ: a holding costuma estar limpa enquanto a
-- dívida mora nas SPEs. Na base, 14 clientes têm protesto no próprio CNPJ e 15
-- quando se olha o grupo — e o agregado salta para R$ 80,1 mi. Um número por
-- CNPJ responderia a pergunta errada.
--
-- ACOPLAMENTO ASSUMIDO: `clientes_onepay` já exige o módulo `radar`, e quem tem
-- `radar` hoje tem `mercado` — então o join em `mercado_universo` (de onde saem as
-- SPEs do grupo) não estreita o público desta tela. Se um dia existir um perfil com
-- `radar` e sem `mercado`, o protesto do grupo encolhe para o do próprio CNPJ; a
-- coluna `protesto_grupo_cnpjs` é o que deixa isso visível em vez de silencioso.

create view public.clientes_onepay_lista
with (security_invoker = true) as
  select
    co.cnpj,
    co.onepay_company_id,
    co.empresa_id,
    co.nome,
    co.status,
    co.operation_status,
    co.credit_limit,
    co.available_limit,
    co.consumed_limit,
    co.consumed_pct,
    co.consumed_pct_2m,
    co.last_anticipation,
    co.days_without_anticipation,
    co.anticipations_last_2m,
    co.gross_value_last_2m,
    co.primeira_vez_visto,
    co.atualizado_em,

    e.faturamento_anual,
    e.faturamento_confianca,

    -- 'prospeccao_ativa' | 'passivo' | null. NULL é "não definido", e é a maioria
    -- (46 dos 50 clientes) — o filtro da tela precisa dizer isso, senão escolher
    -- "ativa" mostra 2 linhas e parece defeito.
    e.gestao_operacao,

    e.grupo_id,
    prot.valor as protesto_grupo_valor,
    prot.cnpjs as protesto_grupo_cnpjs
  from public.clientes_onepay co
    left join public.empresas e on e.id = co.empresa_id
    left join lateral (
      select
        coalesce(sum(pa.valor_total), 0) as valor,
        count(*) filter (where pa.tem_protesto)::int as cnpjs
      from (
        select co.cnpj as cnpj
        union
        select u.cnpj from public.mercado_universo u
        where e.grupo_id is not null and u.grupo_id = e.grupo_id
      ) membros
        join public.protestos_atual pa on pa.cnpj = membros.cnpj
    ) prot on true;

grant select on public.clientes_onepay_lista to authenticated;

comment on view public.clientes_onepay_lista is
  'A lista de clientes Onepay com o que a tela precisa e a tabela não tem: protesto '
  'somado no GRUPO (holding + SPEs), faturamento anual e se a conta é prospecção '
  'ativa ou passiva.';

comment on column public.clientes_onepay_lista.protesto_grupo_valor is
  'Protesto somado no grupo — o CNPJ do cliente mais as SPEs que compartilham '
  'grupo_id. A holding costuma estar limpa enquanto a dívida mora nas SPEs.';

comment on column public.clientes_onepay_lista.protesto_grupo_cnpjs is
  'Quantos CNPJs do grupo têm protesto. Existe para o valor não ser um número sem '
  'procedência: 0 aqui com valor alto seria contradição visível.';

comment on column public.clientes_onepay_lista.gestao_operacao is
  'prospeccao_ativa | passivo | NULL (não definido). NULL é a maioria hoje.';
