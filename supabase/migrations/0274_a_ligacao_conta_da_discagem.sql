-- ============================================================================
-- 0274 — A ligação conta o prazo da discagem, não da entrada na fila
--
-- A resposta da Ana à v2 (28/09/2026) mudou uma premissa da 0270a. A fila dela é UMA
-- ligação por vez (~3 min cada), e só anda das 9h às 18h em dias úteis. A varredura de
-- órfãs contava `voz_timeout_minutos` (30) a partir de `enviada_em` — a entrada na fila
-- dela. Cinco ligações na frente já passam dos 30 minutos; uma enviada às 17h40 é
-- discada no dia seguinte. Em ambos os casos a varredura marcava `falhou`, o mandato
-- acordava, o agente ligava de novo com outro `id_externo` — e a Ana ligava duas vezes.
--
-- A v2 emite `ligacao.iniciada` no momento da discagem. Agora:
--   • `iniciada_em` guarda esse instante (o worker grava quando o evento chega);
--   • a varredura desta função só olha ligações JÁ DISCADAS: `iniciada_em` há mais de
--     `voz_timeout_minutos` sem `ligacao.encerrada`;
--   • a ligação que nunca foi discada é problema da FILA, não do timeout, e é tratada no
--     worker (varrer-orfas.ts): passado o fim do expediente em que devia ser discada, ele
--     pede o `DELETE` à Ana e só marca como falha o que ela confirmou que não vai discar.
--
-- O `ligacao.iniciada` é melhor esforço do lado da Ana (sem reenvio). Se ele se perder, a
-- ligação cai no caminho da fila, e o `ligacao.encerrada` — durável — continua fechando
-- a linha normalmente: o DELETE depois da discagem volta 409 e a linha é deixada em paz.
-- ============================================================================

alter table public.voz_ligacoes add column if not exists iniciada_em timestamptz;

comment on column public.voz_ligacoes.iniciada_em is
  'Quando a Ana discou (evento ligacao.iniciada da v2). Nulo = ainda na fila dela, ou evento perdido.';

-- Corpo de partida: `pg_get_functiondef` em 28/09/2026 (a versão da 0270d). Mudou só o
-- critério: `iniciada_em` em vez de `coalesce(enviada_em, atualizada_em)`, e a mensagem.
create or replace function public.app__voz_varrer_orfas(p_minutos int)
returns table (id uuid, id_externo text, mandato_id uuid)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  update public.voz_ligacoes v set
    status = 'falhou',
    erro = 'timeout: discada há ' || p_minutos || ' minutos e sem resultado da Ana',
    motivo_recusa = 'timeout',
    encerrada_em = now()
  where v.status = 'enviada'
    and v.iniciada_em is not null
    and v.iniciada_em < now() - make_interval(mins => greatest(p_minutos, 5))
  returning v.id, v.id_externo, v.mandato_id;
end $$;

revoke all on function public.app__voz_varrer_orfas(int) from public, anon, authenticated;
grant execute on function public.app__voz_varrer_orfas(int) to service_role;
