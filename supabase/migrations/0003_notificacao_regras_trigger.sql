-- ============================================================================
-- 0003 — Notification rules trigger
-- When an empresa_eventos row of a subscribed `tipo` is created, fan it out to
-- `notificacoes`. Rules themselves get populated by future modules; this wires
-- the mechanism so they only have to insert a row into notificacao_regras.
--
-- Scope note: this writes the in-app notification rows. Actual PUSH delivery
-- (VAPID / Expo) is done by the server-side notify() helper in packages/core,
-- which the app calls after a mutation. Events written directly to the database
-- (e.g. by a future cron) therefore land in the bell, not on the lock screen.
-- ============================================================================

create or replace function fanout_evento_para_notificacoes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa_nome text;
  v_titulo text;
begin
  select coalesce(e.nome_fantasia, e.razao_social, e.cnpj)
    into v_empresa_nome
  from public.empresas e
  where e.id = new.empresa_id;

  v_titulo := coalesce(v_empresa_nome, 'Empresa') || ' — ' || new.tipo;

  insert into public.notificacoes (usuario_id, titulo, corpo, url)
  select
    destinatario.id,
    v_titulo,
    new.payload ->> 'resumo',
    case when new.empresa_id is not null
         then '/empresas/' || new.empresa_id::text
         else null
    end
  from (
    -- Rules targeting a whole profile: every active user carrying it.
    select u.id
    from public.notificacao_regras r
    join public.usuarios u on u.perfil_id = r.perfil_id
    where r.ativo
      and r.tipo_evento = new.tipo
      and r.perfil_id is not null
      and u.ativo

    union

    -- Rules targeting one specific user.
    select u.id
    from public.notificacao_regras r
    join public.usuarios u on u.id = r.usuario_id
    where r.ativo
      and r.tipo_evento = new.tipo
      and r.usuario_id is not null
      and u.ativo
  ) as destinatario
  -- Don't notify someone about their own action.
  where new.ator_usuario_id is null
     or destinatario.id <> new.ator_usuario_id;

  return new;
end;
$$;

create trigger empresa_eventos_fanout
  after insert on empresa_eventos
  for each row
  execute function fanout_evento_para_notificacoes();
