-- 0036 — Análise financeira na ficha da empresa: protesto atual da empresa,
-- total somado do grupo econômico (últimos snapshots de cada CNPJ) e o histórico
-- de consultas. Os dados de protesto são do módulo Radar (RLS de protestos_consultas),
-- então o RPC é SECURITY DEFINER com gate no topo, como radar_cobertura (0032).
-- Sem o módulo: devolve { tem_acesso: false } (a aba mostra um estado amigável,
-- nunca um erro), em vez de 42501.
create or replace function public.empresa_analise_financeira(p_empresa_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_cnpj text;
  v_grupo_id uuid;
  v_atual jsonb;
  v_grupo jsonb;
  v_historico jsonb;
begin
  -- O protesto é dado do Radar; sem o módulo, nada a mostrar (sem vazar existência).
  if not public.app_tem_modulo('radar') then
    return jsonb_build_object('tem_acesso', false);
  end if;

  select cnpj, grupo_id into v_cnpj, v_grupo_id
  from public.empresas where id = p_empresa_id;

  -- Empresa inexistente ou fora do alcance de RLS de quem chama: resposta vazia,
  -- não um erro (o mesmo silêncio da ficha para um id que o usuário não pode ver).
  if v_cnpj is null then
    return jsonb_build_object('tem_acesso', true, 'atual', null, 'grupo', null, 'historico', '[]'::jsonb);
  end if;

  -- Estado atual da própria empresa: o último snapshot (protestos_atual = distinct on cnpj).
  select to_jsonb(a) into v_atual from (
    select tem_protesto, qtd_protestos, valor_total, consultado_em, fonte, cartorios
    from public.protestos_atual where cnpj = v_cnpj
  ) a;

  -- Total do grupo: soma dos ÚLTIMOS snapshots de cada CNPJ do grupo (inclui a própria).
  if v_grupo_id is not null then
    select jsonb_build_object(
      'valor_total', coalesce(sum(pa.valor_total), 0),
      'qtd_protestos', coalesce(sum(pa.qtd_protestos), 0)::int,
      'qtd_empresas_com_protesto', count(*) filter (where pa.tem_protesto)::int,
      'qtd_empresas_consultadas', count(*)::int
    ) into v_grupo
    from public.protestos_atual pa
    join public.mercado_universo u on u.cnpj = pa.cnpj
    where u.grupo_id = v_grupo_id;
  else
    v_grupo := null;
  end if;

  -- Histórico de consultas da empresa (append-only, mais recente primeiro).
  select coalesce(jsonb_agg(to_jsonb(h) order by h.consultado_em desc), '[]'::jsonb) into v_historico
  from (
    select consultado_em, fonte, tem_protesto, qtd_protestos, valor_total, cartorios
    from public.protestos_consultas where cnpj = v_cnpj
    order by consultado_em desc limit 100
  ) h;

  return jsonb_build_object(
    'tem_acesso', true,
    'cnpj', v_cnpj,
    'atual', v_atual,
    'grupo', v_grupo,
    'historico', v_historico
  );
end; $$;

revoke execute on function public.empresa_analise_financeira(uuid) from public;
grant execute on function public.empresa_analise_financeira(uuid) to authenticated;
