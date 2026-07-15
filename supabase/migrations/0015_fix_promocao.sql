-- ============================================================================
-- 0015 — Fix: a promoção nunca ligava a linha do universo à empresa
--
-- Found by the end-to-end RLS probe (supabase/tests/rls-probe.mjs), which
-- promoted the same CNPJ twice as a real signed-in user and got two
-- `empresa.promovida` events instead of one.
--
-- ROOT CAUSE. app_promover_empresa (0013) is SECURITY INVOKER — correctly, so
-- that RLS still decides what the caller may touch. It ends with:
--     update public.mercado_universo set empresa_id = v_empresa.id ...
-- But 0012 gave mercado_universo ONE policy: SELECT. Grants and policies are
-- AND-ed, and an UPDATE with no matching policy is not an error — it simply
-- matches zero rows. So the link was silently discarded, every time, and:
--   * promotion was not idempotent (the early-return checks empresa_id, which
--     was never set), so each click re-emitted the event;
--   * the universe row never showed as promoted, so the Explorador would offer
--     "Promover" forever on a company that is already in the base.
--
-- THE FIX IS NOT "give authenticated UPDATE on mercado_universo". That table is
-- worker-owned reference data — 2M rows of Receita Federal record. A user must
-- be able to link a row to an empresa and NOTHING else. So: a policy scoped to
-- the module, plus a COLUMN grant that makes `empresa_id` the only writable
-- column. The column grant is the real guard; the policy alone would let a user
-- rewrite a company's razão social.
--
-- Also fixed here: adopting a company that already existed (imported from a
-- list, so it never passed through staging) linked it but left camada, grupo_id,
-- is_spe, grafo_sefaz and origem null — the market classification the promotion
-- exists to carry over.
-- ============================================================================

-- ─── Só empresa_id é gravável, e só por quem tem o módulo ───────────────────
create policy mercado_universo_vincular on mercado_universo
  for update to authenticated
  using (app_tem_modulo('mercado'))
  with check (app_tem_modulo('mercado'));

-- Supabase's default privileges granted `authenticated` INSERT/UPDATE/DELETE on
-- every column of every new table in `public`. Nothing was exploitable, because
-- there were no INSERT/DELETE policies to satisfy — but with an UPDATE policy
-- now in place, the blanket UPDATE grant WOULD be. Take it back and hand over
-- exactly one column.
revoke insert, update, delete on mercado_universo from authenticated;
grant update (empresa_id) on mercado_universo to authenticated;

-- Same blanket defaults on the other worker-owned tables. No policy admits a
-- write today, so this changes no behaviour — it removes the standing invitation
-- for a future policy to become a hole by accident.
revoke insert, update, delete on
  mercado_socios, mercado_obras, mercado_metricas, grupos_economicos, mercado_ingestoes
from authenticated;

-- ─── A promoção agora carrega a classificação de mercado ────────────────────
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
  select * into v_universo from public.mercado_universo where cnpj = p ->> 'cnpj';

  if v_universo.cnpj is null then
    raise exception 'CNPJ não encontrado no universo.' using errcode = 'no_data_found';
  end if;

  -- Already linked → hand back what is there. Idempotent: the Explorador shows
  -- this button on a table of millions of rows, and two people WILL click it on
  -- the same company.
  if v_universo.empresa_id is not null then
    select * into v_empresa from public.empresas where id = v_universo.empresa_id;
    if v_empresa.id is not null then
      return v_empresa;
    end if;
  end if;

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
      'mercado',            -- promotion is CLASSIFICATION, not relationship:
                            -- nobody has talked to them yet
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
  else
    -- The company already existed — a list import (origem='lista'), which skips
    -- staging. Carry the market classification across, but do NOT overwrite what
    -- the import already established: coalesce keeps origem='lista' and leaves a
    -- camada someone set by hand alone.
    update public.empresas set
      camada      = coalesce(camada, v_universo.camada),
      grupo_id    = coalesce(grupo_id, v_universo.grupo_id),
      is_spe      = is_spe or v_universo.is_spe,
      grafo_sefaz = grafo_sefaz or v_universo.grafo_sefaz,
      origem      = coalesce(origem, 'mercado')
    where id = v_empresa.id
    returning * into v_empresa;

    -- RLS returned no row → the caller cannot write this empresa.
    if v_empresa.id is null then
      raise exception 'Sem permissão para alterar esta empresa.' using errcode = '42501';
    end if;
  end if;

  update public.mercado_universo
  set empresa_id = v_empresa.id
  where cnpj = v_universo.cnpj;

  -- The link is the whole point of the promotion. If the policy above is ever
  -- dropped, this UPDATE goes back to silently matching zero rows — so fail
  -- loudly instead of shipping the same bug twice.
  if not found then
    raise exception 'Não foi possível vincular a empresa ao universo.' using errcode = '42501';
  end if;

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

revoke execute on function app_promover_empresa(jsonb) from public;
grant execute on function app_promover_empresa(jsonb) to authenticated, service_role;
