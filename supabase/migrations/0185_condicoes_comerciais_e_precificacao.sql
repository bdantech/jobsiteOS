-- ═════════════════════════════════════════════════════════════════════════════
-- 0185 — Motor de precificação e publicação das condições (Prompt 04o)
--
-- ─── O QUE MUDA DE NATUREZA AQUI ────────────────────────────────────────────
-- Até o 04n, o webhook de crédito era INFORMATIVO: contava o que tinha acontecido
-- na esteira. A partir desta migração ele passa a ser ACIONÁVEL — o bloco
-- `condicoes_comerciais.payload_producao` é repassado, sem transformação, para um
-- `POST /api/backoffice/credit-analyses` do lado da plataforma de produção.
--
-- A consequência prática: um payload malformado não é mais um relatório feio, é uma
-- análise de crédito que não nasce lá. Por isso a validação é local e acontece ANTES
-- de publicar — e por isso os CHECKs abaixo repetem, no banco, as regras que o core
-- já aplica. Duas cercas para a mesma coisa é deliberado: a de cima informa o
-- analista, a de baixo torna o erro inexprimível.
--
-- ─── D0 É O PRODUTO CARO ────────────────────────────────────────────────────
-- `monthly_rate_d0 > monthly_rate_d1` e `fee_d0 > fee_d1`, sempre. O exemplo do
-- contrato de produção está com os dois INVERTIDOS; o 04o §3 manda ignorar o exemplo
-- e seguir a regra. É ela que está no CHECK.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── §3 A matriz versionada ─────────────────────────────────────────────────
-- Mesmo padrão de `analise_parametros` (0122) e `scorecard_versoes` (0073): versão
-- nova a cada mudança, nunca update. Sem isso, a condição publicada há um ano deixa
-- de ser reproduzível no dia em que alguém mexer numa célula — e é justamente a
-- condição antiga que alguém vai querer explicar a um cliente.

create table if not exists public.precificacao_matriz (
  versao int primary key,
  -- Faixas globais (piso e teto de tudo), ajustes e as 25 células. A LÓGICA — como a
  -- célula vira condição, como o D1 é derivado do D0 — mora no core
  -- (packages/core/src/credito/precificacao.ts) e é fixa. Aqui só os números.
  definicao jsonb not null,
  ativa boolean not null default false,
  criada_por uuid references public.usuarios (id),
  criada_em timestamptz not null default now()
);

-- Uma só ativa. O índice parcial único torna "duas matrizes vigentes" inexprimível.
create unique index if not exists precificacao_matriz_uma_ativa_idx
  on public.precificacao_matriz ((ativa)) where ativa;

comment on table public.precificacao_matriz is
  'Matriz de precificação versionada (04o §3). A condição publicada grava a versão que '
  'a sugeriu, e é por ela que uma condição antiga continua explicável.';

-- ─── §2 As condições comerciais ─────────────────────────────────────────────

create table if not exists public.condicoes_comerciais (
  id uuid primary key default gen_random_uuid(),
  analise_credito_id uuid not null references public.analises_credito (id) on delete cascade,
  empresa_id uuid references public.empresas (id) on delete set null,
  cnpj text not null
    constraint condicoes_comerciais_cnpj_check check (cnpj ~ '^[0-9]{14}$'),

  -- limites
  credit_limit numeric(14,2) not null,
  max_invoice_amount numeric(14,2) not null,
  max_due_date_days int not null,
  expires_at date not null,

  -- juros mensais
  monthly_rate_d0 numeric(6,3) not null,
  monthly_rate_d1 numeric(6,3) not null,

  -- tarifas. `fee_min` NÃO é piso de segurança: é a TAC efetiva das notas pequenas,
  -- e a tarifa cresce proporcionalmente até o limiar da config (04o §4).
  fee_d0 numeric(10,2) not null,
  fee_min_d0 numeric(10,2) not null,
  fee_d1 numeric(10,2) not null,
  fee_min_d1 numeric(10,2) not null,

  -- acessórios
  commission_percent numeric(6,3) not null,
  extension_rate_percent numeric(6,3) not null,
  bill_fine_percent numeric(6,3) not null,
  invest_back_limit numeric(14,2) not null default 0,
  invest_back_commission_percent numeric(6,3) not null default 0,

  -- flags
  has_insurance boolean not null,
  has_referral boolean not null default false,
  fidc_ready boolean not null default true,

  -- rastreabilidade
  sugestao jsonb not null,
  ajustes jsonb,
  matriz_versao int not null references public.precificacao_matriz (versao),
  status text not null default 'rascunho'
    constraint condicoes_comerciais_status_check
    check (status in ('rascunho', 'publicada', 'falha_validacao', 'substituida')),
  definida_por uuid references public.usuarios (id),
  publicada_em timestamptz,
  erro_validacao text,
  criada_em timestamptz not null default now(),

  /*
   * As regras duras do §3, no banco.
   *
   * A exceção de `falha_validacao` é o ponto todo desta linha: a tentativa RECUSADA
   * também é registro, e ela é, por definição, inválida. Sem a exceção, a única forma
   * de guardar "alguém tentou publicar isto e o validador barrou" seria não guardar.
   */
  constraint condicoes_comerciais_coerentes check (
    status = 'falha_validacao' or (
      monthly_rate_d0 > monthly_rate_d1
      and fee_d0 > fee_d1
      and fee_min_d0 <= fee_d0
      and fee_min_d1 <= fee_d1
      and invest_back_limit <= credit_limit
      and credit_limit > 0
      and fee_d0 >= 0 and fee_min_d0 >= 0 and fee_d1 >= 0 and fee_min_d1 >= 0
      and max_invoice_amount between 500 and 10000000
      and max_due_date_days between 5 and 365
      and monthly_rate_d0 >= 0 and monthly_rate_d0 < 100
      and monthly_rate_d1 >= 0 and monthly_rate_d1 < 100
      and commission_percent >= 0 and commission_percent < 100
      and extension_rate_percent >= 0 and extension_rate_percent < 100
      and bill_fine_percent >= 0 and bill_fine_percent < 100
      and invest_back_commission_percent >= 0 and invest_back_commission_percent < 100
    )
  ),

  -- Publicada sem carimbo de publicação seria uma linha que mente sobre si mesma.
  constraint condicoes_comerciais_publicada_tem_data check (
    status <> 'publicada' or publicada_em is not null
  ),
  constraint condicoes_comerciais_falha_tem_motivo check (
    status <> 'falha_validacao' or nullif(btrim(coalesce(erro_validacao, '')), '') is not null
  )
);

create index if not exists condicoes_comerciais_analise_idx
  on public.condicoes_comerciais (analise_credito_id, criada_em desc);
create index if not exists condicoes_comerciais_cnpj_idx
  on public.condicoes_comerciais (cnpj, criada_em desc);

/*
 * Uma só vigente por análise. Nova versão aposenta a anterior (`substituida`), e o
 * índice parcial garante que a aposentadoria aconteceu — sem ele, um caminho novo que
 * esquecesse o UPDATE deixaria duas condições "vigentes" e o `GET` escolheria uma
 * delas por ordenação, que é a pior forma possível de decidir por quanto o cliente opera.
 */
create unique index if not exists condicoes_comerciais_uma_publicada_idx
  on public.condicoes_comerciais (analise_credito_id) where status = 'publicada';

-- Rascunho também é um só: o formulário tem um estado de trabalho, não uma pilha.
create unique index if not exists condicoes_comerciais_um_rascunho_idx
  on public.condicoes_comerciais (analise_credito_id) where status = 'rascunho';

comment on table public.condicoes_comerciais is
  'Condições comerciais publicadas para a plataforma de produção (04o §2). Nunca update '
  'destrutivo: versão nova entra como publicada e a anterior vira substituida.';

-- ─── §3 A semente da matriz ─────────────────────────────────────────────────
-- Este objeto é o `MATRIZ_PADRAO` de packages/core/src/credito/precificacao.ts,
-- número por número. Os dois precisam andar juntos: o core é quem calcula, este seed
-- é só o ponto de partida gravado. Empresa grande com score alto encosta no piso
-- (1,9% e R$ 150); pequena com score improvável encosta no teto (3,4% e R$ 300).

insert into public.precificacao_matriz (versao, definicao, ativa) values (
  1,
  jsonb_build_object(
    'faixas', jsonb_build_object(
      'juros', jsonb_build_object('d0_min', 1.9, 'd0_max', 3.4, 'd1_desconto_min', 0.1, 'd1_desconto_max', 0.6),
      'tac', jsonb_build_object(
        'fee_d0_min', 150, 'fee_d0_max', 300,
        'fee_min_d0_pct_do_fee', 0.5,
        'fee_d1_desconto_pct_min', 0.1, 'fee_d1_desconto_pct_max', 0.3
      ),
      -- Onde a TAC proporcional atinge o `fee` cheio e para de crescer (§4).
      'limiar_proporcionalidade_tac', 10000,
      'comissao', jsonb_build_object('min', 1.0, 'max', 3.0),
      'max_invoice_amount_default', 1000000,
      'max_due_date_days_default', 90,
      'validade_meses_default', 12,
      -- Editáveis AQUI, nunca no formulário da análise: são política da casa, não
      -- negociação por cliente.
      'fixos', jsonb_build_object(
        'bill_fine_percent', 2.0, 'extension_rate_percent', 12.0,
        'invest_back_limit', 0, 'invest_back_commission_percent', 0,
        'has_referral', false, 'fidc_ready', true
      )
    ),
    'ajustes', jsonb_build_object(
      'cobertura_atradius', jsonb_build_object('juros_pp', -0.2, 'fee_pct', -0.1, 'comissao_pp', -0.2),
      'protesto', jsonb_build_object('juros_pp', 0.4, 'fee_pct', 0.15, 'comissao_pp', 0.2),
      'prazo_medio_alto', jsonb_build_object('acima_de_dias', 90, 'juros_pp', 0.15, 'fee_pct', 0, 'comissao_pp', 0),
      'ticket_medio_baixo', jsonb_build_object('abaixo_de', 5000, 'juros_pp', 0, 'fee_pct', 0.1, 'comissao_pp', 0),
      'ticket_medio_alto', jsonb_build_object('acima_de', 100000, 'juros_pp', -0.1, 'fee_pct', -0.1, 'comissao_pp', 0)
    ),
    'celulas', jsonb_build_object(
      'micro', jsonb_build_object(
        'alta',       jsonb_build_object('monthly_rate_d0', 2.9,  'commission_percent', 2.5, 'fee_d0', 260),
        'media',      jsonb_build_object('monthly_rate_d0', 3.15, 'commission_percent', 2.8, 'fee_d0', 280),
        'improvavel', jsonb_build_object('monthly_rate_d0', 3.4,  'commission_percent', 3.0, 'fee_d0', 300)
      ),
      'pequena', jsonb_build_object(
        'alta',       jsonb_build_object('monthly_rate_d0', 2.6, 'commission_percent', 2.2, 'fee_d0', 235),
        'media',      jsonb_build_object('monthly_rate_d0', 2.9, 'commission_percent', 2.5, 'fee_d0', 260),
        'improvavel', jsonb_build_object('monthly_rate_d0', 3.2, 'commission_percent', 2.8, 'fee_d0', 290)
      ),
      'media', jsonb_build_object(
        'alta',       jsonb_build_object('monthly_rate_d0', 2.35, 'commission_percent', 1.9, 'fee_d0', 210),
        'media',      jsonb_build_object('monthly_rate_d0', 2.6,  'commission_percent', 2.2, 'fee_d0', 235),
        'improvavel', jsonb_build_object('monthly_rate_d0', 3.0,  'commission_percent', 2.6, 'fee_d0', 270)
      ),
      'grande', jsonb_build_object(
        'alta',       jsonb_build_object('monthly_rate_d0', 2.1,  'commission_percent', 1.5, 'fee_d0', 180),
        'media',      jsonb_build_object('monthly_rate_d0', 2.35, 'commission_percent', 1.8, 'fee_d0', 205),
        'improvavel', jsonb_build_object('monthly_rate_d0', 2.8,  'commission_percent', 2.3, 'fee_d0', 250)
      ),
      'corporate', jsonb_build_object(
        'alta',       jsonb_build_object('monthly_rate_d0', 1.9, 'commission_percent', 1.0, 'fee_d0', 150),
        'media',      jsonb_build_object('monthly_rate_d0', 2.1, 'commission_percent', 1.4, 'fee_d0', 175),
        'improvavel', jsonb_build_object('monthly_rate_d0', 2.6, 'commission_percent', 2.0, 'fee_d0', 230)
      )
    )
  ),
  true
) on conflict (versao) do nothing;

-- ═════════════════════════════════════════════════════════════════════════════
-- RLS — Crédito lê, e ninguém escreve direto. Toda escrita é por RPC.
-- ═════════════════════════════════════════════════════════════════════════════

alter table public.precificacao_matriz enable row level security;
alter table public.condicoes_comerciais enable row level security;

drop policy if exists precificacao_matriz_select on public.precificacao_matriz;
create policy precificacao_matriz_select on public.precificacao_matriz
  for select using ((select public.app_tem_modulo('credito')));

drop policy if exists condicoes_comerciais_select on public.condicoes_comerciais;
create policy condicoes_comerciais_select on public.condicoes_comerciais
  for select using ((select public.app_tem_modulo('credito')));

-- ═════════════════════════════════════════════════════════════════════════════
-- As escritas
-- ═════════════════════════════════════════════════════════════════════════════

/**
 * Rascunho (04o §6). Guarda a sugestão e os ajustes sem publicar nada.
 *
 * Um rascunho por análise: o formulário tem um estado de trabalho, não uma pilha de
 * tentativas. Salvar de novo reescreve o rascunho — e só ele, nunca uma publicada.
 */
create or replace function public.app_salvar_condicoes(p jsonb)
returns public.condicoes_comerciais
language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_esteira public.analises_credito;
  v_c jsonb := p -> 'condicoes';
  v_linha public.condicoes_comerciais;
begin
  if not public.app_tem_modulo('credito') then
    raise exception 'Somente o perfil Crédito define condições comerciais.' using errcode = '42501';
  end if;

  select * into v_esteira from public.analises_credito
   where id = (p ->> 'analise_credito_id')::uuid;
  if v_esteira.id is null then
    raise exception 'Análise não encontrada.' using errcode = '23503';
  end if;

  delete from public.condicoes_comerciais
   where analise_credito_id = v_esteira.id and status = 'rascunho';

  insert into public.condicoes_comerciais (
    analise_credito_id, empresa_id, cnpj,
    credit_limit, max_invoice_amount, max_due_date_days, expires_at,
    monthly_rate_d0, monthly_rate_d1,
    fee_d0, fee_min_d0, fee_d1, fee_min_d1,
    commission_percent, extension_rate_percent, bill_fine_percent,
    invest_back_limit, invest_back_commission_percent,
    has_insurance, has_referral, fidc_ready,
    sugestao, ajustes, matriz_versao, status, definida_por
  ) values (
    v_esteira.id, v_esteira.empresa_id, v_esteira.cnpj,
    (v_c ->> 'credit_limit')::numeric, (v_c ->> 'max_invoice_amount')::numeric,
    (v_c ->> 'max_due_date_days')::int, (v_c ->> 'expires_at')::date,
    (v_c ->> 'monthly_rate_d0')::numeric, (v_c ->> 'monthly_rate_d1')::numeric,
    (v_c ->> 'fee_d0')::numeric, (v_c ->> 'fee_min_d0')::numeric,
    (v_c ->> 'fee_d1')::numeric, (v_c ->> 'fee_min_d1')::numeric,
    (v_c ->> 'commission_percent')::numeric, (v_c ->> 'extension_rate_percent')::numeric,
    (v_c ->> 'bill_fine_percent')::numeric,
    (v_c ->> 'invest_back_limit')::numeric, (v_c ->> 'invest_back_commission_percent')::numeric,
    (v_c ->> 'has_insurance')::boolean, (v_c ->> 'has_referral')::boolean, (v_c ->> 'fidc_ready')::boolean,
    p -> 'sugestao', p -> 'ajustes', (p ->> 'matriz_versao')::int, 'rascunho', v_ator
  )
  returning * into v_linha;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  select v_esteira.empresa_id, 'condicoes.sugeridas',
         jsonb_build_object(
           'analise_credito_id', v_esteira.id, 'cnpj', v_esteira.cnpj,
           'condicoes_id', v_linha.id, 'matriz_versao', v_linha.matriz_versao
         ), v_ator
  where v_esteira.empresa_id is not null;

  return v_linha;
end $$;

/**
 * A publicação (04o §6/§7). É ela que faz o webhook ACIONÁVEL sair.
 *
 * ─── POR QUE A FALHA TAMBÉM ENTRA AQUI ──────────────────────────────────────
 * A validação de verdade roda no core, antes: é o espelho do Zod deles, e é ela que
 * diz ao analista qual campo está errado. Quando ela recusa, a action chama esta
 * MESMA função com `erro_validacao` preenchido — a linha nasce `falha_validacao`,
 * nenhum evento é enfileirado, e a mensagem exata fica gravada.
 *
 * Duas funções separadas dariam dois caminhos para "registrar uma tentativa de
 * publicação", e o segundo esqueceria de aposentar a anterior, ou de auditar.
 */
create or replace function public.app_publicar_condicoes(p jsonb)
returns public.condicoes_comerciais
language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_esteira public.analises_credito;
  v_c jsonb := p -> 'condicoes';
  v_erro text := nullif(btrim(coalesce(p ->> 'erro_validacao', '')), '');
  v_status text := case when v_erro is null then 'publicada' else 'falha_validacao' end;
  v_anterior public.condicoes_comerciais;
  v_linha public.condicoes_comerciais;
begin
  if not public.app_tem_modulo('credito') then
    raise exception 'Somente o perfil Crédito publica condições comerciais.' using errcode = '42501';
  end if;

  select * into v_esteira from public.analises_credito
   where id = (p ->> 'analise_credito_id')::uuid for update;
  if v_esteira.id is null then
    raise exception 'Análise não encontrada.' using errcode = '23503';
  end if;

  -- Condição comercial só existe para análise aprovada. Publicar de uma negada
  -- mandaria à produção um `status: APPROVED` que a esteira nunca disse.
  if v_esteira.estagio not in ('aprovada', 'aprovada_parcial') then
    raise exception 'Só análise aprovada recebe condições comerciais.' using errcode = '23514';
  end if;

  select * into v_anterior from public.condicoes_comerciais
   where analise_credito_id = v_esteira.id and status = 'publicada';

  if v_erro is null then
    -- Aposenta a vigente e o rascunho ANTES de inserir: o índice parcial único não
    -- deixaria duas publicadas coexistirem nem por um instante dentro da transação.
    update public.condicoes_comerciais
       set status = 'substituida'
     where analise_credito_id = v_esteira.id and status in ('publicada', 'rascunho');
  end if;

  insert into public.condicoes_comerciais (
    analise_credito_id, empresa_id, cnpj,
    credit_limit, max_invoice_amount, max_due_date_days, expires_at,
    monthly_rate_d0, monthly_rate_d1,
    fee_d0, fee_min_d0, fee_d1, fee_min_d1,
    commission_percent, extension_rate_percent, bill_fine_percent,
    invest_back_limit, invest_back_commission_percent,
    has_insurance, has_referral, fidc_ready,
    sugestao, ajustes, matriz_versao, status, definida_por, publicada_em, erro_validacao
  ) values (
    v_esteira.id, v_esteira.empresa_id, v_esteira.cnpj,
    (v_c ->> 'credit_limit')::numeric, (v_c ->> 'max_invoice_amount')::numeric,
    (v_c ->> 'max_due_date_days')::int, (v_c ->> 'expires_at')::date,
    (v_c ->> 'monthly_rate_d0')::numeric, (v_c ->> 'monthly_rate_d1')::numeric,
    (v_c ->> 'fee_d0')::numeric, (v_c ->> 'fee_min_d0')::numeric,
    (v_c ->> 'fee_d1')::numeric, (v_c ->> 'fee_min_d1')::numeric,
    (v_c ->> 'commission_percent')::numeric, (v_c ->> 'extension_rate_percent')::numeric,
    (v_c ->> 'bill_fine_percent')::numeric,
    (v_c ->> 'invest_back_limit')::numeric, (v_c ->> 'invest_back_commission_percent')::numeric,
    (v_c ->> 'has_insurance')::boolean, (v_c ->> 'has_referral')::boolean, (v_c ->> 'fidc_ready')::boolean,
    p -> 'sugestao', p -> 'ajustes', (p ->> 'matriz_versao')::int,
    v_status, v_ator,
    case when v_erro is null then now() else null end,
    v_erro
  )
  returning * into v_linha;

  if v_erro is null then
    /*
     * O evento ACIONÁVEL. A semente carrega só o que este gatilho sabe; o corpo
     * completo — incluindo o `payload_producao` — é montado na hora da entrega pelo
     * builder único do core, o mesmo que o `GET` usa (04n).
     */
    perform public.app__enfileirar_webhook(
      'credito.condicoes_definidas', v_esteira.id,
      jsonb_build_object(
        'condicoes_id', v_linha.id,
        'versao_anterior', v_anterior.id,
        'matriz_versao', v_linha.matriz_versao,
        'estagio_atual', v_esteira.estagio
      )
    );
  end if;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  select v_esteira.empresa_id,
         case when v_erro is null then 'condicoes.publicadas' else 'condicoes.falha_validacao' end,
         jsonb_build_object(
           'analise_credito_id', v_esteira.id, 'cnpj', v_esteira.cnpj,
           'condicoes_id', v_linha.id, 'matriz_versao', v_linha.matriz_versao,
           'credit_limit', v_linha.credit_limit,
           'monthly_rate_d0', v_linha.monthly_rate_d0,
           'erro_validacao', v_erro
         ), v_ator
  where v_esteira.empresa_id is not null;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator,
          case when v_erro is null then 'condicoes.publicadas' else 'condicoes.falha_validacao' end,
          'condicoes_comerciais', v_linha.id::text,
          jsonb_build_object(
            'analise_credito_id', v_esteira.id,
            'matriz_versao', v_linha.matriz_versao,
            'ajustes', v_linha.ajustes,
            'erro_validacao', v_erro
          ));

  return v_linha;
end $$;

/** Nova versão da matriz. Nunca update: a condição antiga aponta para a sua. */
create or replace function public.app_salvar_matriz_precificacao(p jsonb)
returns public.precificacao_matriz
language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_linha public.precificacao_matriz;
  v_versao int;
  v_ativar boolean := coalesce((p ->> 'ativar')::boolean, true);
begin
  if not public.app_tem_modulo('credito') then
    raise exception 'Somente o perfil Crédito altera a matriz de precificação.' using errcode = '42501';
  end if;

  select coalesce(max(versao), 0) + 1 into v_versao from public.precificacao_matriz;

  if v_ativar then
    update public.precificacao_matriz set ativa = false where ativa;
  end if;

  insert into public.precificacao_matriz (versao, definicao, ativa, criada_por)
  values (v_versao, p -> 'definicao', v_ativar, v_ator)
  returning * into v_linha;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator,
          case when v_ativar then 'precificacao.matriz_ativada' else 'precificacao.matriz_salva' end,
          'precificacao_matriz', v_versao::text,
          jsonb_build_object('versao', v_versao, 'ativa', v_ativar));

  return v_linha;
end $$;

/**
 * Ativar uma versão que já existe — voltar atrás sem reescrever nada.
 *
 * As condições já publicadas continuam apontando para a matriz que as sugeriu: trocar
 * a ativa muda o que será SUGERIDO daqui para frente, nunca o que já foi acordado com
 * um cliente.
 */
create or replace function public.app_ativar_matriz_precificacao(p jsonb)
returns public.precificacao_matriz
language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_linha public.precificacao_matriz;
begin
  if not public.app_tem_modulo('credito') then
    raise exception 'Somente o perfil Crédito ativa a matriz de precificação.' using errcode = '42501';
  end if;

  update public.precificacao_matriz set ativa = false where ativa;

  update public.precificacao_matriz set ativa = true
   where versao = (p ->> 'versao')::int
  returning * into v_linha;

  if v_linha.versao is null then
    raise exception 'Versão da matriz não encontrada.' using errcode = 'no_data_found';
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'precificacao.matriz_ativada', 'precificacao_matriz', v_linha.versao::text,
          jsonb_build_object('versao', v_linha.versao));

  return v_linha;
end $$;

revoke execute on function public.app_salvar_condicoes(jsonb) from public, anon;
revoke execute on function public.app_publicar_condicoes(jsonb) from public, anon;
revoke execute on function public.app_salvar_matriz_precificacao(jsonb) from public, anon;
revoke execute on function public.app_ativar_matriz_precificacao(jsonb) from public, anon;

grant execute on function public.app_salvar_condicoes(jsonb) to authenticated, service_role;
grant execute on function public.app_publicar_condicoes(jsonb) to authenticated, service_role;
grant execute on function public.app_salvar_matriz_precificacao(jsonb) to authenticated, service_role;
grant execute on function public.app_ativar_matriz_precificacao(jsonb) to authenticated, service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- LEITURAS — o painel da precificação e a amostra do preview
-- ═════════════════════════════════════════════════════════════════════════════

/**
 * Tudo que a seção "Condições comerciais" precisa, numa chamada.
 *
 * Mesma razão do `analise_propria_painel` (0122): o motor de sugestão cruza sete
 * origens (esteira, empresa, score, protestos, NF-e observada, cadastro na plataforma
 * e a matriz vigente), e montá-las no cliente seriam sete idas ao banco — sobre
 * tabelas que o app mobile não deveria precisar conhecer uma a uma.
 *
 * A SUGESTÃO NÃO É CALCULADA AQUI. Esta função devolve o CONTEXTO; quem transforma
 * contexto em preço é `sugerirCondicoes`, no core, com teste. Reimplementá-la em SQL
 * daria duas fórmulas de preço, e a segunda divergiria na primeira mudança.
 */
create or replace function public.condicoes_painel(p_analise_credito_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_esteira public.analises_credito;
  v_empresa public.empresas;
  v_score public.empresa_scores;
  v_propria public.analises_proprietarias;
  v_janela int := 6;
begin
  if not public.app_tem_modulo('credito') then
    raise exception 'Sem acesso ao módulo Crédito.' using errcode = '42501';
  end if;

  select * into v_esteira from public.analises_credito where id = p_analise_credito_id;
  if v_esteira.id is null then
    return jsonb_build_object('encontrado', false);
  end if;

  select * into v_empresa from public.empresas where id = v_esteira.empresa_id;

  select * into v_score from public.empresa_scores
   where cnpj = v_esteira.cnpj order by calculado_em desc limit 1;

  select * into v_propria from public.analises_proprietarias
   where analise_credito_id = v_esteira.id order by criada_em desc limit 1;

  return jsonb_build_object(
    'encontrado', true,
    'esteira', jsonb_build_object(
      'id', v_esteira.id, 'cnpj', v_esteira.cnpj, 'estagio', v_esteira.estagio,
      'limite_aprovado', v_esteira.limite_aprovado, 'limite_operacional', v_esteira.limite_operacional,
      'expira_em', v_esteira.expira_em, 'seguradora', v_esteira.seguradora,
      'rating_seguradora', v_esteira.rating_seguradora, 'external_id', v_esteira.external_id
    ),
    'empresa', case when v_empresa.id is null then null else jsonb_build_object(
      'id', v_empresa.id, 'razao_social', v_empresa.razao_social,
      'nome_fantasia', v_empresa.nome_fantasia,
      'faturamento_anual', v_empresa.faturamento_anual,
      'faturamento_origem', v_empresa.faturamento_origem,
      'faturamento_confianca', v_empresa.faturamento_confianca
    ) end,
    'score', case when v_score.id is null then null
      else jsonb_build_object('score', v_score.score, 'faixa', v_score.faixa) end,
    'protestos', (
      select jsonb_build_object('tem_protesto', pa.tem_protesto, 'qtd_protestos', pa.qtd_protestos,
                                'valor_total', pa.valor_total, 'consultado_em', pa.consultado_em)
        from public.protestos_atual pa where pa.cnpj = v_esteira.cnpj
    ),
    /*
     * `has_insurance` é DERIVADO (04o §5), nunca marcado à mão: cobertura é aprovação
     * VIGENTE da seguradora, com limite e dentro da validade. Um checkbox aqui deixaria
     * alguém prometer à produção uma cobertura que a apólice não conhece.
     */
    'cobertura_vigente', (
      v_esteira.seguradora is not null
      and v_esteira.estagio in ('aprovada', 'aprovada_parcial')
      and coalesce(v_esteira.limite_aprovado, 0) > 0
      and (v_esteira.expira_em is null or v_esteira.expira_em >= current_date)
    ),
    -- Ticket e prazo médios das NF-e observadas: os dois ajustes que dependem do
    -- COMPORTAMENTO do sacado, e não da ficha dele.
    'nfe', (
      select jsonb_build_object(
               'janela_meses', v_janela,
               'qtd', count(*),
               'total', coalesce(sum(n.valor), 0),
               'ticket_medio', case when count(*) = 0 then null else avg(n.valor) end,
               'prazo_medio_dias', avg(n.dias_para_vencimento)
             )
        from public.notas_fiscais n
       where n.sacado_cnpj = v_esteira.cnpj
         and n.emitida_em >= (now() - make_interval(months => v_janela))
    ),
    'limite_recomendado', coalesce(v_propria.decisao_limite, v_propria.limite_recomendado),
    -- O id do cadastro DELES. Sem ele, o payload identifica por CNPJ + razão social.
    'onepay_company_id', (
      select c.onepay_company_id from public.clientes_onepay c where c.cnpj = v_esteira.cnpj
    ),
    'matriz', (
      select jsonb_build_object('versao', m.versao, 'definicao', m.definicao)
        from public.precificacao_matriz m where m.ativa
    ),
    'condicoes', coalesce((
      select jsonb_agg(to_jsonb(cc) order by cc.criada_em desc)
        from public.condicoes_comerciais cc where cc.analise_credito_id = v_esteira.id
    ), '[]'::jsonb),
    -- As entregas do evento acionável. É o que responde "eles receberam?" sem sair da tela.
    'entregas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', we.id, 'status', we.status, 'tentativas', we.tentativas,
               'ultimo_status_http', we.ultimo_status_http, 'ultimo_erro', we.ultimo_erro,
               'criado_em', we.criado_em, 'entregue_em', we.entregue_em,
               'proxima_tentativa_em', we.proxima_tentativa_em
             ) order by we.criado_em desc)
        from public.webhook_entregas we
       where we.analise_id = v_esteira.id and we.evento = 'credito.condicoes_definidas'
    ), '[]'::jsonb)
  );
end $$;

/**
 * A amostra do preview do Admin → Precificação (04o §6).
 *
 * Devolve o CONTEXTO das análises aprovadas do período — não o preço delas. A tela
 * roda o motor do core sobre esta amostra com a matriz em edição e com a vigente, e
 * mostra a diferença. Calcular aqui exigiria o motor em SQL; devolver contexto mantém
 * uma fórmula só, a testada.
 */
create or replace function public.precificacao_amostra(p_meses int default 3)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_meses int := greatest(1, least(coalesce(p_meses, 3), 36));
  v_janela int := 6;
begin
  if not public.app_tem_modulo('credito') then
    raise exception 'Sem acesso ao módulo Crédito.' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'analise_credito_id', a.id,
             'cnpj', a.cnpj,
             'razao_social', coalesce(e.razao_social, a.cnpj),
             'faturamento_estimado', e.faturamento_anual,
             'faixa_score', s.faixa,
             'cobertura_vigente', (
               a.seguradora is not null
               and coalesce(a.limite_aprovado, 0) > 0
               and (a.expira_em is null or a.expira_em >= current_date)
             ),
             'tem_protesto', pa.tem_protesto,
             'prazo_medio_nf_dias', nf.prazo_medio_dias,
             'ticket_medio_nf', nf.ticket_medio,
             'limite_aprovado', a.limite_aprovado,
             'limite_recomendado', ap.limite_recomendado
           ) order by a.atualizada_em desc)
      from public.analises_credito a
      left join public.empresas e on e.id = a.empresa_id
      left join lateral (
        select es.faixa from public.empresa_scores es
         where es.cnpj = a.cnpj order by es.calculado_em desc limit 1
      ) s on true
      left join public.protestos_atual pa on pa.cnpj = a.cnpj
      left join public.analises_proprietarias ap on ap.id = a.analise_propria_id
      left join lateral (
        select avg(n.valor) as ticket_medio, avg(n.dias_para_vencimento) as prazo_medio_dias
          from public.notas_fiscais n
         where n.sacado_cnpj = a.cnpj
           and n.emitida_em >= (now() - make_interval(months => v_janela))
      ) nf on true
     where a.estagio in ('aprovada', 'aprovada_parcial')
       and a.atualizada_em >= (now() - make_interval(months => v_meses))
     limit 500
  ), '[]'::jsonb);
end $$;

revoke execute on function public.condicoes_painel(uuid) from public, anon;
revoke execute on function public.precificacao_amostra(int) from public, anon;
grant execute on function public.condicoes_painel(uuid) to authenticated, service_role;
grant execute on function public.precificacao_amostra(int) to authenticated, service_role;
