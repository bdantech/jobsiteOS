-- ============================================================================
-- 0006 — Actually revoke the RPC surface (0005 got this wrong)
--
-- 0005 did `revoke execute ... from anon` and the linter still reported anon as
-- able to call every app_* helper. The revoke was a no-op: Postgres grants
-- EXECUTE on new functions to PUBLIC by default, and `anon` inherits it from
-- there. Revoking a privilege the role never held directly changes nothing.
--
-- Correct order: revoke from PUBLIC (kills the inherited grant for every role),
-- then grant back explicitly to the only roles that need it.
-- ============================================================================

revoke execute on function app_usuario_ativo()      from public;
revoke execute on function app_tem_modulo(text)     from public;
revoke execute on function app_is_admin()           from public;

-- RLS policies call these as the invoking role, so `authenticated` must keep
-- EXECUTE or every policy on every table denies. `anon` is left with nothing:
-- it is not granted here, and no longer inherits from PUBLIC.
grant execute on function app_usuario_ativo()   to authenticated, service_role;
grant execute on function app_tem_modulo(text)  to authenticated, service_role;
grant execute on function app_is_admin()        to authenticated, service_role;

-- Supabase platform object (owner: postgres) — an EVENT TRIGGER function that
-- force-enables RLS on any newly created table in `public`. We keep it: it is a
-- safety net for future migrations. Event triggers fire from the DDL machinery
-- and never check EXECUTE, so revoking it here silences the linter without
-- disarming the protection.
revoke execute on function rls_auto_enable() from public, anon, authenticated;
