-- ============================================================================
-- 0269c — Cobrança: projeção dos títulos, o grupo do sacado e as leituras
--
-- ── A PROJEÇÃO É SQL, E NÃO TYPESCRIPT ──────────────────────────────────────
-- `titulos` sai inteira de `antecipacoes` + `notas_fiscais` + três funções que já
-- existem no banco (holding, matriz, limite). Fazer isso no worker seria buscar
-- 1.300 linhas, chamar três RPCs por CNPJ e escrever de volta — a mesma conta,
-- com três idas e voltas por linha. Aqui é um upsert.
--
-- ── O VENCIMENTO É ESCRITO UMA VEZ ──────────────────────────────────────────
-- O `on conflict` nunca toca `vencimento`. Uma data nova vinda da produção (a
-- antecipação prorrogada) vai para `vencimento_prorrogado`. A cl. 16900.20 manda
-- contar os prazos da apólice sobre o original, e é daqui que o relógio lê.
--
-- ── O GRUPO ─────────────────────────────────────────────────────────────────
-- Não existe no banco uma função "todos os CNPJs do grupo deste sacado". O grupo
-- aqui é a UNIÃO de: o cabeça; toda SPE/filial que já apareceu como sacado de um
-- título dele; a raiz do CNPJ; os vínculos manuais (`sacado_vinculo`); e as SPEs
-- que dividem o `grupo_id` do cabeça. `cobranca_bloqueios_cnpj` materializa essa
-- lista no momento do bloqueio, para a pergunta "este CNPJ está bloqueado?" ser um
-- lookup por chave em qualquer tela, e não cinco junções.
-- ============================================================================

-- ─── O status da produção que significa "título cedido" ─────────────────────
-- Espelho de `status_conversores` (packages/core/src/antecipacao/schemas.ts). Fica
-- em função para a projeção e o teste de regressão lerem a mesma lista.
create or replace function public.app__cobranca_status_cedido(p_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select upper(coalesce(p_status, '')) in (
    'APPROVED', 'PAY_OUT', 'BILLET_SWAPPED', 'CONCLUDED', 'EXPIRED_BILL_SWAPPED',
    'EXTENDED_BILL_SWAPPED', 'IN_EXTENSION_BILL_SWAPPED');
$$;

-- ─── Bloqueio por CNPJ ──────────────────────────────────────────────────────

create table public.cobranca_bloqueios_cnpj (
  cnpj text primary key constraint cobranca_bloqueios_cnpj_check check (cnpj ~ '^[0-9]{14}$'),
  sacado_matriz_cnpj text not null,
  cobranca_id uuid references public.cobrancas (id) on delete cascade,
  desde timestamptz not null default now()
);

create index cobranca_bloqueios_matriz_idx on public.cobranca_bloqueios_cnpj (sacado_matriz_cnpj);

alter table public.cobranca_bloqueios_cnpj enable row level security;
revoke all on public.cobranca_bloqueios_cnpj from anon, authenticated;
grant select on public.cobranca_bloqueios_cnpj to authenticated;
create policy cobranca_bloqueios_cnpj_select on public.cobranca_bloqueios_cnpj
  for select to authenticated using ((select public.app_tem_modulo('cobranca')));

create or replace function public.app__cobranca_cnpjs_do_grupo(p_matriz text)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  with cabeca as (select e.id, e.cnpj, e.grupo_id from public.empresas e where e.cnpj = p_matriz)
  select p_matriz
  union
  select t.sacado_cnpj from public.titulos t where t.sacado_matriz_cnpj = p_matriz
  union
  select e.cnpj from public.empresas e where left(e.cnpj, 8) = left(p_matriz, 8)
  union
  select v.cnpj from public.sacado_vinculo v join cabeca c on c.id = v.empresa_id
  union
  select e.cnpj from public.empresas e join cabeca c on c.grupo_id is not null and e.grupo_id = c.grupo_id
  where e.is_spe;
$$;

create or replace function public.app__cobranca_empresas_do_grupo(p_matriz text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id from public.empresas e
  where e.cnpj in (select public.app__cobranca_cnpjs_do_grupo(p_matriz));
$$;

/*
 * A pergunta das outras telas: "este CNPJ (sacado de uma NF, de uma pré, de uma
 * análise) pertence a um grupo em cobrança?". Por chave primeiro; o cabeça
 * resolvido na hora pega a SPE que ainda não tinha aparecido quando o bloqueio foi
 * aplicado.
 */
create or replace function public.app_cobranca_sacado_bloqueado(p_cnpj text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_cnpj is not null and (
    exists (select 1 from public.cobranca_bloqueios_cnpj b where b.cnpj = p_cnpj)
    or exists (
      select 1 from public.empresas e
      where e.bloqueio_cobranca
        and (e.id = public.app_holding_do_sacado(p_cnpj) or e.cnpj = public.app__matriz_do_cnpj(p_cnpj))
    )
  );
$$;

/*
 * A lista inteira, para a tela que pinta cards (funil de NFs, sacados por NF) sem
 * ter o módulo Cobrança. Devolve só CNPJs — o motivo e a cobrança continuam atrás
 * da RLS do módulo. Com poucas dezenas de grupos em cobrança, é uma lista curta.
 */
create or replace function public.app_cnpjs_em_cobranca()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(b.cnpj order by b.cnpj), '{}') from public.cobranca_bloqueios_cnpj b;
$$;

revoke all on function public.app__cobranca_cnpjs_do_grupo(text) from public, anon, authenticated;
revoke all on function public.app__cobranca_empresas_do_grupo(text) from public, anon, authenticated;
revoke all on function public.app_cobranca_sacado_bloqueado(text) from public, anon;
revoke all on function public.app_cnpjs_em_cobranca() from public, anon;
revoke all on function public.app__cobranca_status_cedido(text) from public, anon, authenticated;
grant execute on function public.app__cobranca_cnpjs_do_grupo(text) to service_role;
grant execute on function public.app__cobranca_empresas_do_grupo(text) to service_role;
grant execute on function public.app_cobranca_sacado_bloqueado(text) to authenticated, service_role;
grant execute on function public.app_cnpjs_em_cobranca() to authenticated, service_role;
grant execute on function public.app__cobranca_status_cedido(text) to service_role;

-- ─── A projeção ─────────────────────────────────────────────────────────────

create or replace function public.app__cobranca_projetar_titulos()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_projetados int;
  v_quitados int;
  v_cobrancas_quitadas int;
  v_bloqueios_novos int;
begin
  with fonte as (
    select a.id_externo, a.document_number, a.access_key_casada, a.sacado_cnpj, a.sacado_nome,
           a.fornecedor_cnpj, a.fornecedor_nome, a.gross_value, a.net_value, a.original_due_date,
           upper(a.status) as status, a.completion_date, a.invoice_cancelled_at,
           (nf.emitida_em at time zone 'America/Sao_Paulo')::date as emissao
    from public.antecipacoes a
    left join public.notas_fiscais nf on nf.access_key = a.access_key_casada
    where a.sacado_cnpj ~ '^[0-9]{14}$'
      and a.fornecedor_cnpj ~ '^[0-9]{14}$'
      and a.original_due_date is not null
      and a.gross_value is not null
      and (public.app__cobranca_status_cedido(a.status)
           -- a que já foi projetada e regrediu continua aqui, para virar `cancelado`
           or exists (select 1 from public.titulos t where t.externo_id = a.id_externo::text))
  ),
  sacados as (
    select s.sacado_cnpj,
           h.id as holding_id, h.cnpj as holding_cnpj,
           public.app__matriz_do_cnpj(s.sacado_cnpj) as matriz_raiz,
           (select l.limite from public.app__limite_da_analise(s.sacado_cnpj) l limit 1) as limite
    from (select distinct sacado_cnpj from fonte) s
    left join public.empresas h on h.id = public.app_holding_do_sacado(s.sacado_cnpj)
  ),
  cedentes as (
    select c.fornecedor_cnpj, public.app__matriz_do_cnpj(c.fornecedor_cnpj) as matriz
    from (select distinct fornecedor_cnpj from fonte) c
  ),
  linhas as (
    select
      f.id_externo::text as externo_id,
      f.id_externo as antecipacao_id_externo,
      nullif(btrim(f.document_number), '') as numero,
      f.access_key_casada as nf_chave_acesso,
      f.sacado_cnpj, f.sacado_nome,
      coalesce(s.holding_cnpj, s.matriz_raiz, f.sacado_cnpj) as sacado_matriz_cnpj,
      coalesce(s.holding_id, (select e.id from public.empresas e where e.cnpj = coalesce(s.matriz_raiz, f.sacado_cnpj))) as sacado_empresa_id,
      f.fornecedor_cnpj as cedente_cnpj, f.fornecedor_nome as cedente_nome,
      coalesce(c.matriz, f.fornecedor_cnpj) as cedente_matriz_cnpj,
      coalesce(
        (select e.id from public.empresas e where e.cnpj = f.fornecedor_cnpj),
        (select e.id from public.empresas e where e.cnpj = c.matriz)) as cedente_empresa_id,
      f.gross_value as valor_face,
      f.net_value as valor_cedido,
      f.emissao,
      f.original_due_date as vencimento,
      case
        when f.invoice_cancelled_at is not null then 'cancelado'
        when f.status = 'CONCLUDED' then 'pago'
        when public.app__cobranca_status_cedido(f.status) then 'aberto'
        else 'cancelado'
      end as status,
      f.status as status_producao,
      case when f.status = 'CONCLUDED' and f.completion_date is not null
           then (f.completion_date at time zone 'America/Sao_Paulo')::date end as pago_em,
      case when f.status = 'CONCLUDED' and f.completion_date is not null
           then 'conclusao_producao' end as pago_em_origem,
      s.limite as limite_credito_vigente
    from fonte f
    join sacados s on s.sacado_cnpj = f.sacado_cnpj
    join cedentes c on c.fornecedor_cnpj = f.fornecedor_cnpj
  ),
  up as (
    insert into public.titulos as t (
      externo_id, antecipacao_id_externo, numero, nf_chave_acesso,
      sacado_cnpj, sacado_nome, sacado_matriz_cnpj, sacado_empresa_id,
      cedente_cnpj, cedente_nome, cedente_matriz_cnpj, cedente_empresa_id,
      valor_face, valor_cedido, emissao, vencimento, status, status_producao,
      pago_em, pago_em_origem, limite_credito_vigente, sincronizado_em)
    select externo_id, antecipacao_id_externo, numero, nf_chave_acesso,
           sacado_cnpj, sacado_nome, sacado_matriz_cnpj, sacado_empresa_id,
           cedente_cnpj, cedente_nome, cedente_matriz_cnpj, cedente_empresa_id,
           valor_face, valor_cedido, emissao, vencimento, status, status_producao,
           pago_em, pago_em_origem, limite_credito_vigente, now()
    from linhas
    on conflict (externo_id) do update set
      numero = excluded.numero,
      nf_chave_acesso = excluded.nf_chave_acesso,
      sacado_nome = excluded.sacado_nome,
      sacado_matriz_cnpj = excluded.sacado_matriz_cnpj,
      sacado_empresa_id = excluded.sacado_empresa_id,
      cedente_nome = excluded.cedente_nome,
      cedente_matriz_cnpj = excluded.cedente_matriz_cnpj,
      cedente_empresa_id = excluded.cedente_empresa_id,
      valor_face = excluded.valor_face,
      valor_cedido = excluded.valor_cedido,
      emissao = coalesce(excluded.emissao, t.emissao),
      -- `vencimento` fica de fora de propósito: é o original, e é sagrado
      vencimento_prorrogado = case
        when excluded.vencimento <> t.vencimento then excluded.vencimento
        else t.vencimento_prorrogado end,
      status = excluded.status,
      status_producao = excluded.status_producao,
      pago_em = excluded.pago_em,
      pago_em_origem = excluded.pago_em_origem,
      limite_credito_vigente = excluded.limite_credito_vigente,
      sincronizado_em = now()
    returning 1
  )
  select count(*) into v_projetados from up;

  -- ── Quitação vinda da produção (cobranca/atualizar-titulos, §14) ──
  with q as (
    update public.cobranca_titulos ct set
      situacao = 'quitado',
      quitado_em = coalesce(t.pago_em, current_date),
      quitado_origem = 'producao',
      valor_recebido = coalesce(t.valor_pago, ct.valor_face_snapshot)
    from public.titulos t
    where t.id = ct.titulo_id
      and t.status in ('pago', 'recomprado')
      and ct.situacao in ('em_cobranca', 'acordado', 'protestado', 'sinistrado')
    returning ct.cobranca_id, ct.titulo_id, ct.valor_face_snapshot, ct.quitado_em
  ),
  ev as (
    insert into public.empresa_eventos (empresa_id, tipo, payload)
    select c.sacado_empresa_id, 'cobranca.titulo_quitado',
           jsonb_build_object(
             'titulo', 'Título quitado em cobrança',
             'resumo', coalesce(t.numero, t.externo_id) || ' — R$ ' ||
                       to_char(q.valor_face_snapshot, 'FM999G999G999G990D00') || ', pago em ' ||
                       to_char(q.quitado_em, 'DD/MM/YYYY') || '.',
             'url', '/cobranca/cobrancas/' || c.id,
             'cobranca_id', c.id, 'codigo', c.codigo, 'titulo_id', t.id,
             'destinatarios', case when c.responsavel_id is null then '[]'::jsonb
                                   else jsonb_build_array(c.responsavel_id) end,
             'chave', 'cobranca.titulo_quitado:' || t.id)
    from q
    join public.cobrancas c on c.id = q.cobranca_id
    join public.titulos t on t.id = q.titulo_id
    returning 1
  )
  select count(*) into v_quitados from ev;

  -- Cobrança sem título ativo vira `quitada`. Mover o estágio é reflexo de estado,
  -- não um ato: o bloqueio continua até a regularização, que é humana (§11).
  with done as (
    update public.cobrancas c set estagio = 'quitada', encerrada_em = coalesce(c.encerrada_em, now()),
                                  motivo_encerramento = coalesce(c.motivo_encerramento, 'Todos os títulos quitados.')
    where c.estagio in ('notificada', 'em_negociacao', 'acordo_firmado', 'acordo_em_cumprimento', 'judicializada')
      and not exists (
        select 1 from public.cobranca_titulos ct
        where ct.cobranca_id = c.id and ct.situacao not in ('quitado', 'retirado'))
      and exists (select 1 from public.cobranca_titulos ct where ct.cobranca_id = c.id and ct.situacao = 'quitado')
    returning 1
  )
  select count(*) into v_cobrancas_quitadas from done;

  -- SPE nova de um grupo já bloqueado entra no bloqueio assim que aparece.
  with novos as (
    insert into public.cobranca_bloqueios_cnpj (cnpj, sacado_matriz_cnpj, cobranca_id)
    select distinct on (t.sacado_cnpj) t.sacado_cnpj, b.sacado_matriz_cnpj, b.cobranca_id
    from public.titulos t
    join (select distinct on (sacado_matriz_cnpj) sacado_matriz_cnpj, cobranca_id
          from public.cobranca_bloqueios_cnpj order by sacado_matriz_cnpj, desde) b
      on b.sacado_matriz_cnpj = t.sacado_matriz_cnpj
    on conflict (cnpj) do nothing
    returning 1
  )
  select count(*) into v_bloqueios_novos from novos;

  return jsonb_build_object(
    'projetados', v_projetados, 'quitados', v_quitados,
    'cobrancas_quitadas', v_cobrancas_quitadas, 'bloqueios_novos', v_bloqueios_novos);
end;
$$;

revoke all on function public.app__cobranca_projetar_titulos() from public, anon, authenticated;
grant execute on function public.app__cobranca_projetar_titulos() to service_role;

-- ─── Leituras ───────────────────────────────────────────────────────────────

/*
 * Títulos em aberto, com o atraso contado hoje e a cobrança ativa (se houver). É o
 * que a tela "Nova cobrança" lista depois de escolher o grupo.
 */
create view public.cobranca_titulos_abertos
with (security_invoker = true) as
select
  t.*,
  greatest(0, current_date - t.vencimento) as dias_atraso,
  ct.cobranca_id as cobranca_ativa_id,
  c.codigo as cobranca_ativa_codigo,
  (t.sacado_cnpj = t.sacado_matriz_cnpj) as sacado_e_matriz
from public.titulos t
left join public.cobranca_titulos ct
  on ct.titulo_id = t.id and ct.situacao in ('em_cobranca', 'acordado', 'protestado', 'sinistrado')
left join public.cobrancas c on c.id = ct.cobranca_id
where t.status = 'aberto';

/*
 * O relógio (§6.3): cada prazo ativo com o PRÓXIMO marco que ainda importa. Depois
 * de notificada a seguradora, D+90 deixa de ser o marco; depois de enviado o
 * sinistro, D+360 também. O painel ordena por `dias_restantes`.
 */
create view public.apolice_relogio
with (security_invoker = true) as
select
  p.*,
  t.numero, t.sacado_cnpj, t.sacado_nome, t.sacado_matriz_cnpj, t.cedente_cnpj, t.cedente_nome,
  t.valor_face, t.status as titulo_status,
  c.codigo as cobranca_codigo, c.responsavel_id,
  s.estagio as sinistro_estagio, s.codigo as sinistro_codigo,
  m.marco as proximo_marco, m.data as proximo_marco_em,
  (m.data - current_date) as dias_restantes,
  (current_date - p.vencimento_original) as dias_desde_vencimento
from public.apolice_prazos p
join public.titulos t on t.id = p.titulo_id
left join public.cobrancas c on c.id = p.cobranca_id
left join public.sinistros s on s.id = p.sinistro_id
cross join lateral (
  select * from (values
    (1, 'parada_cobertura', p.data_parada_cobertura, current_date <= p.data_parada_cobertura),
    (2, 'notificacao_seguradora', p.data_limite_notificacao, p.notificado_seguradora_em is null),
    (3, 'data_perda', p.data_perda, current_date <= p.data_perda),
    (4, 'envio_sinistro', p.data_limite_sinistro,
        coalesce(s.estagio, 'preparacao') in ('preparacao', 'notificado'))
  ) v(ordem, marco, data, pendente)
  where v.pendente
  order by v.ordem
  limit 1
) m
where p.status = 'ativo';

/*
 * O card do kanban (§12): uma linha por cobrança, com o que o card mostra e os
 * filtros pedem. O próximo prazo de apólice é o menor entre os títulos dela.
 */
create view public.cobranca_cards
with (security_invoker = true) as
select
  c.*,
  coalesce(e.razao_social, tt.sacado_nome_matriz, tt.sacado_nome_qualquer) as sacado_razao_social,
  u.nome as responsavel_nome,
  tt.qtd_titulos, tt.qtd_ativos, tt.valor_face, tt.valor_em_aberto, tt.qtd_spes, tt.max_dias_atraso,
  case when c.notificada_em is null then null
       else (current_date - (c.notificada_em at time zone 'America/Sao_Paulo')::date) end as dias_desde_notificacao,
  rel.proximo_marco, rel.proximo_marco_em, rel.dias_restantes,
  exists (select 1 from public.protesto_remessas r where r.cobranca_id = c.id and r.tipo = 'apresentacao'
          and r.status <> 'rascunho') as tem_protesto,
  exists (select 1 from public.sinistros s where s.cobranca_id = c.id) as tem_sinistro,
  (c.processo_cnj is not null) as tem_processo,
  exists (select 1 from public.acordos a where a.cobranca_id = c.id and a.status = 'assinado') as tem_acordo
from public.cobrancas c
left join public.empresas e on e.id = c.sacado_empresa_id
left join public.usuarios u on u.id = c.responsavel_id
left join lateral (
  select count(*)::int as qtd_titulos,
         count(*) filter (where ct.situacao not in ('quitado', 'retirado'))::int as qtd_ativos,
         coalesce(sum(ct.valor_face_snapshot), 0) as valor_face,
         coalesce(sum(ct.valor_face_snapshot) filter (where ct.situacao not in ('quitado', 'retirado')), 0) as valor_em_aberto,
         count(distinct ct.sacado_cnpj_snapshot) filter (where ct.sacado_cnpj_snapshot <> c.sacado_matriz_cnpj)::int as qtd_spes,
         max(ct.dias_atraso_snapshot + (current_date - (c.criada_em at time zone 'America/Sao_Paulo')::date)) as max_dias_atraso,
         max(t.sacado_nome) filter (where t.sacado_cnpj = c.sacado_matriz_cnpj) as sacado_nome_matriz,
         max(t.sacado_nome) as sacado_nome_qualquer
  from public.cobranca_titulos ct
  join public.titulos t on t.id = ct.titulo_id
  where ct.cobranca_id = c.id
) tt on true
left join lateral (
  select r.proximo_marco, r.proximo_marco_em, r.dias_restantes
  from public.apolice_relogio r
  where r.cobranca_id = c.id
  order by r.proximo_marco_em
  limit 1
) rel on true;

grant select on public.cobranca_titulos_abertos, public.apolice_relogio, public.cobranca_cards to authenticated;
