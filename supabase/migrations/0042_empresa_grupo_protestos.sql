-- 0042 — Último snapshot de protesto de cada empresa do grupo econômico (com cartorios,
-- para o cliente extrair os protestos individuais). Alimenta o diálogo "protestos do
-- grupo" na aba Análise financeira: lista com a empresa que recebeu o protesto, gráfico
-- no tempo e gráfico de valor por empresa. SECURITY DEFINER com gate no Radar; junta
-- protestos_atual → mercado_universo → empresas como owner.
create or replace function public.empresa_grupo_protestos(p_empresa_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_grupo uuid;
  v jsonb;
begin
  if not public.app_tem_modulo('radar') then
    return jsonb_build_object('tem_acesso', false);
  end if;

  select grupo_id into v_grupo from public.empresas where id = p_empresa_id;
  if v_grupo is null then
    return jsonb_build_object('tem_acesso', true, 'empresas', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.valor_total desc nulls last), '[]'::jsonb) into v
  from (
    select
      pa.cnpj,
      u.empresa_id,
      coalesce(e.razao_social, u.razao_social, pa.cnpj) as nome,
      pa.valor_total,
      pa.qtd_protestos,
      pa.consultado_em,
      pa.fonte,
      pa.cartorios
    from public.protestos_atual pa
    join public.mercado_universo u on u.cnpj = pa.cnpj
    left join public.empresas e on e.id = u.empresa_id
    where u.grupo_id = v_grupo and pa.tem_protesto
  ) t;

  return jsonb_build_object('tem_acesso', true, 'empresas', v);
end $$;

revoke execute on function public.empresa_grupo_protestos(uuid) from public;
grant execute on function public.empresa_grupo_protestos(uuid) to authenticated;
