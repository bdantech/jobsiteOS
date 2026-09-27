-- ============================================================================
-- 0269b — Cobrança: RLS, grants, bucket privado e as duas guardas
--
-- Mesmo desenho do Jurídico (0143): `authenticated` só LÊ, e só com o módulo
-- `cobranca`; toda escrita é RPC SECURITY DEFINER que começa por
-- `app_cobranca_exige_modulo()`. O helper vai entre parênteses em toda política
-- — `(select public.app_tem_modulo(...))` — para o Postgres avaliar uma vez por
-- consulta, e não uma por linha.
--
-- ── GESTOR ──────────────────────────────────────────────────────────────────
-- Não há `app_is_gestor` genérico na casa (o do Comercial é por nome de perfil).
-- Aqui é o mesmo desenho: Admin, ou o perfil "Gestor de Cobrança". Gestor é quem
-- edita modelos e settings, regulariza o sacado e vê os números consolidados.
-- ============================================================================

create or replace function public.app_cobranca_exige_modulo()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.app_tem_modulo('cobranca') then
    raise exception 'Você não tem acesso ao módulo Cobrança.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.app_cobranca_gestor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.app_is_admin() or exists (
    select 1 from public.usuarios u join public.perfis p on p.id = u.perfil_id
    where u.id = auth.uid() and u.ativo and p.nome = 'Gestor de Cobrança'
  );
$$;

create or replace function public.app_cobranca_exige_gestor()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.app_cobranca_exige_modulo();
  if not public.app_cobranca_gestor() then
    raise exception 'Somente a gestão de cobrança pode fazer isso.' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.app_cobranca_exige_modulo() from public, anon, authenticated;
revoke all on function public.app_cobranca_exige_gestor() from public, anon, authenticated;
revoke all on function public.app_cobranca_gestor() from public, anon;
grant execute on function public.app_cobranca_exige_modulo() to service_role;
grant execute on function public.app_cobranca_exige_gestor() to service_role;
-- a tela pergunta "sou gestor?" para esconder botões; a resposta é sobre quem pergunta
grant execute on function public.app_cobranca_gestor() to authenticated, service_role;

-- ─── Tabelas: revoga tudo, liga RLS, concede SELECT com o módulo ────────────

do $$
declare
  t text;
begin
  foreach t in array array[
    'cobranca_config', 'titulos', 'cobranca_modelos', 'cobrancas', 'cobranca_titulos',
    'cobranca_notificacoes', 'cobranca_notificacao_titulos', 'cobranca_notificacao_entregas',
    'cobranca_interacoes', 'apolices', 'sinistros', 'sinistro_titulos', 'sinistro_documentos',
    'sinistro_solicitacoes', 'sinistro_custos', 'apolice_prazos', 'cobranca_insolvencias',
    'protesto_remessas', 'protesto_titulos', 'acordos'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select public.app_tem_modulo(''cobranca'')))',
      t || '_select', t);
  end loop;
end $$;

-- A sequência de códigos é interna: nem leitura.
alter table public.cobranca_sequencias enable row level security;
revoke all on public.cobranca_sequencias from anon, authenticated;

-- ─── Bucket privado `cobrancas` ─────────────────────────────────────────────
/*
 * Layout: `{cobranca_id}/notificacoes/…`, `{cobranca_id}/entregas/…`,
 * `{cobranca_id}/acordos/…`, `{cobranca_id}/protestos/…`,
 * `sinistros/{sinistro_id}/…`. O PDF enviado é imutável: não há política de
 * UPDATE nem de DELETE para `authenticated`, e o worker grava com `upsert: false`
 * — uma alteração vira nova rodada, com arquivo novo.
 */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cobrancas', 'cobrancas', false, 52428800,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic',
              'application/zip', 'text/csv', 'text/plain', 'application/xml', 'text/xml',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;

create policy cobrancas_select on storage.objects
  for select to authenticated
  using (bucket_id = 'cobrancas' and (select public.app_tem_modulo('cobranca')));

create policy cobrancas_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'cobrancas' and (select public.app_tem_modulo('cobranca')));
