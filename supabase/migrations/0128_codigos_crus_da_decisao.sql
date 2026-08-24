-- ─── Os códigos crus da seguradora ──────────────────────────────────────────
--
-- `estagio` é uma TRADUÇÃO do que a Atradius devolveu, e tradução perde o original.
-- Quando seis coberturas em vigor apareceram gravadas como `negada`, não havia como
-- decidir se o erro estava no mapa (`DECISAO_PARA_ESTAGIO`) ou no dado — o campo que
-- responderia tinha sido descartado na leitura.
--
-- Guardar o código não é redundância: é o que permite corrigir o mapa depois sem precisar
-- reler a apólice inteira, e o que torna auditável a frase "esta empresa está coberta".

alter table public.analises_credito
  add column if not exists codigo_decisao text,
  add column if not exists codigo_historico text;

comment on column public.analises_credito.codigo_decisao is
  'decisionCode cru da Atradius (DC01..DC22). O estagio é a tradução dele; este é o original.';
comment on column public.analises_credito.codigo_historico is
  'historicCode cru (CCLD, ECLD, WCLD...), presente quando a cobertura já terminou.';

create index if not exists analises_credito_codigo_decisao_idx
  on public.analises_credito (codigo_decisao)
  where codigo_decisao is not null;
