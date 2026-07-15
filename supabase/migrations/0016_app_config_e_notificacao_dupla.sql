-- ============================================================================
-- 0016 — Dois furos que a fundação deixou, encontrados ao construir a superfície
--
-- (1) NOTIFICAÇÃO DUPLICADA POR INGESTÃO.
--     Migration 0014 seeds notificacao_regras for mercado.ingestao_falhou, so
--     the fan-out trigger writes a bell row. The worker ALSO calls notify(),
--     because that is the only path that reaches PUSH — and notify() writes its
--     own bell row. Two notifications for one failure, and the spec asks for
--     both mechanisms without reconciling them (§3.1 vs §6).
--
--     Resolution: ONE path per event, chosen by whether push is warranted.
--       falhou    → notify() only. A monthly ingestion that failed is the one
--                   thing worth waking someone up for, and only notify() pushes.
--                   The seeded rule is REMOVED so the trigger does not double it.
--       concluida → the trigger only. A successful monthly run is a bell item,
--                   not a lock-screen interrupt.
--
-- (2) O LIMIAR DE PROMOÇÃO NÃO TINHA ONDE MORAR.
--     §5.1 requires a promotion-threshold setting, and core/constants.ts even
--     says "Settings override it" — but no settings table was ever created. The
--     Pirâmide agent worked around it by event-sourcing the value out of
--     audit_log, which is durable but wrong: audit_log's insert policy is
--     `usuario_ativo() and usuario_id = auth.uid()`, so ANY active user can
--     append a row claiming to set it. The read then has to guess which rows to
--     trust. That is a permission check reimplemented in application code, which
--     is exactly what RLS exists to prevent.
--
--     Resolution: a real config table. Admin writes, module reads, RLS decides.
-- ============================================================================

-- ─── (1) ────────────────────────────────────────────────────────────────────
delete from notificacao_regras where tipo_evento = 'mercado.ingestao_falhou';

-- ─── (2) ────────────────────────────────────────────────────────────────────
create table app_config (
  chave text primary key,
  valor jsonb not null,
  descricao text,
  atualizado_por uuid references usuarios (id) on delete set null,
  atualizado_em timestamptz not null default now()
);

alter table app_config enable row level security;

-- Readable by any active user: the promotion threshold changes what the whole
-- Explorador means, so hiding it from non-admins would only make the UI lie.
create policy app_config_select on app_config
  for select to authenticated using (app_usuario_ativo());

-- Written by admins only. This is a company-wide lever: lowering the threshold
-- to TAM would promote hundreds of thousands of rows into `empresas`.
create policy app_config_admin on app_config
  for all to authenticated using (app_is_admin()) with check (app_is_admin());

revoke insert, update, delete on app_config from authenticated;
grant select on app_config to authenticated;
grant insert, update, delete on app_config to authenticated;  -- policy narrows to admin

insert into app_config (chave, valor, descricao)
values (
  'mercado.promocao_camada',
  '"sam"'::jsonb,
  'Camada a partir da qual uma empresa do universo é promovida automaticamente para a base de Empresas. Use "manual" para desligar a promoção automática.'
)
on conflict (chave) do nothing;

-- Write helper: same contract as every other mutation (validate, write, audit),
-- SECURITY INVOKER so the admin-only policy above is what actually decides.
create or replace function app_definir_config(p jsonb)
returns app_config
language plpgsql
set search_path = ''
as $$
declare
  v_config public.app_config;
  v_ator uuid := auth.uid();
begin
  insert into public.app_config (chave, valor, atualizado_por, atualizado_em)
  values (p ->> 'chave', p -> 'valor', v_ator, now())
  on conflict (chave) do update
    set valor = excluded.valor,
        atualizado_por = excluded.atualizado_por,
        atualizado_em = now()
  returning * into v_config;

  -- RLS refused → the caller is not an admin.
  if v_config.chave is null then
    raise exception 'Sem permissão para alterar configurações.' using errcode = '42501';
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'config.alterada', 'app_config', v_config.chave, p);

  return v_config;
end;
$$;

revoke execute on function app_definir_config(jsonb) from public;
grant execute on function app_definir_config(jsonb) to authenticated, service_role;
