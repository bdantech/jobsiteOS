-- ============================================================================
-- 0276 — Quem cobra olha o vencimento vigente; o relógio da apólice, o original
--
-- A 0275 contou o atraso a partir do vencimento ORIGINAL, e com isso 71 dos 127 títulos
-- "em atraso" eram prorrogações que ainda não tinham vencido na data acordada — pelo
-- vencimento vigente sobram 56, o mesmo número da produção. Decisão (29/09/2026):
--
--   • listas, nova cobrança, reconciliação, juros e a carta → vencimento VIGENTE
--     (`coalesce(vencimento_prorrogado, vencimento)`), com a folga de liquidação da 0275;
--   • relógio da apólice → vencimento ORIGINAL (cl. 16900.20: a prorrogação não desloca
--     a data da apólice, e passar de 60 dias corta a cobertura). O worker lê
--     `titulos.vencimento`, que não mudou de significado.
--
-- E na criação da cobrança o responsável é sempre quem cria.
-- ============================================================================

drop view if exists public.cobranca_titulos_abertos;
create view public.cobranca_titulos_abertos
with (security_invoker = true) as
select
  t.*,
  coalesce(t.vencimento_prorrogado, t.vencimento) as vencimento_vigente,
  greatest(0, t.valor_face - coalesce(t.valor_pago, 0)) as saldo_em_aberto,
  public.app__cobranca_liquidacao_esperada(coalesce(t.vencimento_prorrogado, t.vencimento)) as liquidacao_esperada,
  (current_date > public.app__cobranca_liquidacao_esperada(coalesce(t.vencimento_prorrogado, t.vencimento))) as em_atraso,
  case when current_date > public.app__cobranca_liquidacao_esperada(coalesce(t.vencimento_prorrogado, t.vencimento))
       then current_date - coalesce(t.vencimento_prorrogado, t.vencimento) else 0 end as dias_atraso,
  ct.cobranca_id as cobranca_ativa_id,
  c.codigo as cobranca_ativa_codigo,
  (t.sacado_cnpj = t.sacado_matriz_cnpj) as sacado_e_matriz
from public.titulos t
left join public.cobranca_titulos ct
  on ct.titulo_id = t.id and ct.situacao in ('em_cobranca', 'acordado', 'protestado', 'sinistrado')
left join public.cobrancas c on c.id = ct.cobranca_id
where t.status in ('aberto', 'parcial');

grant select on public.cobranca_titulos_abertos to authenticated;

-- ─── A reconciliação pelo vigente ───────────────────────────────────────────

create or replace function public.app_cobranca_reconciliacao(p_matrizes text[] default null)
returns table (
  sacado_matriz_cnpj text,
  aberto numeric,
  vencido numeric,
  a_vencer numeric,
  qtd_vencidos int,
  consumido numeric,
  consumido_em timestamptz,
  vencido_estimado numeric,
  situacao text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    perform public.app_cobranca_exige_modulo();
  end if;

  return query
  with titulos as (
    select t.sacado_matriz_cnpj,
           greatest(0, t.valor_face - coalesce(t.valor_pago, 0)) as saldo,
           current_date > public.app__cobranca_liquidacao_esperada(coalesce(t.vencimento_prorrogado, t.vencimento)) as atrasado
    from public.titulos t
    where t.status in ('aberto', 'parcial')
      and (p_matrizes is null or t.sacado_matriz_cnpj = any (p_matrizes))
  ),
  grupos as (
    select x.sacado_matriz_cnpj,
           sum(x.saldo) as aberto,
           coalesce(sum(x.saldo) filter (where x.atrasado), 0) as vencido,
           -- o que ainda está no prazo (ou compensando) continua consumindo limite
           coalesce(sum(x.saldo) filter (where not x.atrasado), 0) as a_vencer,
           (count(*) filter (where x.atrasado))::int as qtd_vencidos
    from titulos x
    group by x.sacado_matriz_cnpj
  ),
  plataforma as (
    select g.*,
           coalesce(co.consumed_limit, ap.consumed_limit) as consumido,
           case when co.consumed_limit is not null then co.atualizado_em end as consumido_em
    from grupos g
    left join public.clientes_onepay co on co.cnpj = g.sacado_matriz_cnpj
    left join lateral (
      select a.consumed_limit from public.analises_plataforma_atual a
      where a.cnpj = g.sacado_matriz_cnpj and a.consumed_limit is not null
      limit 1
    ) ap on true
  )
  select p.sacado_matriz_cnpj, p.aberto, p.vencido, p.a_vencer, p.qtd_vencidos,
         p.consumido, p.consumido_em,
         case when p.consumido is null then null
              else greatest(0, least(p.vencido, p.consumido - p.a_vencer)) end as vencido_estimado,
         case
           when p.vencido = 0 then 'sem_vencidos'
           when p.consumido is null then 'sem_dado'
           when greatest(0, least(p.vencido, p.consumido - p.a_vencer)) <= greatest(1000, 0.02 * p.vencido) then 'em_dia'
           when greatest(0, least(p.vencido, p.consumido - p.a_vencer)) >= p.vencido - greatest(1000, 0.02 * p.vencido) then 'confirma'
           else 'parcial'
         end as situacao
  from plataforma p;
end;
$$;

revoke all on function public.app_cobranca_reconciliacao(text[]) from public, anon;
grant execute on function public.app_cobranca_reconciliacao(text[]) to authenticated, service_role;

-- ─── Criar: vigente no prazo e no snapshot, e o responsável é quem cria ────

create or replace function public.app_cobranca_criar(p jsonb)
returns public.cobrancas
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_ids uuid[];
  v_grupos int;
  v_matriz text;
  v_empresa uuid;
  v_calc jsonb := public.app__cobranca_config('calculo');
  v_cfg jsonb := public.app__cobranca_config('cobranca');
  v_min int;
  v_c public.cobrancas;
  v_bad text;
begin
  perform public.app_cobranca_exige_modulo();

  select array_agg(distinct x::uuid) into v_ids from jsonb_array_elements_text(p -> 'titulo_ids') x;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'Selecione ao menos um título.' using errcode = '22023';
  end if;

  if (select count(*) from public.titulos where id = any (v_ids)) <> array_length(v_ids, 1) then
    raise exception 'Título não encontrado.' using errcode = 'P0002';
  end if;

  select count(distinct sacado_matriz_cnpj), min(sacado_matriz_cnpj)
    into v_grupos, v_matriz
  from public.titulos where id = any (v_ids);
  if v_grupos > 1 then
    raise exception 'A seleção tem títulos de grupos diferentes. Uma cobrança é sempre de um único sacado (matriz e SPEs).'
      using errcode = '22023';
  end if;

  select coalesce(t.numero, t.externo_id) into v_bad
  from public.titulos t where t.id = any (v_ids) and t.status not in ('aberto', 'parcial') limit 1;
  if v_bad is not null then
    raise exception 'O título % já foi pago na produção.', v_bad using errcode = '22023';
  end if;

  -- D+15 do vencimento VIGENTE: título prorrogado ainda não venceu para quem cobra.
  v_min := coalesce((v_cfg ->> 'dias_inicio_cobranca')::int, 15);
  select coalesce(t.numero, t.externo_id) into v_bad
  from public.titulos t where t.id = any (v_ids)
    and current_date - coalesce(t.vencimento_prorrogado, t.vencimento) < v_min limit 1;
  if v_bad is not null then
    raise exception 'O título % ainda não tem % dias de atraso. Até lá, a cobrança é da plataforma de produção.', v_bad, v_min
      using errcode = '22023';
  end if;

  select coalesce(c.codigo, c.id::text) into v_bad
  from public.cobranca_titulos ct join public.cobrancas c on c.id = ct.cobranca_id
  where ct.titulo_id = any (v_ids) and ct.situacao in ('em_cobranca', 'acordado', 'protestado', 'sinistrado')
  limit 1;
  if v_bad is not null then
    raise exception 'Há título já em cobrança ativa (%).', v_bad using errcode = '23505';
  end if;

  select sacado_empresa_id into v_empresa
  from public.titulos where id = any (v_ids) and sacado_empresa_id is not null
  order by (sacado_cnpj = sacado_matriz_cnpj) desc limit 1;

  insert into public.cobrancas (
    codigo, sacado_matriz_cnpj, sacado_empresa_id, escopo_notificacao, notificar_matriz_cedente,
    responsavel_id, juros_mora_mes, multa_pct, honorarios_pct, indice_correcao, juros_pro_rata,
    data_base, observacoes, criada_por)
  values (
    public.app__cobranca_codigo('COB'), v_matriz, v_empresa,
    coalesce(nullif(p ->> 'escopo_notificacao', ''), 'sacado'),
    coalesce((p ->> 'notificar_matriz_cedente')::boolean, true),
    -- Quem cria é o responsável — sempre. A troca, se precisar, é na cobrança já criada.
    v_ator,
    coalesce((p ->> 'juros_mora_mes')::numeric, (v_calc ->> 'juros_mora_mes')::numeric, 1),
    coalesce((p ->> 'multa_pct')::numeric, (v_calc ->> 'multa_pct')::numeric, 2),
    coalesce((p ->> 'honorarios_pct')::numeric, (v_calc ->> 'honorarios_pct')::numeric, 10),
    coalesce(nullif(p ->> 'indice_correcao', ''), v_calc ->> 'indice', 'igpm'),
    coalesce((p ->> 'juros_pro_rata')::boolean, (v_calc ->> 'juros_pro_rata')::boolean, true),
    coalesce(nullif(p ->> 'data_base', '')::date, current_date),
    nullif(btrim(p ->> 'observacoes'), ''),
    v_ator)
  returning * into v_c;

  -- O parcial entra pelo SALDO: é isso que se cobra, e é isso que vai na carta.
  insert into public.cobranca_titulos (
    cobranca_id, titulo_id, valor_face_snapshot, valor_cedido_snapshot, vencimento_snapshot,
    dias_atraso_snapshot, sacado_cnpj_snapshot, cedente_cnpj_snapshot)
  select v_c.id, t.id,
         case when t.status = 'parcial' then greatest(0, t.valor_face - coalesce(t.valor_pago, 0)) else t.valor_face end,
         -- O snapshot é o vencimento VIGENTE: é dele que a carta fala e dele que os juros
         -- da cobrança contam. O relógio da apólice lê o original em `titulos.vencimento`.
         t.valor_cedido, coalesce(t.vencimento_prorrogado, t.vencimento),
         greatest(0, current_date - coalesce(t.vencimento_prorrogado, t.vencimento)), t.sacado_cnpj, t.cedente_cnpj
  from public.titulos t where t.id = any (v_ids);

  update public.apolice_prazos set cobranca_id = v_c.id where titulo_id = any (v_ids) and status = 'ativo';

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_c.sacado_empresa_id, 'cobranca.criada', jsonb_build_object(
    'titulo', 'Cobrança ' || v_c.codigo || ' criada',
    'resumo', array_length(v_ids, 1) || ' título(s) selecionado(s) para cobrança extrajudicial.',
    'url', '/cobranca/cobrancas/' || v_c.id,
    'cobranca_id', v_c.id, 'codigo', v_c.codigo), v_ator);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'cobranca.criada', 'cobrancas', v_c.id::text,
          jsonb_build_object('titulos', to_jsonb(v_ids), 'escopo', v_c.escopo_notificacao));

  return v_c;
end;
$$;
