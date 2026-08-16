-- =============================================================================
-- 0110 — O endpoint mudou: papel explícito, everApproved e company_type
--
-- O contrato da fonte foi atualizado, e três mudanças dele apagam problemas que a
-- gente vinha contornando com heurística:
--
--   `everApproved` — agregado sobre TODO o histórico do par empresa+papel e
--     independente do filtro de status. É a resposta autoritativa para "foi
--     cliente?". Até aqui a classificação inferia isso por limite concedido > 0,
--     que é proxy: acertava, mas por sorte estrutural.
--
--   FILIAL NÃO GERA LINHA — a análise pertence ao documento da matriz. As cinco
--     filiais da VALKA que poluíram a primeira carga somem na origem. O guard de
--     raiz/grupo (0109) continua, como defesa em profundidade.
--
--   DOCUMENTO SEM CADASTRO NÃO É DEVOLVIDO — a lista "análise aprovada, nunca
--     cadastrada" perde a fonte. Não removemos a view: ela é dirigida por dado, e
--     volta a se encher se a plataforma expuser esses casos. A tela é que passou a
--     dizer por que está vazia, porque "vazio porque não há" e "vazio porque a fonte
--     não conta" são indistinguíveis para quem só vê a tela.
--
-- A fonte também passa a devolver os DOIS PAPÉIS (drawee e assignor), um item por
-- par. A tabela continua guardando só `drawee` — cedente não é cliente neste
-- sentido — mas agora isso é uma coluna e não uma suposição.
-- =============================================================================

alter table public.analises_plataforma add column role text not null default 'drawee';
alter table public.analises_plataforma add column ever_approved boolean;
alter table public.analises_plataforma add column company_type text;

comment on column public.analises_plataforma.role is
  'Papel do par empresa+análise. A tabela guarda SÓ `drawee`: o cedente não é cliente '
  'neste sentido, e misturá-lo faria fornecedor virar ex-cliente da carteira. As linhas '
  'anteriores à 0110 vieram todas de um pedido com role=drawee, daí o default.';

comment on column public.analises_plataforma.ever_approved is
  'O par empresa+papel já teve aprovação em ALGUM momento, agregado sobre todo o '
  'histórico e independente do status devolvido. É a resposta autoritativa para "foi '
  'cliente?" — antes disso a classificação inferia pelo limite concedido, que é proxy.';

comment on column public.analises_plataforma.company_type is
  'Tipo de cadastro na plataforma, em português (Construtora, Fornecedor de Material…).';

-- A view "atual" passa a ser explícita sobre o recorte de papel: agora que a fonte
-- devolve os dois, deixar implícito é como um cedente entraria na lista de ex-clientes.
create or replace view public.analises_plataforma_atual
with (security_invoker = true) as
  select distinct on (cnpj)
    cnpj, id_externo, empresa_cadastrada, onepay_company_id, company_name,
    status, expiration_date, credit_limit, consumed_limit, available_limit,
    monthly_rate_d0, monthly_rate_d1, fee_d0, fee_d1, max_anticipation_value,
    has_insurance, fidc_ready, sincronizada_em,
    ever_approved, company_type
  from public.analises_plataforma
  where role = 'drawee'
  order by cnpj, (status = 'approved') desc, expiration_date desc nulls last, id_externo desc;

grant select on public.analises_plataforma_atual to authenticated;
