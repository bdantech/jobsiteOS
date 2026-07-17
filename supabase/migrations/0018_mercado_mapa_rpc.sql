-- O Mapa consultava mercado_explorador com count:'exact' (full scan de 760k linhas
-- largas, ~11s por camada) e amostras que forçavam um hash join de 878k métricas (~4s).
-- Com 876k linhas reais, as duas coisas estouram o statement_timeout de 8s do role
-- authenticated. Estas funções devolvem tudo que o Mapa precisa (4 totais + amostras)
-- em ~1s:
--   • contagem por camada via index-only scan (mercado_universo_camada_idx);
--   • amostra por camada LIMITANDO o universo ANTES de juntar métricas/empresa — a
--     junção vira nested-loop por PK sobre ~p_limite linhas, não hash de 878k.
-- (Era o "RPC app_mercado_mapa" prometido na nota de LIMITE_AMOSTRA em queries.ts.)

create or replace function mercado_amostra_camada(
  p_camada text,
  p_uf text,
  p_tipo text,
  p_limite int
)
returns jsonb
language sql
stable
security invoker
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
  p_uf text default null,
  p_tipo text default null,
  p_limite int default 250
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  contagens jsonb := '{}'::jsonb;
  resultado jsonb := '[]'::jsonb;
  rec record;
  cam text;
begin
  -- Caminho RÁPIDO sem filtro: o group-by limpo usa index-only scan (~1s). Com filtro
  -- parametrizado o planner cai num plano genérico (lento), então só entra ali quando
  -- há filtro de fato — e aí o conjunto é menor.
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

grant execute on function mercado_amostra_camada(text, text, text, int) to authenticated;
grant execute on function mercado_mapa(text, text, int) to authenticated;
