-- ============================================================================
-- 0270c — Agentes: RLS, grants, bucket de materiais e Realtime
--
-- ── QUEM VÊ O QUÊ (§11) ─────────────────────────────────────────────────────
--   Ao vivo e Mandatos  gestores E o vendedor dono do escopo — o closer (ou substituto)
--                       designado do agente: as reuniões que o agente marca vão para a
--                       agenda dele, e é ele quem precisa acompanhar o que está sendo
--                       prometido em nome da casa.
--   Personas, Materiais, Desempenho, Settings   só gestores (Admin ou Comercial).
--
-- Mesmo desenho do Jurídico e da Cobrança: `authenticated` só LÊ, e toda escrita é RPC
-- SECURITY DEFINER que começa por uma das guardas abaixo. O helper vai entre parênteses
-- em toda política — `(select public.app_...())` — para o Postgres avaliar uma vez por
-- consulta, e não uma vez por linha.
-- ============================================================================

create or replace function public.app_agentes_gestor()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.app_is_admin() or public.app_gestor_comercial();
$$;

create or replace function public.app_agentes_exige_modulo()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.app_tem_modulo('agentes') then
    raise exception 'Você não tem acesso ao módulo Agentes.' using errcode = '42501';
  end if;
end $$;

create or replace function public.app_agentes_exige_gestor()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.app_agentes_exige_modulo();
  if not public.app_agentes_gestor() then
    raise exception 'Somente a gestão comercial pode fazer isso.' using errcode = '42501';
  end if;
end $$;

/*
 * Os agentes que ESTE usuário acompanha: todos, para o gestor; os que têm o vendedor dele
 * como closer (titular ou substituto), para os demais. Devolve um array para a política
 * poder usar `= any(...)` com o helper avaliado uma vez.
 */
create or replace function public.app_agentes_visiveis()
returns uuid[] language sql stable security definer set search_path = '' as $$
  select case
    when public.app_agentes_gestor() then
      coalesce((select array_agg(a.id) from public.vendedores a where a.is_ia), '{}')
    else
      coalesce((
        select array_agg(distinct a.id)
          from public.vendedores a
          join public.vendedores eu on eu.usuario_id = auth.uid()
         where a.is_ia and (a.closer_id = eu.id or a.closer_substituto_id = eu.id)
      ), '{}')
  end;
$$;

revoke all on function public.app_agentes_exige_modulo() from public, anon, authenticated;
revoke all on function public.app_agentes_exige_gestor() from public, anon, authenticated;
revoke all on function public.app_agentes_gestor() from public, anon;
revoke all on function public.app_agentes_visiveis() from public, anon;
grant execute on function public.app_agentes_exige_modulo() to service_role;
grant execute on function public.app_agentes_exige_gestor() to service_role;
-- a tela pergunta "sou gestor?" para esconder abas; a resposta é sobre quem pergunta
grant execute on function public.app_agentes_gestor() to authenticated, service_role;
grant execute on function public.app_agentes_visiveis() to authenticated, service_role;

-- ─── Revoga tudo e liga RLS ─────────────────────────────────────────────────

do $$
declare
  t text;
begin
  foreach t in array array[
    'agentes_config', 'email_caixas', 'mandato_regras', 'mandato_sequencias', 'mandatos',
    'mandato_acoes', 'mandato_conversas', 'mandato_plano_versoes', 'mandato_propostas',
    'materiais', 'agentes_orcamento', 'agentes_orcamento_movimentos', 'agentes_disjuntor',
    'agenda_reservas'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- A sequência de códigos é interna: nem leitura.

-- ─── Leitura para quem tem o módulo (dado operacional, sem segredo) ─────────

do $$
declare
  t text;
begin
  foreach t in array array['agentes_config', 'materiais', 'agentes_orcamento', 'agentes_disjuntor'] loop
    execute format('grant select on public.%I to authenticated', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select public.app_tem_modulo(''agentes'')))',
      t || '_select', t);
  end loop;
end $$;

-- ─── Só gestores ────────────────────────────────────────────────────────────

do $$
declare
  t text;
begin
  foreach t in array array['email_caixas', 'mandato_regras', 'agentes_orcamento_movimentos', 'agenda_reservas'] loop
    execute format('grant select on public.%I to authenticated', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select public.app_tem_modulo(''agentes'')) and (select public.app_agentes_gestor()))',
      t || '_select', t);
  end loop;
end $$;

-- ─── Mandatos e o que pende deles: pelo agente ──────────────────────────────

grant select on public.mandatos, public.mandato_acoes, public.mandato_conversas,
  public.mandato_plano_versoes, public.mandato_propostas to authenticated;

create policy mandatos_select on public.mandatos
  for select to authenticated using (
    (select public.app_tem_modulo('agentes')) and agente_id in (select unnest(public.app_agentes_visiveis()))
  );

create policy mandato_acoes_select on public.mandato_acoes
  for select to authenticated using (
    (select public.app_tem_modulo('agentes')) and agente_id in (select unnest(public.app_agentes_visiveis()))
  );

-- As duas abaixo herdam a régua de `mandatos` por `exists`: a policy dele roda para
-- quem consulta, então a regra não é copiada (e não sai do lugar com o tempo).
create policy mandato_conversas_select on public.mandato_conversas
  for select to authenticated using (
    exists (select 1 from public.mandatos m where m.id = mandato_conversas.mandato_id)
  );

create policy mandato_plano_versoes_select on public.mandato_plano_versoes
  for select to authenticated using (
    exists (select 1 from public.mandatos m where m.id = mandato_plano_versoes.mandato_id)
  );

create policy mandato_propostas_select on public.mandato_propostas
  for select to authenticated using (
    (select public.app_tem_modulo('agentes')) and agente_id in (select unnest(public.app_agentes_visiveis()))
  );

-- ─── A view da população ────────────────────────────────────────────────────
-- security_invoker: a RLS de `empresas` vale para quem consulta (prévia de escopo na tela).
revoke all on public.agentes_empresas_alvo from anon, authenticated;
grant select on public.agentes_empresas_alvo to authenticated;

-- ─── voz_ligacoes: a ligação de mandato herda a régua do mandato ────────────
--
-- A policy da 0225 via a ligação pela NOTA (`exists notas_fiscais`). A ligação de mandato
-- pode não ter nota nenhuma (§4.3), e sumiria da tela de quem acompanha o mandato. Agora:
-- pela nota quando há nota, pelo mandato quando há mandato — as duas por `exists`, cada
-- uma aplicando a policy da tabela de origem.
drop policy if exists voz_ligacoes_select on public.voz_ligacoes;
create policy voz_ligacoes_select on public.voz_ligacoes
  for select to authenticated using (
    (access_key is not null and exists (
      select 1 from public.notas_fiscais nf where nf.access_key = voz_ligacoes.access_key))
    or (mandato_id is not null and exists (
      select 1 from public.mandatos m where m.id = voz_ligacoes.mandato_id))
  );

-- ─── Bucket privado `agentes-materiais` ─────────────────────────────────────
/*
 * Os arquivos da biblioteca (§5). Leitura para quem tem o módulo (a pré-visualização na
 * tela); escrita só do gestor. O worker lê com service role para gerar a URL assinada que
 * vai no WhatsApp e para baixar os bytes que vão no e-mail.
 */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('agentes-materiais', 'agentes-materiais', false, 26214400,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'video/mp4',
              'audio/mpeg', 'audio/ogg', 'text/plain'])
on conflict (id) do nothing;

create policy agentes_materiais_select on storage.objects
  for select to authenticated
  using (bucket_id = 'agentes-materiais' and (select public.app_tem_modulo('agentes')));

create policy agentes_materiais_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'agentes-materiais' and (select public.app_agentes_gestor()));

-- ─── Realtime (§11.1 Ao vivo) ───────────────────────────────────────────────
-- `postgres_changes` respeita a RLS acima: cada um recebe só os eventos que leria.
alter publication supabase_realtime add table public.mandatos, public.mandato_acoes;
