-- Busca por nome/CNPJ no Explorador estourava o statement_timeout de 8s.
--
-- A busca compila para `razao_social ILIKE '%termo%' OR nome_fantasia ILIKE
-- '%termo%' OR cnpj ILIKE '%digitos%'` (ver components/mercado/explorador/queries.ts).
-- ILIKE com curinga à ESQUERDA não usa índice btree — então, para um termo raro
-- (poucos ou zero matches), o planner varria a mercado_universo inteira (876k) na
-- ordem do cnpj procurando 51 resultados que não vinham, e estourava os 8s.
--
-- Índices GIN de trigrama (pg_trgm) tornam o `ILIKE '%...%'` indexável: o planner
-- passa a fazer um BitmapOr dos três e resolve o termo raro em ~1ms, o count de um
-- termo comum (~50k matches) em ~380ms. Para termo comum e denso, ele ainda pode
-- preferir andar pelo índice do cnpj (acha uma página rápido) — os dois caminhos
-- ficam sob o limite.
--
-- Só leitura/índice; a query do Explorador não muda (passa pela view, e o filtro é
-- empurrado para a mercado_universo).
create extension if not exists pg_trgm;

create index if not exists mercado_universo_razao_trgm
  on mercado_universo using gin (razao_social gin_trgm_ops);

create index if not exists mercado_universo_fantasia_trgm
  on mercado_universo using gin (nome_fantasia gin_trgm_ops);

create index if not exists mercado_universo_cnpj_trgm
  on mercado_universo using gin (cnpj gin_trgm_ops);
