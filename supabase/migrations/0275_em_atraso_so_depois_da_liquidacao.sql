-- ============================================================================
-- 0275 — Em atraso só depois da liquidação esperada
--
-- O boleto pago em dia só aparece liquidado no dia útil SEGUINTE ao pagamento, e o
-- vencimento em fim de semana ou feriado bancário só é pago no primeiro dia útil:
--
--   vence segunda  → paga segunda → liquida terça  → em atraso a partir de quarta
--   vence sábado   → paga segunda → liquida terça  → em atraso a partir de quarta
--   vence sexta    → paga sexta   → liquida segunda → em atraso a partir de terça
--
-- Até aqui a lista chamava de vencido tudo com `vencimento < hoje`: o boleto de sábado
-- aparecia atrasado no domingo, e o de ontem — pago e ainda compensando — também.
--
-- Isto muda o que as LISTAS chamam de vencido (a view, a reconciliação e, no worker e
-- nas tools, `emAtraso` do core). Não muda prazo nenhum: o relógio da apólice e os juros
-- continuam contando do vencimento original (cl. 16900.20), e a entrada em cobrança
-- continua em D+15 do vencimento.
--
-- Os feriados são os bancários nacionais — os mesmos de `feriadosBancarios`
-- (packages/core/src/cobranca/datas.ts). As duas listas precisam andar juntas: a tela lê
-- daqui, o worker e as tools leem de lá.
-- ============================================================================

create or replace function public.app__cobranca_pascoa(p_ano int)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  a int := p_ano % 19;
  b int := p_ano / 100;
  c int := p_ano % 100;
  d int; e int; f int; g int; h int; i int; k int; l int; m int;
begin
  d := b / 4; e := b % 4; f := (b + 8) / 25; g := (b - f + 1) / 3;
  h := (19 * a + b - d - g + 15) % 30;
  i := c / 4; k := c % 4;
  l := (32 + 2 * e + 2 * i - h - k) % 7;
  m := (a + 11 * h + 22 * l) / 451;
  return make_date(p_ano, (h + l - 7 * m + 114) / 31, ((h + l - 7 * m + 114) % 31) + 1);
end;
$$;

create or replace function public.app__cobranca_dia_util(p date)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_pascoa date;
begin
  if extract(isodow from p) >= 6 then
    return false;
  end if;
  if to_char(p, 'MM-DD') in ('01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25') then
    return false;
  end if;
  v_pascoa := public.app__cobranca_pascoa(extract(year from p)::int);
  -- carnaval (segunda e terça), sexta-feira santa, Corpus Christi: o banco fecha
  return p not in (v_pascoa - 48, v_pascoa - 47, v_pascoa - 2, v_pascoa + 60);
end;
$$;

create or replace function public.app__cobranca_proximo_dia_util(p date)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v date := p;
begin
  while not public.app__cobranca_dia_util(v) loop
    v := v + 1;
  end loop;
  return v;
end;
$$;

/** Paga no vencimento (ou no dia útil seguinte), compensa no dia útil depois disso. */
create or replace function public.app__cobranca_liquidacao_esperada(p_vencimento date)
returns date
language sql
immutable
set search_path = ''
as $$
  select public.app__cobranca_proximo_dia_util(public.app__cobranca_proximo_dia_util(p_vencimento) + 1);
$$;

grant execute on function public.app__cobranca_pascoa(int) to authenticated, service_role;
grant execute on function public.app__cobranca_dia_util(date) to authenticated, service_role;
grant execute on function public.app__cobranca_proximo_dia_util(date) to authenticated, service_role;
grant execute on function public.app__cobranca_liquidacao_esperada(date) to authenticated, service_role;

-- ─── A view: `dias_atraso` só conta depois da liquidação esperada ───────────

drop view if exists public.cobranca_titulos_abertos;
create view public.cobranca_titulos_abertos
with (security_invoker = true) as
select
  t.*,
  greatest(0, t.valor_face - coalesce(t.valor_pago, 0)) as saldo_em_aberto,
  public.app__cobranca_liquidacao_esperada(t.vencimento) as liquidacao_esperada,
  (current_date > public.app__cobranca_liquidacao_esperada(t.vencimento)) as em_atraso,
  -- Conta do vencimento (é o atraso de verdade), mas é zero enquanto o boleto ainda pode
  -- estar compensando.
  case when current_date > public.app__cobranca_liquidacao_esperada(t.vencimento)
       then current_date - t.vencimento else 0 end as dias_atraso,
  ct.cobranca_id as cobranca_ativa_id,
  c.codigo as cobranca_ativa_codigo,
  (t.sacado_cnpj = t.sacado_matriz_cnpj) as sacado_e_matriz
from public.titulos t
left join public.cobranca_titulos ct
  on ct.titulo_id = t.id and ct.situacao in ('em_cobranca', 'acordado', 'protestado', 'sinistrado')
left join public.cobrancas c on c.id = ct.cobranca_id
where t.status in ('aberto', 'parcial');

grant select on public.cobranca_titulos_abertos to authenticated;

-- ─── A reconciliação: vencido = em atraso ───────────────────────────────────

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
           current_date > public.app__cobranca_liquidacao_esperada(t.vencimento) as atrasado
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

-- ─── O relógio: título ainda compensando não tem prazo ativo ────────────────
-- O worker passa a criar prazo só para título em atraso. O que ele já tenha criado para
-- título ainda dentro da compensação — sem cobrança, sem sinistro, sem aviso — sai; volta
-- no dia em que o título entrar em atraso, com as mesmas datas (elas contam do vencimento).
delete from public.apolice_prazos ap
using public.titulos t
where t.id = ap.titulo_id
  and ap.status = 'ativo'
  and ap.cobranca_id is null
  and ap.sinistro_id is null
  and ap.alertas_emitidos = '{}'::jsonb
  and current_date <= public.app__cobranca_liquidacao_esperada(t.vencimento);
