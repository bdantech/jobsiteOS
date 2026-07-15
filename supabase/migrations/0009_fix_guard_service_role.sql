-- ============================================================================
-- 0009 — Fix: the privilege guard was locking out the service role
--
-- Found by an end-to-end RLS probe (a real signed-in user, not the service-role
-- client that bypasses RLS and therefore proves nothing).
--
-- The guard from 0002 blocks a non-admin from changing usuarios.perfil_id /
-- ativo. It decides "is the caller an admin?" with app_is_admin(), which
-- resolves auth.uid(). For the SERVICE ROLE, auth.uid() is NULL — there is no
-- signed-in user — so app_is_admin() returns false and the guard blocked the
-- service role too.
--
-- That is precisely backwards. Every legitimate admin mutation (assign a perfil,
-- deactivate a user) runs server-side on the service role, per the spec. So the
-- guard was blocking the ONLY code path allowed to do these things, while the
-- attack it defends against (a user escalating their own perfil over PostgREST)
-- was already covered.
--
-- Fix: the guard only applies to the `authenticated` role. auth.role() reads the
-- JWT claim, so it distinguishes a signed-in user from the service role. Direct
-- SQL (migrations, psql) has no JWT at all → null → not guarded, which is right:
-- anyone with a direct connection is already superuser.
--
-- The authorization for admin actions therefore lives in the server action,
-- which must verify the CALLER is an admin before it ever picks up the
-- service-role client. That check is not a formality — it is the whole control.
-- ============================================================================

create or replace function usuarios_guard_campos_privilegiados()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only signed-in end users are guarded. NULL (direct SQL) and 'service_role'
  -- (trusted server-side code) pass through.
  if coalesce(auth.role(), 'service_role') <> 'authenticated' then
    return new;
  end if;

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

revoke execute on function usuarios_guard_campos_privilegiados() from public, anon, authenticated;
