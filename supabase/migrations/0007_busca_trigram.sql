-- ============================================================================
-- 0007 — Make `empresas.search` actually indexable
--
-- 0001 created a GIN index over to_tsvector(razao_social || nome_fantasia).
-- Wrong tool: full-text search matches whole lexemes, so typing "const" finds
-- nothing for "CONSTRUTORA X" — but substring search is exactly what a company
-- search box is. Worse, the index could never be used by the ILIKE query the
-- tool actually issues, so it was pure write-amplification.
--
-- pg_trgm + GIN indexes ILIKE '%term%' properly.
-- ============================================================================

create extension if not exists pg_trgm;

drop index if exists empresas_busca_idx;

create index empresas_razao_social_trgm_idx
  on empresas using gin (razao_social gin_trgm_ops);
create index empresas_nome_fantasia_trgm_idx
  on empresas using gin (nome_fantasia gin_trgm_ops);
create index empresas_cnpj_trgm_idx
  on empresas using gin (cnpj gin_trgm_ops);
