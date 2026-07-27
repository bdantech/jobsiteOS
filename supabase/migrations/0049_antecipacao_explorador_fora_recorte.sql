-- =============================================================================
-- 0049 — Antecipação: `fora_recorte_cnae` chega ao Explorador
--
-- O lookup cadastral (§3.1) insere fornecedores de NF em mercado_universo com
-- origem_ingestao = 'lookup'. Muitos têm CNAE de comércio/indústria: precisam
-- EXISTIR (senão as variáveis de faixa e a Company 360 ficam cegas para eles) sem
-- subir na pirâmide comercial. A regra do TAM (0048) passou a exigir
-- fora_recorte_cnae = false — o que só funciona se a variável for coluna real da
-- view E estiver na whitelist do compilador SECURITY DEFINER (0026/0035).
--
-- CREATE OR REPLACE VIEW só permite APPEND, então a definição de 0031 é repetida
-- por inteiro com as duas colunas novas no fim.
-- =============================================================================

create or replace view mercado_explorador with (security_invoker = true) as
 select u.cnpj,
    u.razao_social,
    u.nome_fantasia,
    u.situacao_cadastral,
    u.natureza_juridica,
    u.porte_rfb,
    u.cnae_principal,
    u.cnaes_todos,
    u.cnae_grupos,
    u.capital_social,
    u.data_inicio_atividade,
    u.uf,
    u.municipio,
    coalesce(u.opcao_simples, false) as opcao_simples,
    u.data_exclusao_simples,
    u.is_spe,
    u.grupo_id,
    u.grafo_sefaz,
    u.camada,
    u.camada_regra_versao,
    u.empresa_id,
    e.estagio,
    e.tipo,
    e.erp_atual,
    e.erp_mrr,
    e.erp_detalhes,
    e.churn_erp_concorrente,
    (e.erp_detalhes ->> 'qtd_usuarios'::text)::integer as qtd_usuarios_erp,
    ((e.erp_detalhes ->> 'usuarios_ativos'::text)::numeric)
      / nullif((e.erp_detalhes ->> 'qtd_usuarios'::text)::numeric, 0::numeric) as ratio_usuarios_ativos,
    coalesce(m.qtd_filiais, 0) as qtd_filiais,
    coalesce(m.grupo_spes_total, 0) as grupo_spes_total,
    coalesce(m.grupo_spes_24m, 0) as grupo_spes_24m,
    coalesce(m.grupo_ufs, '{}'::text[]) as grupo_ufs,
    coalesce(m.obras_ativas, 0) as obras_ativas,
    coalesce(m.obras_iniciadas_24m, 0) as obras_iniciadas_24m,
    coalesce(m.m2_em_execucao, 0::numeric) as m2_em_execucao,
    coalesce(m.tem_contato, false) as tem_contato,
    -- ── Radar (0031) ────────────────────────────────────────────────────────
    coalesce(e.dominio, u.dominio) as dominio,
    coalesce(e.dominio_confianca, u.dominio_confianca) as dominio_confianca,
    e.dominio_validado_em as dominio_consultado_em,
    coalesce(ct.qtd, 0) as qtd_contatos,
    ct.ult as contatos_enriquecidos_em,
    pa.tem_protesto as tem_protesto,
    pa.consultado_em as protestos_consultados_em,
    (co.cnpj is not null) as e_cliente_onepay,
    co.days_without_anticipation as dias_sem_antecipar,
    co.consumed_pct as consumed_pct,
    -- ── Antecipação (0049) ──────────────────────────────────────────────────
    coalesce(u.origem_ingestao, 'receita_dump') as origem_ingestao,
    coalesce(u.fora_recorte_cnae, false) as fora_recorte_cnae
   from mercado_universo u
     left join empresas e on e.id = u.empresa_id
     left join mercado_metricas m on m.cnpj = u.cnpj
     left join protestos_atual pa on pa.cnpj = u.cnpj
     left join clientes_onepay co on co.cnpj = u.cnpj
     left join lateral (
       select count(*)::int as qtd, max(c.enriquecido_em) as ult
       from contatos c where c.empresa_id = u.empresa_id
     ) ct on true;

-- Índice parcial: a regra do TAM agora carrega `fora_recorte_cnae = false` em toda
-- reclassificação, e a esmagadora maioria das linhas é false. O índice serve para
-- o caminho oposto — listar/contar rapidamente os que ENTRARAM por lookup.
create index mercado_universo_fora_recorte_idx
  on mercado_universo (cnpj) where fora_recorte_cnae;
create index mercado_universo_origem_ingestao_idx
  on mercado_universo (origem_ingestao);

-- ─── Whitelist do compilador do Explorador (0026/0035) ──────────────────────
create or replace function public.mercado_pred(no jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare
  col text; op text; v text; arr text[]; parts text[]; child jsonb;
begin
  if no ? 'c' then
    parts := array[]::text[];
    for child in select * from jsonb_array_elements(no->'c') loop
      parts := parts || public.mercado_pred(child);
    end loop;
    if array_length(parts,1) is null then return 'true'; end if;
    return '(' || array_to_string(parts, case when no->>'op' = 'ou' then ' or ' else ' and ' end) || ')';
  end if;

  col := no->>'col';
  if col not in (
    'cnpj','razao_social','nome_fantasia','situacao_cadastral','natureza_juridica','porte_rfb',
    'cnae_principal','cnaes_todos','cnae_grupos','capital_social','data_inicio_atividade','uf',
    'municipio','opcao_simples','data_exclusao_simples','is_spe','grupo_id','grafo_sefaz','camada',
    'camada_regra_versao','empresa_id','estagio','tipo','erp_atual','erp_mrr','churn_erp_concorrente',
    'qtd_usuarios_erp','ratio_usuarios_ativos','qtd_filiais','grupo_spes_total','grupo_spes_24m',
    'grupo_ufs','obras_ativas','obras_iniciadas_24m','m2_em_execucao','tem_contato',
    -- Radar (0031)
    'dominio','dominio_confianca','dominio_consultado_em','qtd_contatos','contatos_enriquecidos_em',
    'tem_protesto','protestos_consultados_em','e_cliente_onepay','dias_sem_antecipar','consumed_pct',
    -- Antecipação (0049)
    'origem_ingestao','fora_recorte_cnae'
  ) then
    raise exception 'coluna não permitida no filtro: %', col using errcode = '42501';
  end if;

  op := no->>'op';
  v := no->>'v';
  case op
    when 'igual' then return format('%I = %L', col, v);
    when 'diferente' then return format('%I is distinct from %L', col, v);
    when 'maior_que' then return format('%I > %L', col, v);
    when 'maior_ou_igual' then return format('%I >= %L', col, v);
    when 'menor_que' then return format('%I < %L', col, v);
    when 'menor_ou_igual' then return format('%I <= %L', col, v);
    when 'contem' then return format('%I ilike %L', col, '%'||v||'%');
    when 'comeca_com' then return format('%I ilike %L', col, v||'%');
    when 'definido' then return format('%I is not null', col);
    when 'nao_definido' then return format('%I is null', col);
    when 'em' then
      select array_agg(x) into arr from jsonb_array_elements_text(no->'v') x;
      return format('%I = any(%L::text[])', col, arr);
    when 'nao_em' then
      select array_agg(x) into arr from jsonb_array_elements_text(no->'v') x;
      return format('(%I is null or %I <> all(%L::text[]))', col, col, arr);
    when 'contem_algum' then
      select array_agg(x) into arr from jsonb_array_elements_text(no->'v') x;
      return format('%I && %L::text[]', col, arr);
    when 'entre' then
      return format('%I between %L and %L', col, no->'v'->>0, no->'v'->>1);
    else
      raise exception 'operador não suportado no filtro: %', op using errcode = '42501';
  end case;
end $$;
revoke all on function public.mercado_pred(jsonb) from public, authenticated, anon;

-- ─── TAM: fornecedores de fora do recorte não sobem na pirâmide (§3.1) ───────
-- O lookup cadastral insere em mercado_universo os CNPJs de fornecedores que a
-- NF trouxe. Muitos são comércio/indústria: precisam EXISTIR (para as variáveis
-- de faixa e a Company 360) sem poluir o universo comercial. A regra do TAM
-- passa a exigir fora_recorte_cnae = false; SAM e SOM herdam por serem
-- cumulativas (repetem as condições do TAM).
insert into camada_regras (camada, versao, definicao, ativa)
select 'tam', coalesce(max(versao), 0) + 1,
  '{
    "operador": "e",
    "condicoes": [
      { "variavel": "situacao_cadastral", "operador": "igual", "valor": "ativa" },
      { "variavel": "cnae_grupo", "operador": "contem_algum", "valor": ["41", "42", "43"] },
      { "variavel": "idade_anos", "operador": "maior_ou_igual", "valor": 3 },
      { "variavel": "capital_social", "operador": "maior_ou_igual", "valor": 500000 },
      { "variavel": "fora_recorte_cnae", "operador": "igual", "valor": false }
    ]
  }'::jsonb,
  false
from camada_regras where camada = 'tam';

update camada_regras set ativa = false where camada = 'tam' and ativa;
update camada_regras set ativa = true
  where id = (select id from camada_regras where camada = 'tam' order by versao desc limit 1);

insert into camada_regras (camada, versao, definicao, ativa)
select 'sam', coalesce(max(versao), 0) + 1,
  '{
    "operador": "e",
    "condicoes": [
      { "variavel": "situacao_cadastral", "operador": "igual", "valor": "ativa" },
      { "variavel": "cnae_grupo", "operador": "contem_algum", "valor": ["41", "42", "43"] },
      { "variavel": "idade_anos", "operador": "maior_ou_igual", "valor": 3 },
      { "variavel": "capital_social", "operador": "maior_ou_igual", "valor": 500000 },
      { "variavel": "fora_recorte_cnae", "operador": "igual", "valor": false },
      { "variavel": "uf", "operador": "em", "valor": ["SP", "SC", "PR", "RS", "MG", "RJ", "GO", "DF"] },
      {
        "operador": "ou",
        "condicoes": [
          { "variavel": "qtd_filiais", "operador": "maior_ou_igual", "valor": 1 },
          { "variavel": "capital_social", "operador": "maior_ou_igual", "valor": 2000000 },
          { "variavel": "grupo_spes_total", "operador": "maior_ou_igual", "valor": 1 }
        ]
      }
    ]
  }'::jsonb,
  false
from camada_regras where camada = 'sam';

update camada_regras set ativa = false where camada = 'sam' and ativa;
update camada_regras set ativa = true
  where id = (select id from camada_regras where camada = 'sam' order by versao desc limit 1);

insert into camada_regras (camada, versao, definicao, ativa)
select 'som', coalesce(max(versao), 0) + 1,
  '{
    "operador": "e",
    "condicoes": [
      { "variavel": "situacao_cadastral", "operador": "igual", "valor": "ativa" },
      { "variavel": "cnae_grupo", "operador": "contem_algum", "valor": ["41", "42", "43"] },
      { "variavel": "idade_anos", "operador": "maior_ou_igual", "valor": 3 },
      { "variavel": "capital_social", "operador": "maior_ou_igual", "valor": 500000 },
      { "variavel": "fora_recorte_cnae", "operador": "igual", "valor": false },
      { "variavel": "uf", "operador": "em", "valor": ["SP", "SC", "PR", "RS", "MG", "RJ", "GO", "DF"] },
      {
        "operador": "ou",
        "condicoes": [
          { "variavel": "qtd_filiais", "operador": "maior_ou_igual", "valor": 1 },
          { "variavel": "capital_social", "operador": "maior_ou_igual", "valor": 2000000 },
          { "variavel": "grupo_spes_total", "operador": "maior_ou_igual", "valor": 1 }
        ]
      },
      {
        "operador": "ou",
        "condicoes": [
          { "variavel": "no_grafo_sefaz", "operador": "igual", "valor": true },
          { "variavel": "erp_conhecido", "operador": "igual", "valor": true },
          { "variavel": "grupo_spes_24m", "operador": "maior_ou_igual", "valor": 2 },
          { "variavel": "obras_ativas", "operador": "maior_ou_igual", "valor": 1 },
          { "variavel": "churn_erp_concorrente", "operador": "igual", "valor": true }
        ]
      }
    ]
  }'::jsonb,
  false
from camada_regras where camada = 'som';

update camada_regras set ativa = false where camada = 'som' and ativa;
update camada_regras set ativa = true
  where id = (select id from camada_regras where camada = 'som' order by versao desc limit 1);
