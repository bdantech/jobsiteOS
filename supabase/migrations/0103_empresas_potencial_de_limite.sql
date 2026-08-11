-- =============================================================================
-- 0103 — Potencial de aumento de limite: a conta da 0073 apontada para dentro.
--
-- A cadeia da 0073 corre no sentido da PROSPECÇÃO — faturamento estimado → limite
-- potencial → receita prevista → quanto vale um prospect. Virada para a CARTEIRA
-- EXISTENTE, a mesma conta responde outra pergunta: em quem concedemos pouco para
-- o tamanho que ele tem?
--
-- A RÉGUA É O NOSSO PRÓPRIO COMPORTAMENTO, e é isso que dá autoridade ao número.
-- `ratio_limite` (credito_versoes) é a MEDIANA de credit_limit ÷ faturamento
-- declarado, medida na carteira real: 1,83% hoje, sobre 27 clientes declarantes.
-- Um cliente muito abaixo dela não fere política nenhuma — está sendo tratado
-- diferente dos comparáveis dele, que é uma pergunta respondível.
--
-- O QUE A BASE MOSTRA: 14 clientes com espaço, R$ 25,5 mi somados, 4 deles em 100%
-- de consumo — esses pararam de operar por causa do NOSSO teto, não por falta de
-- demanda. O extremo é a CONSTRUTORA ATERPA: R$ 816 mi de faturamento, R$ 150 mil
-- de limite (0,02%, ~100× abaixo da mediana) e score 71 na faixa alta.
--
-- O RECORTE, e por que ele exclui: só entra quem tem limite E faturamento
-- conhecidos. Sem os dois não há comparação a fazer, e um "espaço" calculado sobre
-- faturamento nulo seria ruído com cara de oportunidade — o pior tipo, porque
-- ninguém questiona uma lista que parece plausível.
--
-- RLS: nenhuma policy nova. `clientes_onepay` já exige `radar` e `empresas` exige
-- `empresas`; a view é security_invoker e herda as duas. A tela que a consome
-- (Empresas → Análise) já é fechada por radar. `credito_versoes`, de onde sai a
-- régua, libera para `credito` OU `radar` desde a 0073 — a mediana chega junto.
-- =============================================================================

create view public.empresas_potencial_limite
with (security_invoker = true) as
  select
    co.cnpj,
    co.empresa_id,
    coalesce(e.razao_social, co.nome) as nome,
    e.tipo,

    e.faturamento_anual,
    e.faturamento_confianca,

    co.credit_limit as limite_concedido,
    co.available_limit as limite_disponivel,
    -- 100% aqui é o sinal mais nítido da tela: o cliente esgotou o limite, ou seja,
    -- a restrição é nossa e não da demanda dele.
    co.consumed_pct,
    co.days_without_anticipation,
    co.gross_value_last_2m,

    e.limite_potencial,
    -- HERDADA do faturamento (0073). Uma multiplicação não cria informação: se o
    -- faturamento é estimativa, o potencial é a mesma estimativa com outra unidade,
    -- e a tela precisa dizer isso ao lado do número.
    e.limite_confianca,
    (e.limite_potencial - co.credit_limit) as espaco,

    e.score_credito,
    e.score_faixa,
    e.score_completude,

    -- Quanto do faturamento nós de fato concedemos a ESTE cliente. É o número que
    -- se compara com a mediana da carteira — a régua sai do nosso comportamento,
    -- não de uma política escrita.
    case when e.faturamento_anual > 0 then co.credit_limit / e.faturamento_anual end
      as ratio_concedido
  from public.clientes_onepay co
    join public.empresas e on e.id = co.empresa_id
  where co.credit_limit > 0
    and e.faturamento_anual > 0;

grant select on public.empresas_potencial_limite to authenticated;

comment on view public.empresas_potencial_limite is
  'Limite concedido contra o que o nosso próprio comportamento de concessão sugere. '
  'Alimenta o visual de potencial de aumento em Empresas > Análise. Só clientes com '
  'limite e faturamento conhecidos — sem os dois não há comparação a fazer, e um '
  '"espaço" calculado sobre faturamento nulo seria ruído com cara de oportunidade.';

comment on column public.empresas_potencial_limite.ratio_concedido is
  'limite_concedido / faturamento_anual. Compara-se com '
  'credito_versoes.coeficientes->ratio_limite->global, a MEDIANA da carteira '
  '(1,83% hoje, sobre 27 declarantes).';

comment on column public.empresas_potencial_limite.espaco is
  'limite_potencial - limite_concedido. SUBESTIMA no topo: limite_potencial é '
  'limitado pelo cap de credito_config (15% do faturamento e R$ 5 mi absolutos), '
  'então quem já bate no teto aparece com espaço menor que o real. A tela avisa.';

comment on column public.empresas_potencial_limite.consumed_pct is
  '100% é o sinal mais forte da tela: o cliente esgotou o limite, então quem está '
  'segurando a operação é o nosso teto, não a demanda dele.';
