-- ═════════════════════════════════════════════════════════════════════════════
-- 0161 — A análise que nasce pela API precisa caber no CHECK de `origem`
--
-- `analises_credito.origem` responde QUAL SISTEMA criou a linha, e a lista era
-- ('jobsiteos', 'atradius_backfill'). A API do 04n é um terceiro, e sem ele no
-- CHECK toda criação vinda da plataforma de produção morria com 23514 — descoberto
-- num teste de ponta a ponta antes de a rota ir para produção.
--
-- ─── E O `origem` DO PAYLOAD NÃO É ESTE ────────────────────────────────────
-- O corpo da API traz `origem: cadastro_plataforma | solicitacao_cliente |
-- renovacao`, que é o MOTIVO do pedido — por que a produção está pedindo —, não o
-- sistema que o criou. São duas perguntas diferentes, e enfiar as duas na mesma
-- coluna faria a esteira perder a distinção entre "veio da API" e "veio de uma
-- renovação": a segunda é um dado de negócio que o time de Crédito lê, a primeira
-- é procedência.
--
-- Por isso a coluna nova. A alternativa seria guardar o motivo dentro de
-- `contato_externo`, que é um campo chamado "contato" — e um dado escondido num
-- campo com outro nome é um dado que ninguém encontra.
-- ═════════════════════════════════════════════════════════════════════════════

alter table public.analises_credito drop constraint if exists analises_credito_origem_check;

alter table public.analises_credito
  add constraint analises_credito_origem_check
  check (origem = any (array['jobsiteos'::text, 'atradius_backfill'::text, 'api_producao'::text]));

alter table public.analises_credito add column if not exists origem_motivo text;

comment on column public.analises_credito.origem_motivo is
  'Por que a integração pediu a análise (cadastro_plataforma, solicitacao_cliente, '
  'renovacao). Distinto de `origem`, que diz qual SISTEMA a criou.';
