-- =============================================================================
-- 0064 — Certificados: ocultar cliente, corte de SPE antiga e crédito no grid
--
-- Quatro mudanças pedidas depois do primeiro uso real:
--
-- 1. A tabela passa a guardar CNPJ oculto de QUALQUER natureza — SPE ou cliente.
--    Ocultar um cliente serve para quem não se pretende cobrar certificado, e ele
--    sai também das estatísticas (senão o denominador continuaria punindo a
--    cobertura por uma empresa que ninguém vai atrás). O nome antigo
--    (`certificados_spe_ocultas`) mentiria a partir daqui.
--
-- 2. SPE aberta há mais de 10 anos some do grid SOZINHA. Obra encerrada mantém o
--    CNPJ vivo na Receita, e ninguém renova certificado dela. É regra, não decisão
--    de alguém — por isso não ocupa linha na tabela de ocultos. Na base atual isso
--    corta 27 das 744 SPEs.
--
-- 3. `available_limit` e `credit_limit` do cliente entram no retorno: é o crédito
--    que decide se vale correr atrás do certificado, já que cliente sem limite não
--    opera nem com certificado em dia.
--
-- 4. Ocultar deixa de recusar a matriz — era proibido em 0063, e virou caso de uso.
-- =============================================================================

alter table if exists certificados_spe_ocultas rename to certificados_ocultos;

comment on table certificados_ocultos is
  'CNPJs escondidos do grid de certificados — SPEs inativas e clientes de quem não se '
  'pretende obter certificado. Preferência global do time, e ficam FORA das estatísticas.';

drop policy if exists certificados_spe_ocultas_select on certificados_ocultos;
drop policy if exists certificados_spe_ocultas_insert on certificados_ocultos;
drop policy if exists certificados_spe_ocultas_delete on certificados_ocultos;

drop policy if exists certificados_ocultos_select on certificados_ocultos;
create policy certificados_ocultos_select on certificados_ocultos
  for select to authenticated using (app_tem_modulo('empresas'));
drop policy if exists certificados_ocultos_insert on certificados_ocultos;
create policy certificados_ocultos_insert on certificados_ocultos
  for insert to authenticated
  with check (app_tem_modulo('empresas') and (oculto_por = auth.uid() or oculto_por is null));
drop policy if exists certificados_ocultos_delete on certificados_ocultos;
create policy certificados_ocultos_delete on certificados_ocultos
  for delete to authenticated using (app_tem_modulo('empresas'));

-- ─── Ocultar deixa de recusar a matriz ──────────────────────────────────────
create or replace function app_ocultar_spe_certificado(p_cnpj text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_cnpj text := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g');
begin
  if not public.app_tem_modulo('empresas') then
    raise exception 'Sem acesso ao módulo Empresas.' using errcode = '42501';
  end if;
  if v_cnpj !~ '^[0-9]{14}$' then
    raise exception 'CNPJ inválido.' using errcode = '22023';
  end if;

  insert into public.certificados_ocultos (cnpj, oculto_por)
  values (v_cnpj, auth.uid())
  on conflict (cnpj) do nothing;

  return jsonb_build_object('cnpj', v_cnpj, 'oculto', true);
end $$;

create or replace function app_reexibir_spe_certificado(p_cnpj text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_cnpj text := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g');
begin
  if not public.app_tem_modulo('empresas') then
    raise exception 'Sem acesso ao módulo Empresas.' using errcode = '42501';
  end if;
  delete from public.certificados_ocultos where cnpj = v_cnpj;
  return jsonb_build_object('cnpj', v_cnpj, 'oculto', false);
end $$;

-- ─── O grid: corte de 10 anos, cliente oculto e crédito ─────────────────────
create or replace function certificados_grid()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_clientes jsonb;
  v_ocultas jsonb;
  v_total_ativos int;
  -- SPE aberta há mais de 10 anos é quase sempre obra encerrada: o CNPJ segue vivo na
  -- Receita, mas ninguém vai renovar certificado dela. Some do grid automaticamente,
  -- sem ocupar linha na tabela de ocultos — é regra, não decisão de alguém.
  v_idade_max interval := interval '10 years';
begin
  if not public.app_tem_modulo('empresas') then
    return jsonb_build_object('tem_acesso', false);
  end if;

  select coalesce(jsonb_agg(to_jsonb(c) order by c.razao_social), '[]'::jsonb) into v_clientes
  from (
    select
      e.id as empresa_id,
      e.cnpj,
      coalesce(e.razao_social, e.nome_fantasia, e.cnpj) as razao_social,
      e.nome_fantasia,
      co.available_limit as credito_disponivel,
      co.credit_limit as credito_limite,
      to_jsonb(cm.*) - 'expires_at_anterior' - 'ultimo_alerta' as certificado,
      coalesce((
        select jsonb_agg(to_jsonb(s) order by s.razao_social)
        from (
          select
            u.cnpj,
            coalesce(u.nome_fantasia, u.razao_social, u.cnpj) as razao_social,
            u.empresa_id,
            u.data_inicio_atividade,
            to_jsonb(cs.*) - 'expires_at_anterior' - 'ultimo_alerta' as certificado
          from public.mercado_universo u
          left join public.certificados cs on cs.cnpj = u.cnpj
          where u.grupo_id = e.grupo_id
            and u.is_spe
            and u.cnpj <> e.cnpj
            and (u.data_inicio_atividade is null
                 or u.data_inicio_atividade >= (current_date - v_idade_max))
            and not exists (
              select 1 from public.certificados_ocultos o where o.cnpj = u.cnpj
            )
        ) s
      ), '[]'::jsonb) as spes
    from public.empresas e
    join public.clientes_onepay co on co.cnpj = e.cnpj
    left join public.certificados cm on cm.cnpj = e.cnpj
    where e.tipo = 'construtora'
      -- Cliente oculto sai da lista E das estatísticas.
      and not exists (select 1 from public.certificados_ocultos o where o.cnpj = e.cnpj)
  ) c;

  -- O painel de ocultados mostra os dois tipos, e diz qual é qual.
  select coalesce(jsonb_agg(to_jsonb(o) order by o.oculto_em desc), '[]'::jsonb) into v_ocultas
  from (
    select
      x.cnpj,
      coalesce(emp.razao_social, u.nome_fantasia, u.razao_social, x.cnpj) as razao_social,
      x.oculto_em,
      us.nome as oculto_por_nome,
      (co.cnpj is not null) as eh_cliente
    from public.certificados_ocultos x
    left join public.mercado_universo u on u.cnpj = x.cnpj
    left join public.empresas emp on emp.cnpj = x.cnpj
    left join public.clientes_onepay co on co.cnpj = x.cnpj
    left join public.usuarios us on us.id = x.oculto_por
  ) o;

  select count(*)::int into v_total_ativos
  from public.certificados
  where status = 'active' and expires_at is not null and expires_at >= now();

  return jsonb_build_object(
    'tem_acesso', true,
    'clientes', v_clientes,
    'ocultas', v_ocultas,
    'total_ativos', v_total_ativos,
    'sincronizado_em', (select max(sincronizado_em) from public.certificados)
  );
end $$;

revoke execute on function certificados_grid() from public;
grant execute on function certificados_grid() to authenticated;
