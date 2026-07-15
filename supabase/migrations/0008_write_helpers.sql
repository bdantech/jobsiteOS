-- ============================================================================
-- 0008 — Write helpers: entity + event + audit, atomically
--
-- The spec requires every mutation to "validate, write, optionally emit an
-- empresa_eventos row, and always write audit_log — one transaction."
--
-- supabase-js cannot express that: three .insert() calls are three separate
-- transactions, so a crash between them leaves a company with no audit trail,
-- or an event for a row that was rolled back. The only way to get the atomicity
-- the spec asks for is to put the whole mutation in the database.
--
-- These are SECURITY INVOKER (the default) on purpose — the opposite choice
-- from the app_* helpers in 0002. They must run as the CALLING user so that
-- RLS still decides what they may touch, and so audit_log.usuario_id =
-- auth.uid() holds. A SECURITY DEFINER function here would be a hole big enough
-- to drive the whole permission system through.
--
-- zod still validates on the way in (packages/core). This is the second line of
-- defence, not the first.
-- ============================================================================

-- ─── criar empresa ──────────────────────────────────────────────────────────
create or replace function app_criar_empresa(p jsonb)
returns empresas
language plpgsql
set search_path = ''
as $$
declare
  v_empresa public.empresas;
  v_ator uuid := auth.uid();
begin
  insert into public.empresas (
    cnpj, razao_social, nome_fantasia, tipo, estagio,
    uf, municipio, cnae_principal, porte,
    erp_atual, erp_mrr, erp_canal_venda
  )
  values (
    p ->> 'cnpj',
    p ->> 'razao_social',
    p ->> 'nome_fantasia',
    coalesce(p ->> 'tipo', 'construtora'),
    coalesce(p ->> 'estagio', 'mercado'),
    p ->> 'uf',
    p ->> 'municipio',
    p ->> 'cnae_principal',
    p ->> 'porte',
    p ->> 'erp_atual',
    (p ->> 'erp_mrr')::numeric,
    p ->> 'erp_canal_venda'
  )
  returning * into v_empresa;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (
    v_empresa.id,
    'empresa.criada',
    jsonb_build_object(
      'resumo', coalesce(v_empresa.razao_social, v_empresa.cnpj) || ' foi criada.',
      'estagio', v_empresa.estagio
    ),
    v_ator
  );

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'empresa.criada', 'empresas', v_empresa.id::text, p);

  return v_empresa;
end;
$$;

-- ─── atualizar empresa ──────────────────────────────────────────────────────
create or replace function app_atualizar_empresa(p jsonb)
returns empresas
language plpgsql
set search_path = ''
as $$
declare
  v_antes public.empresas;
  v_depois public.empresas;
  v_ator uuid := auth.uid();
begin
  select * into v_antes from public.empresas where id = (p ->> 'id')::uuid;

  if v_antes.id is null then
    raise exception 'Empresa não encontrada.' using errcode = 'no_data_found';
  end if;

  -- coalesce(new, old) per field: an absent key means "leave it alone", which is
  -- what a PATCH-shaped payload from atualizarEmpresaSchema (.partial()) means.
  -- cnpj is never updated: it is the identity of the row.
  update public.empresas set
    razao_social    = coalesce(p ->> 'razao_social',    razao_social),
    nome_fantasia   = coalesce(p ->> 'nome_fantasia',   nome_fantasia),
    tipo            = coalesce(p ->> 'tipo',            tipo),
    estagio         = coalesce(p ->> 'estagio',         estagio),
    uf              = coalesce(p ->> 'uf',              uf),
    municipio       = coalesce(p ->> 'municipio',       municipio),
    cnae_principal  = coalesce(p ->> 'cnae_principal',  cnae_principal),
    porte           = coalesce(p ->> 'porte',           porte),
    erp_atual       = coalesce(p ->> 'erp_atual',       erp_atual),
    erp_mrr         = coalesce((p ->> 'erp_mrr')::numeric, erp_mrr),
    erp_canal_venda = coalesce(p ->> 'erp_canal_venda', erp_canal_venda)
  where id = v_antes.id
  returning * into v_depois;

  -- RLS returned no row to update → the caller cannot touch this company.
  if v_depois.id is null then
    raise exception 'Sem permissão para alterar esta empresa.' using errcode = '42501';
  end if;

  -- A stage change is the event the funnel modules care about; a plain field
  -- edit is not worth a timeline entry.
  if v_depois.estagio is distinct from v_antes.estagio then
    insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
    values (
      v_depois.id,
      'estagio.alterado',
      jsonb_build_object(
        'resumo', 'Estágio: ' || v_antes.estagio || ' → ' || v_depois.estagio,
        'de', v_antes.estagio,
        'para', v_depois.estagio
      ),
      v_ator
    );
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'empresa.atualizada', 'empresas', v_depois.id::text, p);

  return v_depois;
end;
$$;

-- ─── criar nota ─────────────────────────────────────────────────────────────
create or replace function app_criar_nota(p jsonb)
returns empresa_notas
language plpgsql
set search_path = ''
as $$
declare
  v_nota public.empresa_notas;
  v_ator uuid := auth.uid();
begin
  insert into public.empresa_notas (empresa_id, autor_usuario_id, conteudo)
  values ((p ->> 'empresa_id')::uuid, v_ator, p ->> 'conteudo')
  returning * into v_nota;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (
    v_nota.empresa_id,
    'nota.criada',
    jsonb_build_object('resumo', left(v_nota.conteudo, 140), 'nota_id', v_nota.id),
    v_ator
  );

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'nota.criada', 'empresa_notas', v_nota.id::text, p);

  return v_nota;
end;
$$;

-- Callable by signed-in users only; anon inherits nothing (see 0006).
revoke execute on function app_criar_empresa(jsonb)    from public;
revoke execute on function app_atualizar_empresa(jsonb) from public;
revoke execute on function app_criar_nota(jsonb)        from public;

grant execute on function app_criar_empresa(jsonb)     to authenticated, service_role;
grant execute on function app_atualizar_empresa(jsonb) to authenticated, service_role;
grant execute on function app_criar_nota(jsonb)        to authenticated, service_role;
