-- 0224 — Nota de R$ 500 ou menos não se opera.
--
-- Não é regra de risco nem de crédito — é aritmética. O custo fixo de uma operação
-- é a TAC mais o seguro de R$ 125, e numa nota pequena ele passa do valor da nota:
-- uma NF de R$ 48 com R$ 150 de TAC devolve líquido NEGATIVO. Depois da 0223, que
-- fez o líquido descontar as três parcelas, 19,6% das notas vivas do funil (15.098)
-- tinham líquido zero ou negativo — cada uma delas um card que alguém podia abrir,
-- ligar para o fornecedor e descobrir na conversa que não havia o que oferecer.
--
-- ─── POR QUE O CORTE É PELO VALOR, E NÃO PELO LÍQUIDO ───────────────────────
-- Cortar por "líquido ≤ 0" seria a regra mais justa e é a errada. O líquido depende
-- da TAC do sacado e da taxa do dia, então a MESMA nota entraria e sairia do funil
-- conforme a precificação mudasse — e o fornecedor ouviria uma resposta diferente
-- a cada ligação. "Abaixo de quinhentos reais não operamos" é uma frase que o
-- vendedor repete ao telefone; "depende da tarifa vigente do seu sacado" não é.
--
-- Os dois critérios não coincidem, nas duas direções: uma NF de R$ 480 com TAC
-- barata ainda dá líquido positivo e mesmo assim não opera; uma de R$ 600 com TAC
-- de R$ 500 dá líquido zero e segue no funil, porque quem decide caso a caso é a
-- mesa, não o corte automático.
--
-- ─── O PISO NÃO ATROPELA A MÃO ──────────────────────────────────────────────
-- A view lê `coalesce(operavel_manual, operavel)`, e esta migração mexe só em
-- `operavel`. Se amanhã alguém recuperar uma nota pequena à mão, ela volta — o piso
-- é o padrão, não uma tranca. Hoje isso é teórico: nenhuma das 22.456 notas de até
-- R$ 500 tem `operavel_manual`, e nenhuma delas foi convertida.

update public.antecipacao_config
   set valor = valor || jsonb_build_object('valor_minimo_operavel', 500)
 where chave = 'economia';

-- A natureza vem PRIMEIRO no motivo: uma remessa não gera crédito em valor nenhum,
-- e dizer "abaixo de R$ 500" sobre ela explicaria a coisa errada. Por isso o motivo
-- novo só entra onde ainda não há motivo — mas `operavel` cai nos dois casos.
update public.notas_fiscais nf
   set operavel = false,
       nao_operavel_motivo = coalesce(
         nf.nao_operavel_motivo,
         'Abaixo de R$ 500,00 — o custo fixo da operação não cabe na nota.')
 where nf.valor is not null
   and nf.valor <= (
     select coalesce((c.valor ->> 'valor_minimo_operavel')::numeric, 500)
     from public.antecipacao_config c where c.chave = 'economia')
   and nf.operavel is distinct from false;

comment on column public.notas_fiscais.operavel is
  'A nota gera crédito a receber E vale a pena operar. Cai por natureza da operação '
  '(remessa, devolução, bonificação — 0104) ou por valor abaixo do piso de R$ 500 '
  '(0224). `operavel_manual` continua por cima: o piso é padrão, não tranca.';
