-- ═════════════════════════════════════════════════════════════════════════════
-- 0209 — Faturamento anual só sai de exercício FECHADO
--
-- ─── O CASO ─────────────────────────────────────────────────────────────────
-- A CAVAZANI EMPREENDIMENTOS (09473239000153) entregou na esteira um DRE de 2026 —
-- em setembro de 2026. A extração leu três exercícios:
--
--   2024   R$ 140.978.056   fechado
--   2025   R$ 127.374.399   fechado
--   2026   R$  87.961.659   o ano NÃO terminou
--
-- `app_credito_realimentar_faturamento` pega "o exercício mais recente com receita".
-- O mais recente era 2026, e a receita de oito meses virou:
--
--   empresas.faturamento_anual   = 87.961.659
--   faturamento_origem           = 'analise_credito'   (o TOPO da hierarquia)
--   faturamento_confianca        = 'alta'
--
-- A ficha passou a afirmar, com confiança alta e um documento atrás, que a empresa
-- encolheu 31%. Três estragos em cascata:
--
--   1. O limite potencial saiu desse número (R$ 2.323.630).
--   2. `crescimento12m` leu uma queda que não houve.
--   3. A CALIBRAÇÃO do estimador. `analise_credito` entra direto na amostra — são 170
--      amostras hoje, 3 de balanço — e é ela que define a régua de 5.109 empresas. Um
--      documento parcial desregula todas.
--
-- ─── A CAUSA ────────────────────────────────────────────────────────────────
-- `ESQUEMA_EXTRACAO` só pedia `exercicio: integer`. O modelo nunca foi perguntado
-- quantos MESES o documento cobre, então um DRE de jan–ago/2026 e um exercício
-- fechado de 2026 chegavam aqui idênticos. A informação está no cabeçalho de toda
-- demonstração; a gente é que não pedia.
--
-- ─── A REGRA, EM DOIS DEGRAUS ───────────────────────────────────────────────
-- Espelha `exercicioFechado` do core (packages/core/src/credito/analise.ts), que é
-- quem o cálculo e a tela usam — duas réguas para a mesma pergunta divergiriam no
-- primeiro ajuste.
--
--   COM período extraído:  fechado ⇔ exatamente 12 meses. 11 ou 13 não é um ano
--                          contábil, é um documento que não entendemos, e na dúvida
--                          ele não sobe para a régua.
--   SEM período (tudo que foi extraído antes desta migração): nenhum ano fecha antes
--                          de terminar. Exercício >= ano corrente é parcial, ponto.
--
-- O segundo degrau sozinho já teria pego a CAVAZANI. O que ele não pega é um DRE de
-- jan–jun/2025 lido em 2026 — e é por isso que o período virou pergunta de extração.
--
-- ─── POR QUE NÃO ANUALIZAR ──────────────────────────────────────────────────
-- Tentador: 87,9 ÷ 8 × 12 ≈ R$ 132 mi, que bate com os R$ 127 mi de 2025. Mas receita
-- de construtora vem por medição de obra — o mês não é uniforme, e o erro do ×12/8 é
-- grande justamente neste setor. E o que põe `analise_credito` acima do declarado é
-- ser "o número com o documento atrás": anualizado, ele deixa de ser isso e vira uma
-- estimativa com selo de balanço auditado, que é o pior dos dois mundos.
--
-- O parcial não é jogado fora — ele continua na análise, que é onde o analista precisa
-- do sinal mais fresco. Ele só não sobe para a ficha nem para a calibração.
--
-- ─── E A DATA ───────────────────────────────────────────────────────────────
-- `capturado_em` era sempre 31/12 do ano do exercício. Para a CAVAZANI isso gravou um
-- ponto da série em 31/12/2026 — uma data no FUTURO, que quebra `crescimento12m` e
-- qualquer janela temporal. Passa a ser o fim do período coberto.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.app_credito_realimentar_faturamento(p_analise_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_a public.analises_proprietarias;
  v_valor numeric;
  v_campo text;
  v_ano int;
  v_fim date;
  v_meses int;
  v_parciais int;
  v_cnpj text;
  v_empresa uuid;
  v_rank_atual int;
begin
  select * into v_a from public.analises_proprietarias where id = p_analise_id;
  if v_a.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'analise_inexistente');
  end if;

  /*
   * Só extração REVISADA por gente. O modelo lendo um PDF acerta quase sempre e erra o
   * suficiente — e este número passa a valer mais que a declaração do próprio cliente.
   * Promover um número não conferido a "a melhor verdade que existe" é a forma mais
   * discreta de estragar a régua de 5.109 empresas.
   */
  if v_a.extracao_revisada_em is null then
    return jsonb_build_object('ok', false, 'motivo', 'extracao_nao_revisada');
  end if;

  /*
   * O exercício FECHADO mais recente com receita. Bruta primeiro: é o "faturamento" que
   * o mercado usa e o que o cliente informa quando declara — comparar líquida com
   * declarada seria comparar duas coisas diferentes na mesma série.
   */
  with ex as (
    select
      (e ->> 'exercicio')::int as ano,
      nullif(e ->> 'periodo_inicio', '')::date as ini,
      nullif(e ->> 'periodo_fim', '')::date as fim,
      coalesce((e -> 'campos' -> 'receita_bruta' ->> 'valor')::numeric,
               (e -> 'campos' -> 'receita_liquida' ->> 'valor')::numeric) as valor,
      case when (e -> 'campos' -> 'receita_bruta' ->> 'valor') is not null
           then 'receita_bruta' else 'receita_liquida' end as campo
    from jsonb_array_elements(coalesce(v_a.dados_extraidos -> 'exercicios', '[]'::jsonb)) e
  ),
  medido as (
    select ex.*,
           case when ini is not null and fim is not null
                then (extract(year from fim)::int * 12 + extract(month from fim)::int)
                   - (extract(year from ini)::int * 12 + extract(month from ini)::int) + 1
           end as meses
      from ex
     where valor > 0
  )
  select valor, campo, ano, fim, meses
    into v_valor, v_campo, v_ano, v_fim, v_meses
    from medido
   where case when meses is not null then meses = 12
              else ano < extract(year from now())::int end
   order by ano desc nulls last
   limit 1;

  if v_valor is null then
    -- Distingue "não tem receita no documento" de "tem, mas o período é parcial": são
    -- duas conversas diferentes com quem enviou a pasta.
    select count(*) into v_parciais
      from jsonb_array_elements(coalesce(v_a.dados_extraidos -> 'exercicios', '[]'::jsonb)) e
     where coalesce((e -> 'campos' -> 'receita_bruta' ->> 'valor')::numeric,
                    (e -> 'campos' -> 'receita_liquida' ->> 'valor')::numeric) > 0;

    return jsonb_build_object(
      'ok', false,
      'motivo', case when v_parciais > 0 then 'sem_exercicio_fechado' else 'sem_receita_no_balanco' end,
      'exercicios_com_receita', v_parciais
    );
  end if;

  v_cnpj := v_a.cnpj;
  v_empresa := v_a.empresa_id;
  if v_cnpj is null and v_empresa is not null then
    select cnpj into v_cnpj from public.empresas where id = v_empresa;
  end if;
  if v_cnpj is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_cnpj');
  end if;

  /*
   * A série guarda um ponto por EXERCÍCIO, não por revisão: `capturado_em` é o fim do
   * PERÍODO coberto, como já faz `publicacao`. Carimbar `now()` faria um balanço de 2023
   * revisado hoje parecer o retrato de hoje, e a variação de 12 meses leria a data errada.
   *
   * O fim do período e não 31/12 do ano: era isso que gravava data no futuro quando o
   * exercício era o ano corrente.
   */
  delete from public.empresa_metricas
   where cnpj = v_cnpj and metrica = 'faturamento_anual' and origem = 'analise_credito'
     and extract(year from capturado_em) = coalesce(v_ano, extract(year from now())::int);

  insert into public.empresa_metricas (empresa_id, cnpj, metrica, valor, origem, confianca, detalhes, capturado_em)
  values (v_empresa, v_cnpj, 'faturamento_anual', v_valor, 'analise_credito', 'alta',
          jsonb_build_object('analise_id', v_a.id, 'exercicio', v_ano, 'campo', v_campo,
                             'periodo_fim', v_fim, 'meses', v_meses),
          coalesce(v_fim::timestamptz, make_timestamptz(v_ano, 12, 31, 0, 0, 0), now()));

  -- O cache da ficha só cede para origem melhor ou igual (mesma hierarquia do core).
  if v_empresa is not null then
    select case coalesce(faturamento_origem, 'zzz')
             when 'analise_credito' then 0 when 'declarado_cliente' then 1
             when 'publicacao' then 2 when 'apollo' then 3 when 'apollo_search' then 4
             when 'lista' then 5 when 'modelo' then 6 when 'bracket_simples' then 7
             else 99 end
      into v_rank_atual
    from public.empresas where id = v_empresa;

    if coalesce(v_rank_atual, 99) >= 0 then
      update public.empresas set
        faturamento_anual = v_valor,
        faturamento_origem = 'analise_credito',
        faturamento_confianca = 'alta',
        faturamento_atualizado_em = now()
      where id = v_empresa;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'valor', v_valor, 'exercicio', v_ano,
                            'campo', v_campo, 'meses', v_meses);
end $function$;

comment on function public.app_credito_realimentar_faturamento is
  'Promove a receita do balanço a `empresas.faturamento_anual`. Só exercício FECHADO: '
  '12 meses quando o período foi extraído, e ano anterior ao corrente quando não foi. '
  'Espelha `exercicioFechado` do core.';

-- ─── O estrago de hoje ──────────────────────────────────────────────────────
--
-- A CAVAZANI volta ao último exercício fechado: 2025, R$ 127.374.399,34 (receita
-- bruta). O ponto de 31/12/2026 sai da série — ele nunca deveria ter existido, e uma
-- data no futuro não é um retrato de nada.
--
-- As outras duas realimentações (CAPRETZ 2025 e ANTONINI 2025) já eram de exercício
-- fechado e não são tocadas.

delete from public.empresa_metricas
 where cnpj = '09473239000153'
   and metrica = 'faturamento_anual'
   and origem = 'analise_credito'
   and capturado_em > now();

insert into public.empresa_metricas (empresa_id, cnpj, metrica, valor, origem, confianca, detalhes, capturado_em)
select e.id, '09473239000153', 'faturamento_anual', 127374399.34, 'analise_credito', 'alta',
       jsonb_build_object('exercicio', 2025, 'campo', 'receita_bruta', 'meses', 12,
                          'nota', 'Reposto pela 0209: a realimentação tinha promovido o DRE parcial de 2026.'),
       make_timestamptz(2025, 12, 31, 0, 0, 0)
  from public.empresas e
 where e.cnpj = '09473239000153'
   and not exists (
     select 1 from public.empresa_metricas m
      where m.cnpj = '09473239000153' and m.metrica = 'faturamento_anual'
        and m.origem = 'analise_credito' and extract(year from m.capturado_em) = 2025
   );

update public.empresas set
  faturamento_anual = 127374399.34,
  faturamento_origem = 'analise_credito',
  faturamento_confianca = 'alta',
  faturamento_atualizado_em = now()
where cnpj = '09473239000153'
  and faturamento_anual = 87961659.00;
