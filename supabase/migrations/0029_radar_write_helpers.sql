-- =============================================================================
-- 0029 — Radar: write-helpers (RPCs)
--
-- Convenção do projeto (ver 0008/0013): mutações do usuário passam por RPCs
-- SECURITY INVOKER (rodam como o usuário → a RLS governa a escrita), search_path
-- vazio, refs schema-qualificadas, sempre gravam audit_log em uma transação.
-- As escritas de MÁQUINA (enriquecimentos, lote_itens, protestos, clientes) são
-- feitas pelo worker com service role e NÃO passam por aqui.
-- =============================================================================

-- ─── Lotes: criar / aprovar / cancelar ──────────────────────────────────────
create or replace function app_criar_lote(p jsonb)
returns lotes_enriquecimento language plpgsql set search_path = '' as $$
declare
  v_lote public.lotes_enriquecimento;
  v_ator uuid := auth.uid();
begin
  insert into public.lotes_enriquecimento (
    tipo, nome, definicao_filtro, parametros, total_itens,
    custo_estimado_min, custo_estimado_esperado, status, criado_por
  ) values (
    p ->> 'tipo',
    p ->> 'nome',
    coalesce(p -> 'definicao_filtro', '{}'::jsonb),
    coalesce(p -> 'parametros', '{}'::jsonb),
    (p ->> 'total_itens')::int,
    (p ->> 'custo_estimado_min')::numeric,
    (p ->> 'custo_estimado_esperado')::numeric,
    coalesce(p ->> 'status', 'rascunho'),
    v_ator
  )
  returning * into v_lote;

  if v_lote.id is null then
    raise exception 'Sem permissão para criar lote.' using errcode = '42501';
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'radar.lote_criado', 'lotes_enriquecimento', v_lote.id::text, p);

  return v_lote;
end; $$;

create or replace function app_aprovar_lote(p jsonb)
returns lotes_enriquecimento language plpgsql set search_path = '' as $$
declare
  v_lote public.lotes_enriquecimento;
  v_ator uuid := auth.uid();
begin
  update public.lotes_enriquecimento
    set status = 'aprovado', aprovado_por = v_ator, aprovado_em = now()
    where id = (p ->> 'id')::uuid
      and status in ('rascunho', 'aguardando_aprovacao')
    returning * into v_lote;

  -- id nulo = RLS bloqueou OU o lote não estava num estado aprovável.
  if v_lote.id is null then
    raise exception 'Lote não encontrado ou não aprovável.' using errcode = '42501';
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'radar.lote_aprovado', 'lotes_enriquecimento', v_lote.id::text, p);

  return v_lote;
end; $$;

create or replace function app_cancelar_lote(p jsonb)
returns lotes_enriquecimento language plpgsql set search_path = '' as $$
declare
  v_lote public.lotes_enriquecimento;
  v_ator uuid := auth.uid();
begin
  update public.lotes_enriquecimento
    set status = 'cancelado'
    where id = (p ->> 'id')::uuid
      and status in ('rascunho', 'aguardando_aprovacao', 'aprovado')
    returning * into v_lote;

  if v_lote.id is null then
    raise exception 'Lote não encontrado ou não cancelável.' using errcode = '42501';
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'radar.lote_cancelado', 'lotes_enriquecimento', v_lote.id::text, p);

  return v_lote;
end; $$;

-- ─── Supressão: adicionar / remover (audit obrigatório, §8) ──────────────────
create or replace function app_suprimir(p jsonb)
returns supressao language plpgsql set search_path = '' as $$
declare
  v_sup public.supressao;
  v_ator uuid := auth.uid();
begin
  insert into public.supressao (escopo, valor, motivo, observacao, criado_por)
  values (p ->> 'escopo', p ->> 'valor', p ->> 'motivo', p ->> 'observacao', v_ator)
  on conflict (escopo, valor) do nothing
  returning * into v_sup;

  -- Já existia (conflito): recupera a linha atual para devolver.
  if v_sup.id is null then
    select * into v_sup from public.supressao
      where escopo = p ->> 'escopo' and valor = p ->> 'valor';
  end if;

  if v_sup.id is null then
    raise exception 'Sem permissão para suprimir.' using errcode = '42501';
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'radar.suprimido', 'supressao', v_sup.id::text, p);

  return v_sup;
end; $$;

create or replace function app_remover_supressao(p jsonb)
returns void language plpgsql set search_path = '' as $$
declare
  v_id uuid;
  v_ator uuid := auth.uid();
begin
  delete from public.supressao where id = (p ->> 'id')::uuid returning id into v_id;
  if v_id is null then
    raise exception 'Supressão não encontrada.' using errcode = 'no_data_found';
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'radar.supressao_removida', 'supressao', v_id::text, p);
end; $$;

-- ─── radar_config: salvar (admin — a RLS de radar_config já exige app_is_admin) ─
create or replace function app_salvar_radar_config(p jsonb)
returns radar_config language plpgsql set search_path = '' as $$
declare
  v_cfg public.radar_config;
  v_ator uuid := auth.uid();
begin
  insert into public.radar_config (chave, valor, atualizado_por)
  values (p ->> 'chave', p -> 'valor', v_ator)
  on conflict (chave) do update set valor = excluded.valor, atualizado_por = v_ator
  returning * into v_cfg;

  if v_cfg.chave is null then
    raise exception 'Sem permissão para salvar configuração do Radar.' using errcode = '42501';
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'radar.config_salva', 'radar_config', v_cfg.chave, p);

  return v_cfg;
end; $$;

-- ─── Grants: revoga de public, concede a authenticated + service_role ────────
revoke execute on function app_criar_lote(jsonb) from public;
revoke execute on function app_aprovar_lote(jsonb) from public;
revoke execute on function app_cancelar_lote(jsonb) from public;
revoke execute on function app_suprimir(jsonb) from public;
revoke execute on function app_remover_supressao(jsonb) from public;
revoke execute on function app_salvar_radar_config(jsonb) from public;

grant execute on function app_criar_lote(jsonb) to authenticated, service_role;
grant execute on function app_aprovar_lote(jsonb) to authenticated, service_role;
grant execute on function app_cancelar_lote(jsonb) to authenticated, service_role;
grant execute on function app_suprimir(jsonb) to authenticated, service_role;
grant execute on function app_remover_supressao(jsonb) to authenticated, service_role;
grant execute on function app_salvar_radar_config(jsonb) to authenticated, service_role;
