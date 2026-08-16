-- =============================================================================
-- 0119 — Um motivo de perda em que quem desiste somos nós
--
-- Os sete motivos semeados na 0116 descrevem todos o mesmo tipo de fato: por que o
-- CLIENTE não emitiu — não quer, acha caro, a contabilidade trava, sumiu. Faltava o
-- caso em que a decisão é NOSSA: aquele grupo de SPEs de obra encerrada, ou o cliente
-- pequeno demais para valer a ligação.
--
-- Sem esta linha, esses cards eram fechados com "Obra encerrada" ou "Cliente não quer
-- emitir" — motivos que descrevem o cliente e são falsos aqui. E a distribuição de
-- motivos existe justamente para responder "por que não conseguimos?": misturar "não
-- conseguimos" com "não tentamos" é a resposta errada com cara de resposta.
--
-- Vai por último (`ordem` 90) de propósito: é o motivo que não deve ser o primeiro que
-- a pessoa vê ao abrir o dropdown.
-- =============================================================================

insert into public.motivos_perda (contexto, motivo, ordem)
values ('certificado', 'Não temos interesse em obter o certificado', 90)
on conflict (contexto, motivo) do update set ativo = true;
