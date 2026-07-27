-- =============================================================================
-- 0054 — Antecipação: dois campos do payload que estavam sendo descartados
--
-- Com o payload real em mãos, dois dados que chegam e não tinham onde morar:
--
-- 1. `supplier.contact` — o FORNECEDOR é a unidade de abordagem, e este é
--    exatamente o contato que a outbox procura antes de descartar por
--    `sem_contato`. Guardávamos só `recipient.contact` (o do sacado, que é quem
--    NÃO abordamos nesta fase). Descartar o do fornecedor era jogar fora o dado
--    de que o módulo mais precisa — e depois pagar um lote no Radar para
--    redescobri-lo.
--
--    A precedência não muda: `contatos` (curado, com ponto focal) continua
--    ganhando. Este é o ÚLTIMO recurso, antes de desistir.
--
-- 2. `creditAnalysis.analyzedTaxId` — quando `viaHeadquarters` é true, a análise
--    é da MATRIZ, não do CNPJ da nota. O snapshot continua indexado pelo sacado
--    (é a nota dele que estamos precificando), mas perder QUEM foi analisado
--    tornava `via_headquarters` uma flag sem referente: dizia que houve desvio
--    sem dizer para onde.
-- =============================================================================

alter table notas_fiscais add column contato_fornecedor jsonb;

comment on column notas_fiscais.contato_fornecedor is
  'supplier.contact do payload. Último recurso na escolha de destinatário — `contatos` (curado, com ponto focal) tem precedência. É o que evita um descarte `sem_contato` quando a API já trouxe um e-mail.';

alter table credito_snapshots add column analisado_cnpj text
  constraint credito_snapshots_analisado_cnpj_check
  check (analisado_cnpj is null or analisado_cnpj ~ '^[0-9]{14}$');

comment on column credito_snapshots.analisado_cnpj is
  'creditAnalysis.analyzedTaxId — o CNPJ efetivamente analisado, que é a MATRIZ quando via_headquarters. O snapshot continua indexado por `cnpj` (o sacado da nota); esta coluna é o referente que faltava para a flag.';
