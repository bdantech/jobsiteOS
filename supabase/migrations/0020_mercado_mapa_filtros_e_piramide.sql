-- O caminho FILTRADO do Mapa usava (p_uf is null or uf = p_uf), cujo OR derruba os
-- índices e força seq scan de 876k (~5,6s por camada) — daí o Mapa filtrado e a aba
-- Camadas quebrarem. Reescrevo com SQL dinâmico: o filtro só entra quando existe, como
-- literal, então o planner usa os índices compostos → ~200ms. E a aba Camadas ganha a
-- sua própria RPC leve (mercado_piramide).

-- Índices compostos para os counts/amostras filtrados por UF.
create index if not exists mercado_universo_camada_uf_idx on mercado_universo (camada, uf);
create index if not exists mercado_universo_uf_camada_idx on mercado_universo (uf, camada);

-- ── Amostra de uma camada, filtros opcionais via SQL dinâmico ──────────────────
create or replace function mercado_amostra_camada(
  p_camada text, p_uf text, p_tipo text, p_limite int
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  filtro text := '';
  result jsonb;
begin
  if p_uf is not null then
    filtro := filtro || format(' and u2.uf = %L', p_uf);
  end if;
  if p_tipo is not null then
    filtro := filtro || format(
      ' and exists (select 1 from public.empresas e2 where e2.id = u2.empresa_id and e2.tipo = %L)',
      p_tipo);
  end if;

  execute format($q$
    select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb)
    from (
      select u.uf, u.porte_rfb, e.tipo, u.capital_social, u.data_inicio_atividade,
             e.erp_atual, coalesce(m.tem_contato, false) as tem_contato, u.grafo_sefaz,
             u.grupo_id, coalesce(m.grupo_spes_total, 0) as grupo_spes_total,
             coalesce(m.obras_ativas, 0) as obras_ativas,
             coalesce(m.m2_em_execucao, 0) as m2_em_execucao
      from (
        select u2.cnpj, u2.uf, u2.porte_rfb, u2.capital_social, u2.data_inicio_atividade,
               u2.grafo_sefaz, u2.grupo_id, u2.empresa_id
        from public.mercado_universo u2
        where u2.camada = %L %s
        limit %s
      ) u
      left join public.mercado_metricas m on m.cnpj = u.cnpj
      left join public.empresas e on e.id = u.empresa_id
    ) l
  $q$, p_camada, filtro, p_limite) into result;

  return result;
end;
$$;

-- ── Mapa: contagens (SQL dinâmico, sem OR) + amostras ─────────────────────────
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
  filtro text := '';
  contagens jsonb;
  resultado jsonb := '[]'::jsonb;
  cam text;
begin
  if not public.app_tem_modulo('mercado') then
    raise exception 'Sem acesso ao módulo Mercado.' using errcode = '42501';
  end if;

  if p_uf is not null then
    filtro := filtro || format(' and u.uf = %L', p_uf);
  end if;
  if p_tipo is not null then
    filtro := filtro || format(
      ' and exists (select 1 from public.empresas e where e.id = u.empresa_id and e.tipo = %L)',
      p_tipo);
  end if;

  execute format($q$
    select coalesce(jsonb_object_agg(camada, t), '{}'::jsonb)
    from (
      select u.camada, count(*)::bigint as t
      from public.mercado_universo u
      where true %s
      group by u.camada
    ) x
  $q$, filtro) into contagens;

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

-- ── Pirâmide (aba Camadas): contagens do universo + sem_camada ────────────────
create or replace function mercado_piramide()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  contagens jsonb;
  total bigint;
  sem_camada bigint;
begin
  if not public.app_tem_modulo('mercado') then
    raise exception 'Sem acesso ao módulo Mercado.' using errcode = '42501';
  end if;

  select coalesce(jsonb_object_agg(camada, t), '{}'::jsonb), coalesce(sum(t), 0)
  from (
    select u.camada, count(*)::bigint as t from public.mercado_universo u group by u.camada
  ) x
  into contagens, total;

  select count(*)::bigint into sem_camada
  from public.empresas e
  where e.origem = 'lista' and e.camada is null
    and not exists (select 1 from public.mercado_universo u where u.cnpj = e.cnpj);

  return jsonb_build_object('por_camada', contagens, 'total', total, 'sem_camada', sem_camada);
end;
$$;

revoke all on function mercado_amostra_camada(text, text, text, int) from public, authenticated;
grant execute on function mercado_mapa(text, text, int) to authenticated;
grant execute on function mercado_piramide() to authenticated;
