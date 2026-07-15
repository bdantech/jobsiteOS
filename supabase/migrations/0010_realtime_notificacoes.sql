-- ============================================================================
-- 0010 — Enable Realtime on notificacoes
--
-- WHY THIS EXISTS: migrations 0001–0009 never added any table to the
-- `supabase_realtime` publication. The publication exists but is EMPTY, so
-- `postgres_changes` subscriptions connect, report SUBSCRIBED, and then emit
-- absolutely nothing — a silent no-op, which is the worst possible failure mode
-- for the notifications bell (it looks wired up and simply never lights up).
--
-- The bell's live badge is a hard requirement, so the table has to be in the
-- publication. This is additive and touches no existing migration.
--
-- SECURITY: being in the publication is NOT a bypass of RLS. Realtime evaluates
-- `notificacoes_select_own` (usuario_id = auth.uid()) against the subscriber's
-- JWT for every changed row, so a socket only ever receives that user's own
-- notifications. The client additionally filters server-side by usuario_id, so
-- the row never even leaves the Realtime server for the wrong session.
--
-- Replica identity stays DEFAULT (primary key): the `new` record of an INSERT /
-- UPDATE is delivered in full regardless. REPLICA IDENTITY FULL would only add
-- the `old` record — which we don't use, and which would put a user's previous
-- notification payloads on the wire for no reason.
-- ============================================================================

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notificacoes'
  ) then
    alter publication supabase_realtime add table public.notificacoes;
  end if;
end
$$;
