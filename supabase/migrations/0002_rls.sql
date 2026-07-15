-- ============================================================================
-- 0002 — Row Level Security
-- RLS on everything. Access is driven by the Tool Registry: a user can touch a
-- module's data only if their perfil grants that modulo_id.
--
-- The helper functions are SECURITY DEFINER on purpose: they read `usuarios`
-- and `perfil_modulos`, which are themselves RLS-protected. Without DEFINER the
-- policies would recurse into the very tables they guard.
-- ============================================================================

-- ─── Helpers ────────────────────────────────────────────────────────────────

-- Is the caller a known, active user? (ativo = false blocks everything.)
create or replace function app_usuario_ativo()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.usuarios u
    where u.id = auth.uid() and u.ativo
  );
$$;

-- Does the caller's perfil grant this module? Mirrors AppModule.id in the registry.
create or replace function app_tem_modulo(p_modulo_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.usuarios u
    join public.perfil_modulos pm on pm.perfil_id = u.perfil_id
    where u.id = auth.uid()
      and u.ativo
      and pm.modulo_id = p_modulo_id
  );
$$;

create or replace function app_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.app_tem_modulo('admin');
$$;

-- ─── Enable RLS everywhere ──────────────────────────────────────────────────
alter table empresas             enable row level security;
alter table empresa_notas        enable row level security;
alter table empresa_eventos      enable row level security;
alter table contatos             enable row level security;
alter table perfis               enable row level security;
alter table perfil_modulos       enable row level security;
alter table usuarios             enable row level security;
alter table notificacoes         enable row level security;
alter table notificacao_regras   enable row level security;
alter table audit_log            enable row level security;

-- ─── empresas (+ satellites): gated by the `empresas` module ────────────────
create policy empresas_select on empresas
  for select to authenticated using (app_tem_modulo('empresas'));
create policy empresas_insert on empresas
  for insert to authenticated with check (app_tem_modulo('empresas'));
create policy empresas_update on empresas
  for update to authenticated
  using (app_tem_modulo('empresas')) with check (app_tem_modulo('empresas'));
-- Deleting a company cascades notes/events/contacts. Admin only.
create policy empresas_delete on empresas
  for delete to authenticated using (app_is_admin());

create policy empresa_notas_select on empresa_notas
  for select to authenticated using (app_tem_modulo('empresas'));
-- You may only author notes as yourself.
create policy empresa_notas_insert on empresa_notas
  for insert to authenticated
  with check (app_tem_modulo('empresas') and autor_usuario_id = auth.uid());
create policy empresa_notas_delete on empresa_notas
  for delete to authenticated
  using (autor_usuario_id = auth.uid() or app_is_admin());

-- Events are an append-only backbone: no update, no delete policy on purpose.
create policy empresa_eventos_select on empresa_eventos
  for select to authenticated using (app_tem_modulo('empresas'));
create policy empresa_eventos_insert on empresa_eventos
  for insert to authenticated with check (app_tem_modulo('empresas'));

create policy contatos_select on contatos
  for select to authenticated using (app_tem_modulo('empresas'));
create policy contatos_write on contatos
  for all to authenticated
  using (app_tem_modulo('empresas')) with check (app_tem_modulo('empresas'));

-- ─── RBAC tables: admin module only ─────────────────────────────────────────
create policy perfis_admin on perfis
  for all to authenticated using (app_is_admin()) with check (app_is_admin());
create policy perfil_modulos_admin on perfil_modulos
  for all to authenticated using (app_is_admin()) with check (app_is_admin());
create policy notificacao_regras_admin on notificacao_regras
  for all to authenticated using (app_is_admin()) with check (app_is_admin());

-- ─── usuarios ───────────────────────────────────────────────────────────────
-- You can read yourself; admins read everyone. Colleague names (for note authors
-- and event actors) come from the `usuarios_publico` view below, NOT from here —
-- this table also holds push subscriptions and notification prefs.
create policy usuarios_select_self on usuarios
  for select to authenticated using (id = auth.uid() or app_is_admin());
create policy usuarios_update_self on usuarios
  for update to authenticated
  using (id = auth.uid() or app_is_admin())
  with check (id = auth.uid() or app_is_admin());
-- Users are created server-side via the Supabase Admin API (service role), which
-- bypasses RLS — hence no insert policy for `authenticated`.

-- Privilege-escalation guard. Without this, `usuarios_update_self` would let any
-- user point their own perfil_id at the Admin profile, or re-activate a
-- deactivated account. Only an admin may change those fields.
create or replace function usuarios_guard_campos_privilegiados()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.app_is_admin() then
    return new;
  end if;

  if new.perfil_id is distinct from old.perfil_id then
    raise exception 'Somente administradores podem alterar o perfil de um usuário.'
      using errcode = '42501';
  end if;

  if new.ativo is distinct from old.ativo then
    raise exception 'Somente administradores podem ativar ou desativar um usuário.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger usuarios_guard_privilegios
  before update on usuarios
  for each row
  execute function usuarios_guard_campos_privilegiados();

-- Safe, minimal projection of `usuarios` for displaying note authors / event
-- actors. security_invoker = false so it bypasses the row policies above, while
-- exposing only non-sensitive columns.
create view usuarios_publico
with (security_invoker = false) as
  select id, nome, email, ativo
  from usuarios;

-- ─── notificacoes: strictly your own ────────────────────────────────────────
create policy notificacoes_select_own on notificacoes
  for select to authenticated using (usuario_id = auth.uid());
-- Only to flip `lida`. Rows are created by notify() / the event trigger, both
-- SECURITY DEFINER, so no insert policy is granted to `authenticated`.
create policy notificacoes_update_own on notificacoes
  for update to authenticated
  using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

-- ─── audit_log: append-only, admin-readable ─────────────────────────────────
create policy audit_log_select_admin on audit_log
  for select to authenticated using (app_is_admin());
-- The write helper inserts under the acting user's context; it may only stamp
-- its own id. No update/delete policy exists, for anyone.
create policy audit_log_insert on audit_log
  for insert to authenticated
  with check (app_usuario_ativo() and usuario_id = auth.uid());

-- ─── Grants ─────────────────────────────────────────────────────────────────
-- RLS decides the rows; grants decide the verbs. `anon` gets nothing: this is an
-- internal tool with no public surface and no self-signup.
grant usage on schema public to authenticated;

grant select, insert, update, delete on empresas, contatos to authenticated;
grant select, insert, delete on empresa_notas to authenticated;
grant select, insert on empresa_eventos to authenticated;
grant select, insert, update, delete on perfis, perfil_modulos, notificacao_regras to authenticated;
grant select, update on usuarios to authenticated;
grant select, update on notificacoes to authenticated;
grant select, insert on audit_log to authenticated;
grant select on usuarios_publico to authenticated;

revoke all on all tables in schema public from anon;
