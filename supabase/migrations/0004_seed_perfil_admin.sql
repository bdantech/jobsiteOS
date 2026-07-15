-- ============================================================================
-- 0004 — Seed: the Admin profile
-- Idempotent. The admin USER is not created here: auth.users can only be
-- populated through the Supabase Admin API (it needs a properly hashed
-- password), so `pnpm seed` creates the auth user with SEED_ADMIN_EMAIL and
-- links it to this profile.
--
-- Module ids must match AppModule.id in packages/core/registry.
-- ============================================================================

insert into perfis (nome, descricao)
values ('Admin', 'Acesso total a todos os módulos')
on conflict (nome) do nothing;

insert into perfil_modulos (perfil_id, modulo_id)
select p.id, m.modulo_id
from perfis p
cross join (values ('empresas'), ('admin'), ('notificacoes')) as m (modulo_id)
where p.nome = 'Admin'
on conflict (perfil_id, modulo_id) do nothing;
