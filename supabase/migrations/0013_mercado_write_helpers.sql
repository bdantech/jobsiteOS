-- ============================================================================
-- 0013 — Mercado: write helpers (entidade + evento + audit, atômicos)
--
-- Same contract as 0008: SECURITY INVOKER, so RLS still decides what the caller
-- may touch and auth.uid() is the real user. A SECURITY DEFINER function here
-- would hand any signed-in user the ability to promote or reclassify anything.
-- ============================================================================

-- ─── Promover uma empresa do universo ───────────────────────────────────────
-- Idempotent: promoting an already-promoted CNPJ returns the existing empresa
-- instead of raising. The button is in a table of 2M rows, two people will click
-- it on the same row, and the second one should not see an error.
create or replace function app_promover_empresa(p jsonb)
returns empresas
language plpgsql
set search_path = ''
as $$
declare
  v_universo public.mercado_universo;
  v_empresa public.empresas;
  v_ator uuid := auth.uid();
begin
  select * into v_universo
  from public.mercado_universo
  where cnpj = p ->> 'cnpj';

  if v_universo.cnpj is null then
    raise exception 'CNPJ não encontrado no universo.' using errcode = 'no_data_found';
  end if;

  -- Already promoted → hand back what is there.
  if v_universo.empresa_id is not null then
    select * into v_empresa from public.empresas where id = v_universo.empresa_id;
    if v_empresa.id is not null then
      return v_empresa;
    end if;
    -- empresa_id pointed at a deleted row (ON DELETE SET NULL should prevent
    -- this, but a stale pointer must not block the promotion).
  end if;

  -- The company may already exist in `empresas` from a list import, which never
  -- passes through staging. Adopt it rather than colliding on the unique CNPJ.
  select * into v_empresa from public.empresas where cnpj = v_universo.cnpj;

  if v_empresa.id is null then
    insert into public.empresas (
      cnpj, razao_social, nome_fantasia, tipo, estagio,
      uf, municipio, cnae_principal, porte,
      camada, grupo_id, is_spe, grafo_sefaz, origem
    )
    values (
      v_universo.cnpj,
      v_universo.razao_social,
      v_universo.nome_fantasia,
      'construtora',
      'mercado',                       -- promotion is a CLASSIFICATION event, not a
                                       -- relationship one: nobody has talked to them yet
      v_universo.uf,
      v_universo.municipio,
      v_universo.cnae_principal,
      v_universo.porte_rfb,
      v_universo.camada,
      v_universo.grupo_id,
      v_universo.is_spe,
      v_universo.grafo_sefaz,
      'mercado'
    )
    returning * into v_empresa;
  end if;

  update public.mercado_universo
  set empresa_id = v_empresa.id
  where cnpj = v_universo.cnpj;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (
    v_empresa.id,
    'empresa.promovida',
    jsonb_build_object(
      'resumo', coalesce(v_empresa.razao_social, v_empresa.cnpj)
                || ' foi promovida do universo (camada ' || coalesce(v_universo.camada, '—') || ').',
      'camada', v_universo.camada,
      'origem', 'mercado'
    ),
    v_ator
  );

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'empresa.promovida', 'empresas', v_empresa.id::text, p);

  return v_empresa;
end;
$$;

-- ─── Criar um segmento ──────────────────────────────────────────────────────
create or replace function app_criar_segmento(p jsonb)
returns segmentos
language plpgsql
set search_path = ''
as $$
declare
  v_segmento public.segmentos;
  v_ator uuid := auth.uid();
begin
  insert into public.segmentos (nome, descricao, definicao, criado_por)
  values (
    p ->> 'nome',
    p ->> 'descricao',
    coalesce(p -> 'definicao', '{}'::jsonb),
    v_ator
  )
  returning * into v_segmento;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'segmento.criado', 'segmentos', v_segmento.id::text, p);

  return v_segmento;
end;
$$;

-- ─── Salvar (e opcionalmente ativar) uma versão de regra de camada ──────────
-- Rules are append-only: saving never edits a version, it creates the next one.
-- A rule that could be edited in place would make `camada_regra_versao` on a
-- company a lie — it would point at a rule whose text has since changed, and the
-- question "what moved this company?" becomes unanswerable.
create or replace function app_salvar_camada_regra(p jsonb)
returns camada_regras
language plpgsql
set search_path = ''
as $$
declare
  v_regra public.camada_regras;
  v_camada text := p ->> 'camada';
  v_ativar boolean := coalesce((p ->> 'ativar')::boolean, false);
  v_versao int;
  v_ator uuid := auth.uid();
begin
  select coalesce(max(versao), 0) + 1 into v_versao
  from public.camada_regras
  where camada = v_camada;

  -- Only one rule per layer may be active (enforced by a partial unique index).
  -- Deactivate first: the index would otherwise reject the insert, and the error
  -- would be a constraint violation nobody can read.
  if v_ativar then
    update public.camada_regras set ativa = false
    where camada = v_camada and ativa;
  end if;

  insert into public.camada_regras (camada, versao, definicao, ativa, criada_por)
  values (v_camada, v_versao, p -> 'definicao', v_ativar, v_ator)
  returning * into v_regra;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (
    v_ator,
    case when v_ativar then 'camada_regra.ativada' else 'camada_regra.criada' end,
    'camada_regras',
    v_regra.id::text,
    p
  );

  return v_regra;
end;
$$;

-- ─── Ativar uma versão já existente ─────────────────────────────────────────
create or replace function app_ativar_camada_regra(p jsonb)
returns camada_regras
language plpgsql
set search_path = ''
as $$
declare
  v_regra public.camada_regras;
  v_ator uuid := auth.uid();
begin
  select * into v_regra from public.camada_regras where id = (p ->> 'id')::uuid;

  if v_regra.id is null then
    raise exception 'Regra não encontrada.' using errcode = 'no_data_found';
  end if;

  update public.camada_regras set ativa = false
  where camada = v_regra.camada and ativa;

  update public.camada_regras set ativa = true
  where id = v_regra.id
  returning * into v_regra;

  -- RLS returned no row → the caller is not an admin (camada_regras_admin).
  if v_regra.id is null then
    raise exception 'Sem permissão para ativar regras de camada.' using errcode = '42501';
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'camada_regra.ativada', 'camada_regras', v_regra.id::text, p);

  return v_regra;
end;
$$;

revoke execute on function app_promover_empresa(jsonb)     from public;
revoke execute on function app_criar_segmento(jsonb)       from public;
revoke execute on function app_salvar_camada_regra(jsonb)  from public;
revoke execute on function app_ativar_camada_regra(jsonb)  from public;

grant execute on function app_promover_empresa(jsonb)     to authenticated, service_role;
grant execute on function app_criar_segmento(jsonb)       to authenticated, service_role;
grant execute on function app_salvar_camada_regra(jsonb)  to authenticated, service_role;
grant execute on function app_ativar_camada_regra(jsonb)  to authenticated, service_role;
