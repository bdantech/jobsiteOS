-- 0243 — O nome do fornecedor cai no universo quando o payload não traz
--
-- A pré-autorização mais valiosa do primeiro sync — R$ 2,35 milhões da VL
-- Construtora, expirando em três dias — chegou com `contracted.name: null` e
-- `registered: false`. E está certo: é uma oferta a um fornecedor que ainda NÃO É
-- NOSSO, a oportunidade de aquisição mais qualificada que existe. O card dela
-- dizia "Sem cadastro".
--
-- Das 99 ofertas sem nome, 60 já tinham razão social em `mercado_universo`. O nome
-- estava aqui o tempo todo; ninguém tinha ido buscá-lo. As 39 restantes o sync já
-- enfileirou em `cnpj_lookup_fila` e aparecem quando o enriquecimento rodar.
--
-- A ordem é payload → razão social → nome fantasia → "Sem cadastro", e ela importa:
-- o nome que o outro lado mandou vale MAIS que o da Receita, porque é como a
-- construtora chama aquele fornecedor.
--
-- Os dois joins com `mercado_universo` já existiam nas views — eram usados só para
-- UF, capital social e situação cadastral.
--
-- A definição é lida do banco VIVO e emendada num ponto único e VERIFICADO. São
-- setenta colunas; reescrevê-las para trocar uma expressão é como se perde uma das
-- outras sessenta e nove sem ninguém notar.
do $$
declare
  v_def text;
  v_ancora text;
  v_novo text;
begin
  select pg_get_viewdef('public.funil_oportunidades_preauth'::regclass, true) into v_def;
  v_ancora := 'COALESCE(pa.fornecedor_nome, ''Sem cadastro''::text)';
  v_novo   := 'COALESCE(pa.fornecedor_nome, fu.razao_social, fu.nome_fantasia, ''Sem cadastro''::text)';

  if (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora) <> 1 then
    raise exception 'Âncora do nome não aparece exatamente uma vez em funil_oportunidades_preauth.';
  end if;

  execute 'create or replace view public.funil_oportunidades_preauth as '
          || replace(v_def, v_ancora, v_novo);

  -- No título o fallback entra ANTES do "Credor PF": um credor pessoa física não
  -- tem CNPJ, então nunca está no universo, e o CASE continua sendo a última
  -- palavra para ele. Para o credor PJ sem cadastro, a razão social passa na frente.
  select pg_get_viewdef('public.funil_oportunidades_titulo'::regclass, true) into v_def;
  v_ancora := 'COALESCE(st.credor_nome,';
  v_novo   := 'COALESCE(st.credor_nome, cu.razao_social, cu.nome_fantasia,';

  if (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora) <> 1 then
    raise exception 'Âncora do nome não aparece exatamente uma vez em funil_oportunidades_titulo.';
  end if;

  execute 'create or replace view public.funil_oportunidades_titulo as '
          || replace(v_def, v_ancora, v_novo);
end $$;

-- `create or replace view` PERDE `security_invoker`, e sem ela a view ignora a RLS
-- das tabelas de base. Toda migração que recria uma view do funil reafirma isto.
alter view public.funil_oportunidades_preauth set (security_invoker = true);
alter view public.funil_oportunidades_titulo set (security_invoker = true);
