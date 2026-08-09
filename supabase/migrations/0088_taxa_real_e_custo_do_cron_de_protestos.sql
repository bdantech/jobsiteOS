-- ─────────────────────────────────────────────────────────────────────────────
-- A taxa que a empresa realmente paga, e o preço do cron mensal de protestos
--
-- Duas coisas sem relação entre si, no mesmo lugar porque as duas são sobre saber o
-- número ANTES de precisar dele.
--
-- §1 — `empresas.receita_taxa_am`. A receita prevista do Crédito multiplicava o volume
-- pela taxa PADRÃO (1,9% a.m.) para todo mundo, inclusive para as dezenas de empresas
-- cuja taxa real conhecemos — a `monthlyRateD0` que já precifica as notas delas no
-- funil da Antecipação. Na carteira de hoje a taxa real mediana é 2,5%: usar 1,9%
-- subestimava em um terço a receita justamente de quem já foi analisado.
--
-- §2 — `radar_custo_protestos_mensal()`. O cron do dia 5 consulta protesto de cada
-- cliente Onepay mais cada CNPJ marcado no monitoramento, tudo pelo provedor NACIONAL.
-- O custo era descobrível só depois, no extrato. Uma função só, usada pela tela
-- (aba Análise) e pelo aviso que o worker manda cinco dias antes — o número na tela
-- e o número do aviso têm de ser o mesmo, e duas contas divergiriam no primeiro
-- cliente novo.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── §1 A taxa usada na receita prevista ────────────────────────────────────

alter table public.empresas
  add column receita_taxa_am numeric(6, 3);

comment on column public.empresas.receita_taxa_am is
  'Taxa mensal (%) usada no cálculo de receita_mensal_prevista: a monthlyRateD0 da '
  'empresa quando conhecida, senão a padrão da config. Guardada pelo mesmo motivo de '
  'notas_fiscais.taxa_usada — sem ela a previsão de ontem não é auditável depois que '
  'a taxa muda.';

-- ─── §2 O custo do cron mensal de protestos ─────────────────────────────────
-- O conjunto é exatamente o que o job monta: clientes_onepay ∪ protesto_monitoramento,
-- deduplicado por CNPJ (uma SPE marcada que também é cliente é uma consulta só).

create or replace function public.radar_custo_protestos_mensal()
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  v_unit numeric;
  v_clientes int;
  v_monitoradas int;
  v_total int;
begin
  -- O gate é o mesmo do resto do Radar, com uma folga deliberada: `auth.uid()` nulo
  -- só acontece para o service_role, porque o grant abaixo exclui `anon`. É o worker
  -- chamando para montar o aviso — sem isso ele teria que refazer a conta por fora,
  -- e é a conta duplicada que diverge no primeiro cliente novo.
  if auth.uid() is not null and not public.app_tem_modulo('radar') then
    return jsonb_build_object('tem_acesso', false);
  end if;

  select coalesce((valor ->> 'protesto_nacional')::numeric, 3.5) into v_unit
  from public.radar_config where chave = 'custos';
  v_unit := coalesce(v_unit, 3.5);

  select count(*) into v_clientes from public.clientes_onepay;

  -- Só as marcadas que NÃO são cliente: são elas que somam consulta ao lote.
  select count(*) into v_monitoradas
  from public.protesto_monitoramento pm
  where not exists (select 1 from public.clientes_onepay c where c.cnpj = pm.cnpj);

  v_total := v_clientes + v_monitoradas;

  return jsonb_build_object(
    'tem_acesso', true,
    'clientes', v_clientes,
    'monitoradas', v_monitoradas,
    'consultas', v_total,
    'custo_unitario', v_unit,
    'custo_total', round(v_total * v_unit, 2),
    -- O teto mensal do Radar inteiro, não só destes protestos: é contra ele que o
    -- lote é barrado, então mostrar o custo sem ele conta metade da história.
    'teto_mensal', (select (valor ->> 'teto_mensal_total')::numeric
                    from public.radar_config where chave = 'orcamento')
  );
end $function$;

revoke execute on function public.radar_custo_protestos_mensal() from public;
grant execute on function public.radar_custo_protestos_mensal() to authenticated, service_role;

comment on function public.radar_custo_protestos_mensal is
  'Quantas consultas o cron mensal de protestos vai fazer (clientes Onepay + CNPJs '
  'monitorados, sem repetir) e quanto isso custa pelo provedor nacional. Uma conta '
  'só, para a tela e para o aviso de cinco dias antes.';
