-- =============================================================================
-- 0063 — Certificados: leitura do grid e escrita das SPEs ocultas
--
-- `certificados_grid()` é SECURITY DEFINER pelo mesmo motivo que 0060 discutiu: as
-- SPEs vivem em `mercado_universo`, cuja policy exige o módulo `mercado` (ou uma nota
-- em `antecipacao`). Quem tem só `empresas` — o público desta página — não leria
-- nenhuma SPE, e o grid apareceria com uma coluna Matriz e mais nada. Sem erro, sem
-- aviso: um grid vazio de um jeito convincente, que é o pior modo de falhar.
--
-- O recorte é estreito e é o que justifica o DEFINER: devolve apenas CNPJ e nome das
-- SPEs DO GRUPO de um cliente Onepay que é construtora. Não é acesso ao universo de
-- mercado; é o mínimo para desenhar a linha daquele cliente.
-- =============================================================================

create or replace function certificados_grid()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_clientes jsonb;
  v_ocultas jsonb;
  v_total_ativos int;
begin
  if not public.app_tem_modulo('empresas') then
    return jsonb_build_object('tem_acesso', false);
  end if;

  -- Uma linha por construtora cliente, com as SPEs do grupo aninhadas.
  -- `certificados` entra por LEFT JOIN: ausência é resposta ("sem certificado" é
  -- vermelho, §4), não motivo para a linha sumir.
  select coalesce(jsonb_agg(to_jsonb(c) order by c.razao_social), '[]'::jsonb) into v_clientes
  from (
    select
      e.id as empresa_id,
      e.cnpj,
      coalesce(e.razao_social, e.nome_fantasia, e.cnpj) as razao_social,
      e.nome_fantasia,
      to_jsonb(cm.*) - 'expires_at_anterior' - 'ultimo_alerta' as certificado,
      coalesce((
        select jsonb_agg(to_jsonb(s) order by s.razao_social)
        from (
          select
            u.cnpj,
            coalesce(u.nome_fantasia, u.razao_social, u.cnpj) as razao_social,
            u.empresa_id,
            to_jsonb(cs.*) - 'expires_at_anterior' - 'ultimo_alerta' as certificado
          from public.mercado_universo u
          left join public.certificados cs on cs.cnpj = u.cnpj
          where u.grupo_id = e.grupo_id
            and u.is_spe
            and u.cnpj <> e.cnpj
            and not exists (
              select 1 from public.certificados_spe_ocultas o where o.cnpj = u.cnpj
            )
        ) s
      ), '[]'::jsonb) as spes
    from public.empresas e
    join public.clientes_onepay co on co.cnpj = e.cnpj
    left join public.certificados cm on cm.cnpj = e.cnpj
    where e.tipo = 'construtora'
  ) c;

  -- O painel de ocultadas (§4): quem escondeu e quando, para poder reexibir.
  select coalesce(jsonb_agg(to_jsonb(o) order by o.oculto_em desc), '[]'::jsonb) into v_ocultas
  from (
    select
      x.cnpj,
      coalesce(u.nome_fantasia, u.razao_social, x.cnpj) as razao_social,
      x.oculto_em,
      us.nome as oculto_por_nome
    from public.certificados_spe_ocultas x
    left join public.mercado_universo u on u.cnpj = x.cnpj
    left join public.usuarios us on us.id = x.oculto_por
  ) o;

  -- KPI 3 (§4): TODOS os certificados ativos e não vencidos, inclusive de
  -- fornecedores — o escopo é diferente dos outros dois de propósito, e o card
  -- explica isso no tooltip.
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

comment on function certificados_grid is
  'Grid de certificados: construtoras clientes (matriz) + SPEs visíveis do grupo, '
  'ocultas e KPI de total ativo. DEFINER porque as SPEs vivem em mercado_universo, '
  'que o módulo empresas não lê — o recorte devolvido é só o do grupo do cliente.';

-- ─── Ocultar / reexibir SPE ─────────────────────────────────────────────────
-- Escrita passa por RPC para carimbar `oculto_por = auth.uid()` sem confiar no
-- cliente, e para recusar a MATRIZ de um cliente (§4: matriz não pode ser ocultada)
-- — uma regra que a policy sozinha não expressa.

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
  if exists (
    select 1 from public.empresas e join public.clientes_onepay c on c.cnpj = e.cnpj
    where e.cnpj = v_cnpj
  ) then
    raise exception 'A matriz de um cliente não pode ser ocultada do grid.' using errcode = '22023';
  end if;

  insert into public.certificados_spe_ocultas (cnpj, oculto_por)
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
  delete from public.certificados_spe_ocultas where cnpj = v_cnpj;
  return jsonb_build_object('cnpj', v_cnpj, 'oculto', false);
end $$;

revoke execute on function app_ocultar_spe_certificado(text) from public;
revoke execute on function app_reexibir_spe_certificado(text) from public;
grant execute on function app_ocultar_spe_certificado(text) to authenticated;
grant execute on function app_reexibir_spe_certificado(text) to authenticated;
