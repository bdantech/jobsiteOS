-- 0247 — O motivo recuperável de verdade
--
-- O Prompt citava `SUPPLIER_CNPJ_MISSING` como exemplo de `guardReason` que um
-- originador resolve. O primeiro sync de títulos (22/09/2026) mostrou o vocabulário
-- real, e o exemplo era o caso quase inexistente:
--
--     BILL_NOT_CONSISTENT ........ 36 parcelas   R$ 493.356   ← dado da construtora
--     SUPPLIER_CONTACT_MISSING ... 26 parcelas   R$ 277.039   ← TRABALHO DE ORIGINADOR
--     DUE_DATE_TOO_SOON .......... 10 parcelas   R$ 129.375   ← o calendário
--     BASE_BELOW_MIN ............. 14 parcelas   R$   4.082   ← tamanho da parcela
--     SUPPLIER_CNPJ_MISSING ......  1 parcela    R$   5.600   ← credor PESSOA FÍSICA
--
-- `SUPPLIER_CNPJ_MISSING` aparece uma vez, e é justamente um credor pessoa física —
-- que não tem CNPJ para cadastrar. Não tem conserto.
--
-- `SUPPLIER_CONTACT_MISSING` é o que existe de verdade: 21 credores distintos,
-- todos COM CNPJ, faltando o contato. É literalmente o que a aba Fornecedor do card
-- existe para resolver, e são R$ 277 mil que estavam sendo filtrados para fora do
-- funil por uma lista que eu escrevi a partir de um exemplo em vez de dos dados.
--
-- Os outros continuam fora, e cada um por um motivo diferente: título inconsistente
-- é dado da construtora, vencimento é o calendário, e valor abaixo do mínimo é a
-- parcela ser pequena demais (a média dessas quatorze é R$ 291).
update public.antecipacao_config
   set valor = jsonb_set(valor, '{guard_reasons_recuperaveis}',
         '["SUPPLIER_CNPJ_MISSING","SUPPLIER_NOT_REGISTERED","SUPPLIER_CONTACT_MISSING"]'::jsonb),
       atualizado_em = now()
 where chave = 'funil_oportunidades';
