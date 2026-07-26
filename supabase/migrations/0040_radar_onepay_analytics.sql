-- 0040 — Agregados dos clientes Onepay para a aba Análise (menu Empresas): por região
-- do Brasil, por camada (SOM/SAM/TAM/universo) e por faixa de capital social. Os três
-- vêm de um join clientes_onepay → mercado_universo por CNPJ (clientes_onepay não tem
-- uf/camada/capital). SECURITY DEFINER com gate no Radar (dono do dado); junta como owner
-- para não esbarrar na RLS de mercado_universo. Camada só conta quem está no universo;
-- os demais são a nota "fora do universo" (total − soma das camadas), no cliente.
create or replace function public.radar_onepay_analytics()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if not public.app_tem_modulo('radar') then
    return jsonb_build_object('tem_acesso', false);
  end if;

  with base as (
    select c.cnpj, u.uf, u.camada, u.capital_social
    from public.clientes_onepay c
    left join public.mercado_universo u on u.cnpj = c.cnpj
  ),
  regiao as (
    select case
      when uf in ('AC','AP','AM','PA','RO','RR','TO') then 'norte'
      when uf in ('AL','BA','CE','MA','PB','PE','PI','RN','SE') then 'nordeste'
      when uf in ('DF','GO','MT','MS') then 'centro_oeste'
      when uf in ('ES','MG','RJ','SP') then 'sudeste'
      when uf in ('PR','RS','SC') then 'sul'
      else 'sem_uf' end as regiao,
      count(*)::int as n
    from base group by 1
  ),
  cam as (
    select camada, count(*)::int as n
    from base where camada is not null group by 1
  ),
  cap as (
    select case
      when capital_social is null then 'sem_dado'
      when capital_social < 500000 then 'f1'
      when capital_social < 2000000 then 'f2'
      when capital_social < 5000000 then 'f3'
      when capital_social < 10000000 then 'f4'
      when capital_social < 20000000 then 'f5'
      when capital_social < 50000000 then 'f6'
      when capital_social < 100000000 then 'f7'
      else 'f8' end as faixa,
      count(*)::int as n
    from base group by 1
  )
  select jsonb_build_object(
    'tem_acesso', true,
    'total', (select count(*)::int from base),
    'por_regiao', (select coalesce(jsonb_object_agg(regiao, n), '{}'::jsonb) from regiao),
    'por_camada', (select coalesce(jsonb_object_agg(camada, n), '{}'::jsonb) from cam),
    'por_capital', (select coalesce(jsonb_object_agg(faixa, n), '{}'::jsonb) from cap)
  ) into v;
  return v;
end $$;

revoke execute on function public.radar_onepay_analytics() from public;
grant execute on function public.radar_onepay_analytics() to authenticated;
