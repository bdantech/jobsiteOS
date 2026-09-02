-- ═════════════════════════════════════════════════════════════════════════════
-- 0154 — O índice que garantia a idempotência não podia ser o árbitro dela
--
-- `escreverNoLedger()` grava toda mensagem — enviada e recebida — com um upsert
-- por (provedor, id_externo), que é o que torna a reentrega do webhook inofensiva.
-- O índice que sustentava essa promessa era PARCIAL:
--
--   create unique index ... on comunicacoes (provedor, id_externo)
--     where id_externo is not null;
--
-- O PostgREST emite `on conflict (provedor, id_externo)` sem predicado, e o
-- Postgres não aceita um índice parcial como árbitro de um ON CONFLICT que não
-- repete o mesmo WHERE. Toda gravação com `id_externo` levava 42P10:
--
--   there is no unique or exclusion constraint matching the ON CONFLICT
--
-- ─── O QUE ISSO CUSTOU ──────────────────────────────────────────────────────
-- Tudo que passa pelo ledger tem `id_externo`: o id que o provedor devolve no
-- envio, e o id da mensagem no recebimento. Ou seja, TODA mensagem de WhatsApp,
-- nos dois sentidos, falhava ao ser gravada. O erro só ia para o log do worker e
-- a função devolvia null; o envio seguia em frente, marcava a linha da fila como
-- `enviada` e APAGAVA o corpo — confiando num ledger que nunca recebeu nada.
--
-- Onze mensagens saíram assim, e o texto delas não existe mais em lugar nenhum.
-- A `enviar-fila.ts` passou a recusar esse apagamento na mesma mudança que esta.
--
-- ─── POR QUE UM ÍNDICE TOTAL É EQUIVALENTE ──────────────────────────────────
-- O `where id_externo is not null` existia para não travar as linhas sem id
-- externo (toque de app, registro manual) numa unicidade que não faz sentido
-- para elas. Mas em Postgres NULLs são DISTINTOS num índice único por padrão
-- (`nulls distinct`): mil linhas com `id_externo` nulo continuam convivendo sem
-- conflito. O predicado não estava protegendo nada que o comportamento padrão já
-- não protegesse — e era ele que quebrava o upsert.
-- ═════════════════════════════════════════════════════════════════════════════

drop index if exists public.comunicacoes_provedor_externo_idx;

create unique index comunicacoes_provedor_externo_idx
  on public.comunicacoes (provedor, id_externo);

comment on index public.comunicacoes_provedor_externo_idx is
  'Idempotência do ledger por id do provedor. TOTAL, e não parcial: o PostgREST '
  'usa este índice como árbitro do on-conflict e não repete predicado nenhum. '
  'NULLs seguem distintos, então as linhas sem id_externo não conflitam entre si.';
