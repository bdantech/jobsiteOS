-- 0246 — A ficha curada vem antes do dump da Receita
--
-- A cascata do nome (0243) parava no `mercado_universo` e esquecia `empresas` —
-- que é a NOSSA ficha, e que a view JÁ JUNTAVA para ler UF e última antecipação.
--
-- O caso que revelou: o CNPJ 45933927000112 tem ficha em `empresas` com
-- "INFORMACTION SERVICOS EMPRESARIAIS LTDA" e não está no universo. O card dizia
-- "Sem cadastro" com o nome gravado na tabela ao lado.
--
-- E era pior que cosmético: como `resolverEmpresa` o encontrou em `empresas`, ele
-- foi considerado CONHECIDO e corretamente NÃO entrou na fila de enriquecimento.
-- Nenhum job iria consertá-lo. Ele ficaria "Sem cadastro" para sempre — um buraco
-- entre duas decisões que, cada uma sozinha, estava certa.
--
-- ─── A ORDEM, E POR QUE ELA É ESTA ─────────────────────────────────────────
--
--   1. o que o PAYLOAD mandou       é como a construtora chama o fornecedor
--   2. `empresas.razao_social`      a nossa ficha, que alguém pode ter corrigido
--   3. `mercado_universo`           o dump da Receita, cru
--   4. "Sem cadastro"               a verdade, quando não há nome em lugar nenhum
--
-- Curado vence bruto: se alguém corrigiu o nome na ficha, foi porque o da Receita
-- estava errado ou inútil. E o payload vence os dois porque é o vocabulário de quem
-- está do outro lado da conversa.
do $$
declare
  v_def text;
  v_ancora text;
  v_novo text;
begin
  select pg_get_viewdef('public.funil_oportunidades_preauth'::regclass, true) into v_def;
  v_ancora := 'COALESCE(pa.fornecedor_nome, fu.razao_social, fu.nome_fantasia, ''Sem cadastro''::text)';
  v_novo   := 'COALESCE(pa.fornecedor_nome, fe.razao_social, fu.razao_social, fu.nome_fantasia, ''Sem cadastro''::text)';

  if (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora) <> 1 then
    raise exception 'Âncora do nome não aparece exatamente uma vez em funil_oportunidades_preauth.';
  end if;
  execute 'create or replace view public.funil_oportunidades_preauth as '
          || replace(v_def, v_ancora, v_novo);

  select pg_get_viewdef('public.funil_oportunidades_titulo'::regclass, true) into v_def;
  v_ancora := 'COALESCE(st.credor_nome, cu.razao_social, cu.nome_fantasia,';
  v_novo   := 'COALESCE(st.credor_nome, ce.razao_social, cu.razao_social, cu.nome_fantasia,';

  if (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora) <> 1 then
    raise exception 'Âncora do nome não aparece exatamente uma vez em funil_oportunidades_titulo.';
  end if;
  execute 'create or replace view public.funil_oportunidades_titulo as '
          || replace(v_def, v_ancora, v_novo);
end $$;

-- `create or replace view` PERDE `security_invoker`. Sem ela a view ignora a RLS
-- das tabelas de base. Toda migração que recria uma view do funil reafirma isto.
alter view public.funil_oportunidades_preauth set (security_invoker = true);
alter view public.funil_oportunidades_titulo set (security_invoker = true);
