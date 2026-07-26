-- 0037 — Correção pontual das colunas derivadas de protesto.
-- O parser antigo do worker (radar/directd.ts) gravava valor_total/qtd_protestos = 0
-- para o endpoint SP: o valor vinha como string BR ("293.265,96"), que Number() lê
-- como NaN. O parser foi corrigido (parseNumero + soma de cartórios); aqui recomputamos
-- as colunas das linhas JÁ gravadas a partir do payload bruto preservado.
-- Não é reescrita de histórico — é conserto da derivada, com o payload como fonte da verdade.
update public.protestos_consultas
set
  qtd_protestos = nullif(regexp_replace(coalesce(payload#>>'{retorno,totalNumProtestos}', ''), '\D', '', 'g'), '')::int,
  valor_total = replace(replace(payload#>>'{retorno,valorTotalProtestos}', '.', ''), ',', '.')::numeric
where payload#>>'{retorno,valorTotalProtestos}' is not null
  and coalesce(valor_total, 0) = 0
  and (payload#>>'{retorno,constamProtestos}')::boolean is true;
