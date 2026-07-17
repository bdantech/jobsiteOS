-- Índices para ordenar o Explorador por colunas DO UNIVERSO sem full sort de 876k.
-- Ajudam os sorts ASC dessas colunas (o padrão é cnpj, que usa a PK). Sorts DESC e por
-- colunas de MÉTRICA/ERP (que vivem em outras tabelas) continuam pesados no caso sem
-- filtro — a solução uniforme é denormalizar as métricas no universo (próximo passo).
create index if not exists mercado_universo_razao_ord_idx on mercado_universo (razao_social, cnpj);
create index if not exists mercado_universo_capital_idx on mercado_universo (capital_social, cnpj);
create index if not exists mercado_universo_municipio_ord_idx on mercado_universo (municipio, cnpj);
create index if not exists mercado_universo_porte_idx on mercado_universo (porte_rfb, cnpj);
create index if not exists mercado_universo_natureza_idx on mercado_universo (natureza_juridica, cnpj);
