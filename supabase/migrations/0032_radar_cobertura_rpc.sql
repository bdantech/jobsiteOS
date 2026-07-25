-- 0032 — Radar: RPC de cobertura de enriquecimento por camada
-- security definer + gate no topo (como mercado_piramide): agrega como owner para
-- os índices valerem, e conta uma vez com semi-joins às tabelas pequenas.
create or replace function public.radar_cobertura()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  if not public.app_tem_modulo('radar') then
    raise exception 'Sem acesso ao módulo Radar.' using errcode = '42501';
  end if;

  select jsonb_agg(row_to_json(t)) into v from (
    select
      u.camada,
      count(*)::int as total,
      count(*) filter (where coalesce(e.dominio, u.dominio) is not null)::int as com_dominio,
      count(*) filter (
        where u.empresa_id in (select distinct empresa_id from public.contatos where empresa_id is not null)
      )::int as com_contato,
      count(*) filter (
        where u.cnpj in (select distinct cnpj from public.protestos_consultas)
      )::int as com_protesto
    from public.mercado_universo u
    left join public.empresas e on e.id = u.empresa_id
    group by u.camada
  ) t;

  return coalesce(v, '[]'::jsonb);
end; $$;

revoke execute on function public.radar_cobertura() from public;
grant execute on function public.radar_cobertura() to authenticated;
