-- A RPC mercado_mapa (0018) era security invoker: sob o role authenticated, a política
-- RLS (app_tem_modulo) era aplicada a cada tabela e derrubava o index-only scan, deixando
-- a consulta 8x mais lenta e estourando o statement_timeout de 8s. Passa a SECURITY
-- DEFINER (roda como dona, sem RLS por linha → ~1s), com a checagem de acesso ao módulo
-- feita UMA vez no topo — o mesmo portão que a RLS dava, agora explícito. A helper sai
-- do alcance direto do authenticated (só mercado_mapa, que já checa, a chama).

create or replace function mercado_amostra_camada(
  p_camada text, p_uf text, p_tipo text, p_limite int
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb)
  from (
    select
      u.uf, u.porte_rfb, e.tipo, u.capital_social, u.data_inicio_atividade,
      e.erp_atual, coalesce(m.tem_contato, false) as tem_contato, u.grafo_sefaz,
      u.grupo_id, coalesce(m.grupo_spes_total, 0) as grupo_spes_total,
      coalesce(m.obras_ativas, 0) as obras_ativas,
      coalesce(m.m2_em_execucao, 0) as m2_em_execucao
    from (
      select u2.cnpj, u2.uf, u2.porte_rfb, u2.capital_social,
             u2.data_inicio_atividade, u2.grafo_sefaz, u2.grupo_id, u2.empresa_id
      from public.mercado_universo u2
      where u2.camada = p_camada
        and (p_uf is null or u2.uf = p_uf)
        and (p_tipo is null or exists (
          select 1 from public.empresas e2 where e2.id = u2.empresa_id and e2.tipo = p_tipo
        ))
      limit p_limite
    ) u
    left join public.mercado_metricas m on m.cnpj = u.cnpj
    left join public.empresas e on e.id = u.empresa_id
  ) l;
$$;

create or replace function mercado_mapa(
  p_uf text default null, p_tipo text default null, p_limite int default 250
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  contagens jsonb := '{}'::jsonb;
  resultado jsonb := '[]'::jsonb;
  rec record;
  cam text;
begin
  if not public.app_tem_modulo('mercado') then
    raise exception 'Sem acesso ao módulo Mercado.' using errcode = '42501';
  end if;

  if p_uf is null and p_tipo is null then
    for rec in
      select u.camada as c, count(*)::bigint as t
      from public.mercado_universo u group by u.camada
    loop
      contagens := jsonb_set(contagens, array[rec.c], to_jsonb(rec.t));
    end loop;
  else
    for rec in
      select u.camada as c, count(*)::bigint as t
      from public.mercado_universo u
      where (p_uf is null or u.uf = p_uf)
        and (p_tipo is null or exists (
          select 1 from public.empresas e where e.id = u.empresa_id and e.tipo = p_tipo
        ))
      group by u.camada
    loop
      contagens := jsonb_set(contagens, array[rec.c], to_jsonb(rec.t));
    end loop;
  end if;

  foreach cam in array array['universo','tam','sam','som'] loop
    resultado := resultado || jsonb_build_array(jsonb_build_object(
      'camada', cam,
      'total', coalesce((contagens ->> cam)::bigint, 0),
      'linhas', public.mercado_amostra_camada(cam, p_uf, p_tipo, p_limite)
    ));
  end loop;

  return resultado;
end;
$$;

revoke all on function mercado_amostra_camada(text, text, text, int) from public, authenticated;
grant execute on function mercado_mapa(text, text, int) to authenticated;
