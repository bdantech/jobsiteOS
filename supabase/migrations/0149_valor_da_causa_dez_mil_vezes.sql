-- ═════════════════════════════════════════════════════════════════════════════
-- 0149 — O valor da causa estava 10.000× maior
--
-- A primeira descoberta de processos (31/08/2026) trouxe 14 processos com
-- valores absurdos: R$ 7.223.328.400 numa execução de título extrajudicial de
-- uma securitizadora. O valor real é R$ 722.332,84.
--
-- O Escavador manda o valor da causa como `"722332.8400"` — ponto decimal,
-- QUATRO casas. O parser tinha a regra `\.(?=\d{3})` ("ponto seguido de três
-- dígitos é separador de milhar"), via `.840` e apagava o ponto. Não é um erro
-- de arredondamento: é um deslocamento de quatro casas, e o campo aparece na
-- tela e vai para o parecer da IA.
--
-- A regra nova pergunta a coisa certa: a string INTEIRA parece grupos de milhar
-- (`1.250.000`), ou é um decimal com ponto? Só o primeiro caso apaga pontos.
-- Testado no core contra o payload real (`escavador.test.ts`).
--
-- Aqui o passado é recomposto a partir de `processos.raw`, que guarda a resposta
-- inteira — sem reconsultar nada e sem gastar crédito.
-- ═════════════════════════════════════════════════════════════════════════════

/*
 * O gêmeo em SQL do `numeroOuNulo` corrigido, e a MESMA fonte que o código usa:
 * a de MENOR grau (§3.2). O primeiro grau é onde o processo corre; a capa do
 * recurso às vezes traz outro valor, e ler a fonte errada aqui produziria um
 * backfill que discorda do próximo sync.
 */
update public.processos p
   set valor_causa = calc.correto
  from (
    select p2.numero_cnj,
           case
             when b.bruto is null then null
             when b.bruto like '%,%' then replace(replace(b.bruto, '.', ''), ',', '.')::numeric
             when b.bruto ~ '^-?\d{1,3}(\.\d{3})+$' then replace(b.bruto, '.', '')::numeric
             else b.bruto::numeric
           end as correto
      from public.processos p2
      cross join lateral (
        select f -> 'capa' -> 'valor_causa' ->> 'valor' as bruto
          from jsonb_array_elements(p2.raw -> 'fontes') f
         where f -> 'capa' -> 'valor_causa' ->> 'valor' is not null
         order by coalesce((f ->> 'grau')::int, 99)
         limit 1
      ) b
  ) calc
 where calc.numero_cnj = p.numero_cnj
   and calc.correto is not null
   and p.valor_causa is distinct from calc.correto;

comment on column public.processos.valor_causa is
  'Valor da causa em reais. O Escavador manda a string com ponto decimal e quatro casas '
  '("722332.8400"); até a 0149 o parser a lia como separador de milhar e gravava 10.000× '
  'a mais.';
