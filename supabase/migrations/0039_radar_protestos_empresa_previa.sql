-- 0039 — Prévia (contagem + custo) para rodar protestos de uma empresa + SPEs do grupo,
-- a partir da aba Análise financeira da ficha. SECURITY DEFINER com gate no Radar (dono
-- do dado e do custo). O worker resolve o MESMO conjunto na execução (jobs/radar/protestos.ts,
-- protestosEmpresa); aqui é só a estimativa que o botão mostra ANTES de gastar.
create or replace function public.radar_protestos_empresa_previa(
  p_empresa_id uuid,
  p_incluir_spes boolean,
  p_ano_min int
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_cnpj text;
  v_grupo uuid;
  v_qtd int;
  v_custo_unit numeric;
begin
  if not public.app_tem_modulo('radar') then
    return jsonb_build_object('tem_acesso', false);
  end if;

  select cnpj, grupo_id into v_cnpj, v_grupo from public.empresas where id = p_empresa_id;
  if v_cnpj is null then
    return jsonb_build_object('tem_acesso', true, 'qtd', 0, 'custo_estimado', 0);
  end if;

  -- Conjunto: a própria empresa + (opcional) SPEs ATIVAS do grupo criadas a partir do ano.
  -- data_inicio_atividade nula fica de fora quando há filtro de ano (year >= p_ano_min é nulo).
  with alvo as (
    select v_cnpj as cnpj
    union
    select u.cnpj
    from public.mercado_universo u
    where p_incluir_spes and v_grupo is not null
      and u.grupo_id = v_grupo and u.is_spe and u.situacao_cadastral = 'ativa'
      and (p_ano_min is null or extract(year from u.data_inicio_atividade) >= p_ano_min)
  )
  select count(*) into v_qtd from alvo;

  select coalesce((valor ->> 'protesto_nacional')::numeric, 3.5) into v_custo_unit
  from public.radar_config where chave = 'custos';
  v_custo_unit := coalesce(v_custo_unit, 3.5);

  return jsonb_build_object(
    'tem_acesso', true,
    'qtd', v_qtd,
    'custo_estimado', round(v_qtd * v_custo_unit, 2)
  );
end $$;

revoke execute on function public.radar_protestos_empresa_previa(uuid, boolean, int) from public;
grant execute on function public.radar_protestos_empresa_previa(uuid, boolean, int) to authenticated;
