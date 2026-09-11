-- O VOP para de subir aos 180 dias.
--
-- A unidade da comissão é `valor × dias / 30`, e a ponderação por prazo existe para pagar
-- mais por imobilizar mais. Ela é LINEAR, e a linearidade descreve bem o negócio até certo
-- ponto: uma operação de 300 dias não vale dez vezes uma de 30 para quem vende, mas era
-- isso que a fórmula dizia. Acima do teto o VOP passa a não subir mais.
--
-- ── POR QUE PARÂMETRO, E NÃO UM 180 NO CÓDIGO ──────────────────────────────────────
-- É uma régua comercial, igual ao denominador do VOP e às taxas por milhão — e todas elas
-- vivem em `commission_params`, com vigência. Um número no TypeScript não tem vigência:
-- mudá-lo reprecificaria retroativamente tudo que já foi calculado, que é exatamente o que
-- a tabela de parâmetros existe para impedir. Ausente = sem teto, e é por isso que o
-- motor aceita null em vez de assumir um padrão.
--
-- ── A VIGÊNCIA COMEÇA EM 01/09 ─────────────────────────────────────────────────────
-- Não é hoje: a competência de setembro está aberta e provisionada, e a decisão é que ela
-- inteira vale pela régua nova. Começar hoje deixaria o mesmo mês com duas réguas — duas
-- cessões idênticas, uma do dia 3 e outra do dia 12, pagando diferente sem que nada no
-- extrato explicasse a diferença.

insert into public.commission_params (chave, vendedor_id, valor, unidade, vigente_de, vigente_ate)
values ('prazo_maximo_vop', null, 180, 'DAYS', date '2026-09-01', null)
on conflict do nothing;

-- ── O RECÁLCULO DE SETEMBRO ────────────────────────────────────────────────────────
--
-- UPDATE, e não linha de estorno. A regra da casa é "sempre para frente": reclassificar
-- uma conta não reprecifica o que ela já converteu, e competência fechada é imutável. Aqui
-- nada disso se aplica — setembro está ABERTO, todas as 152 linhas estão `provisionado`,
-- e provisionado é precisamente o estado em que o número ainda não foi prometido a
-- ninguém. Um par estorno + relançamento produziria três linhas para contar uma cessão e
-- sujaria o extrato para descrever uma correção que ninguém chegou a ver errada.
--
-- As 35 linhas afetadas são todas de VENDEDOR (o originador não tem nenhuma acima de 180)
-- e nenhuma delas é repasse de auxiliar — se houvesse, recalcular o closer sem recalcular
-- o repasse deixaria os dois discordando, e a ordem passaria a importar.
--
-- A conta espelha o motor passo a passo, inclusive nos arredondamentos: `vop` fecha em
-- centavos antes de virar milhões, e o valor arredonda UMA vez no fim, como
-- `comissaoDoVop`. Arredondar duas vezes produziria centavos de diferença entre o que a
-- folha mostra e o que o motor lançaria se rodasse de novo — e é essa divergência que
-- transforma uma conferência de rotina numa investigação.
with alvo as (
  select
    l.id,
    round(l.valor_cedido * (180::numeric /
      coalesce((l.params_snapshot ->> 'dias_referencia_vop')::numeric, 30)), 2) as vop_novo
  from public.comissao_lancamentos_v2 l
  where l.competencia = date '2026-09-01'
    and l.origem_tipo = 'nf_convertida'
    and l.status = 'provisionado'
    and l.anticipation_days > 180
)
update public.comissao_lancamentos_v2 l
   set vop = a.vop_novo,
       valor = round((a.vop_novo / 1000000) * l.taxa_brl_por_mm * (l.share_pct / 100), 2),
       -- O snapshot passa a dizer que havia teto. Sem isto `explicarCalculo` escreveria a
       -- conta com o prazo cheio e ela não fecharia com o VOP ao lado — uma conta que não
       -- fecha parece um erro, e manda a pessoa abrir um chamado em vez de ler.
       params_snapshot = l.params_snapshot || jsonb_build_object('prazo_maximo_vop', 180)
  from alvo a
 where l.id = a.id;

-- O restante de setembro também ganha o registro do teto no snapshot: ele vigia a
-- competência inteira, e uma linha sem o campo ficaria indistinguível de uma anterior à
-- regra na hora de auditar por que duas cessões parecidas pagaram valores diferentes.
update public.comissao_lancamentos_v2
   set params_snapshot = params_snapshot || jsonb_build_object('prazo_maximo_vop', 180)
 where competencia = date '2026-09-01'
   and origem_tipo = 'nf_convertida'
   and not params_snapshot ? 'prazo_maximo_vop';
