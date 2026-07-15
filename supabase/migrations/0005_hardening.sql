-- ============================================================================
-- 0005 — Security hardening (resolves supabase db linter findings from 0002)
--
-- Problem: the Company 360 timeline needs colleague names (note authors, event
-- actors), but `usuarios` also holds push subscriptions and notification prefs.
-- 0002 solved this with a SECURITY DEFINER view, which the linter correctly
-- flags as ERROR — it bypasses RLS wholesale.
--
-- Fix: drop the view and split the problem across the two mechanisms Postgres
-- actually gives us. RLS decides WHICH ROWS you see (any active user sees every
-- colleague). Column-level GRANTs decide WHICH COLUMNS (`authenticated` is never
-- granted the sensitive jsonb columns at all). Push tokens and prefs are then
-- only reachable via the service role, i.e. server-side code.
-- ============================================================================

drop view if exists usuarios_publico;

-- ─── usuarios: rows ─────────────────────────────────────────────────────────
drop policy if exists usuarios_select_self on usuarios;
drop policy if exists usuarios_update_self on usuarios;

-- Any active user may see any colleague's row. Safe now, because the columns
-- worth hiding are withheld by grant, not by policy.
create policy usuarios_select on usuarios
  for select to authenticated using (app_usuario_ativo());

-- You may only update your own row (and only `nome`, per the grants below).
-- Admin mutations (perfil, ativo, must_change_password) go through server
-- actions on the service role — see the Admin module.
create policy usuarios_update_self on usuarios
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- ─── usuarios: columns ──────────────────────────────────────────────────────
revoke select, update on usuarios from authenticated;

grant select (id, nome, email, perfil_id, ativo, must_change_password, criado_em)
  on usuarios to authenticated;

-- Deliberately NOT granted to authenticated, on any row — not even your own:
--   web_push_subscriptions, expo_push_tokens, prefs_notificacoes
-- Registering a device or saving prefs is a server action (service role), so a
-- compromised browser session can never enumerate a colleague's push endpoints.

grant update (nome) on usuarios to authenticated;

-- ─── search_path on the remaining function ──────────────────────────────────
-- An empty search_path means unqualified names resolve to nothing, so a hostile
-- schema on the caller's path can't shadow a function this trigger relies on.
create or replace function set_atualizado_em()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

-- ─── Lock anon out of the RPC surface ───────────────────────────────────────
-- This is an internal tool: no self-signup, no public pages. The anon role has
-- no legitimate call here, and every function below is SECURITY DEFINER — left
-- executable, they are a free RLS-bypass oracle exposed at /rest/v1/rpc/*.
--
-- Trigger functions are revoked from every role including authenticated: the
-- EXECUTE privilege on a trigger function is checked when the trigger is
-- CREATEd, not when it fires, so the triggers keep working.
revoke execute on function app_usuario_ativo() from anon;
revoke execute on function app_tem_modulo(text) from anon;
revoke execute on function app_is_admin() from anon;

revoke execute on function fanout_evento_para_notificacoes() from public, anon, authenticated;
revoke execute on function usuarios_guard_campos_privilegiados() from public, anon, authenticated;
revoke execute on function set_atualizado_em() from public, anon, authenticated;

-- `authenticated` keeps EXECUTE on the three app_* helpers: the RLS policies
-- call them as the invoking role, so revoking it would deny every policy.
