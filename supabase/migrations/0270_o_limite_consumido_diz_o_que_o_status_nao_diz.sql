-- ============================================================================
-- 0270 — O limite consumido diz o que o status da produção não diz
--
-- Divide o número com as 0270a–f dos agentes (aplicadas em paralelo, sem saber uma da
-- outra) — como já acontece com 0247 e 0248. São independentes: nenhuma toca objeto
-- da outra, e a ordem entre elas não importa.
--
-- ── O DEFEITO ───────────────────────────────────────────────────────────────
-- A produção deixa a antecipação em `BILLET_SWAPPED` depois que o sacado paga, e
-- quase nunca marca `CONCLUDED` (34 em 1.325 em 28/09/2026). A projeção `titulos`
-- (0269c) só sabe o que o status diz — então todo título que venceu aparecia como
-- vencido em aberto, pago ou não, e o wizard oferecia para cobrança o que o
-- sacado já tinha pago.
--
-- ── O SINAL QUE EXISTE ──────────────────────────────────────────────────────
-- O limite CONSUMIDO do sacado na plataforma (`clientes_onepay.consumed_limit`,
-- atualizado todo dia pelo radar/onepay) sobe na cessão e desce na liquidação. Ele
-- fica na matriz — as SPEs não têm linha própria —, então cobre o grupo inteiro,
-- que é exatamente o `sacado_matriz_cnpj` da projeção. Medido em 28/09:
--
--   ENGEFY        a vencer R$ 678 mil · consumido R$ 675 mil → vencido real ≈ 0
--   CASA ORANGE   a vencer 0          · consumido 0          → vencido real = 0
--   PLANOVA       a vencer R$ 15,9 mi · consumido R$ 21,4 mi → vencido real ≈ R$ 5,5 mi
--
-- Logo: vencido realmente em aberto ≈ consumido − a vencer, limitado a [0, vencido].
--
-- ── O QUE ELE NÃO DIZ ───────────────────────────────────────────────────────
-- QUAIS títulos foram pagos. A estimativa é do GRUPO, e a tela a mostra como tal:
-- nenhum título vira "pago" por inferência. Quando a estimativa é ~0 (grupo em dia
-- pela plataforma), os vencidos saem marcados "provavelmente pago" e só entram numa
-- cobrança com confirmação explícita — e o relógio da apólice não alerta por eles.
--
-- A projeção pode estar um pouco atrás da plataforma (ela roda depois do sync de
-- antecipações; o consumido é de hoje). Cessões novas que ainda não estão em
-- `titulos` aumentam o consumido sem aumentar o "a vencer" — o erro vai para o
-- lado conservador: estima MAIS vencido em aberto, nunca menos.
--
-- Tolerância de "em dia": até R$ 1.000 ou 2% do vencido (o que for maior) — arredondamento
-- de IR retido e defasagem de um dia entre os dois lados, não dívida.
-- ============================================================================

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
  -- `clientes_onepay` é do Radar; quem lê isto é quem tem Cobrança, ou o worker.
  if coalesce(auth.role(), '') <> 'service_role' then
    perform public.app_cobranca_exige_modulo();
  end if;

  return query
  with grupos as (
    select t.sacado_matriz_cnpj,
           sum(t.valor_face) as aberto,
           coalesce(sum(t.valor_face) filter (where t.vencimento < current_date), 0) as vencido,
           coalesce(sum(t.valor_face) filter (where t.vencimento >= current_date), 0) as a_vencer,
           (count(*) filter (where t.vencimento < current_date))::int as qtd_vencidos
    from public.titulos t
    where t.status = 'aberto'
      and (p_matrizes is null or t.sacado_matriz_cnpj = any (p_matrizes))
    group by t.sacado_matriz_cnpj
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

comment on function public.app_cobranca_reconciliacao(text[]) is
  'Vencido realmente em aberto por grupo, estimado pelo limite consumido na plataforma (0270). '
  'situacao: em_dia | parcial | confirma | sem_dado | sem_vencidos. Estimativa do GRUPO, não por título.';
