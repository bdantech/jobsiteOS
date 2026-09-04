-- 0179 — As cessões sem nota que ficaram para trás.
--
-- A 0178 corrigiu o CÓDIGO: a conversão passou a ser decidida pelo status da antecipação,
-- e não pelo casamento com a NF. Sobrou o passado — 780 antecipações com status conversor
-- e `convertida_em` nulo, R$ 28,7 milhões, porque no dia em que passaram pelo sync a
-- regra antiga exigia uma nota que nunca chegou.
--
-- Esta migração precisa rodar ANTES do próximo sync, e a urgência é o ponto: com o código
-- novo no ar, o sync veria as 780 como conversões de HOJE e carimbaria `now()` em todas.
-- As 511 de agosto e as 114 de julho cairiam na competência de setembro — três meses de
-- operação numa folha só, pagos a quem é titular hoje por trabalho de julho.
--
-- ── A data ──
--
-- `completion_date` quando existe (só `CONCLUDED` o traz), senão `created_at_plataforma`.
-- Não é a data da troca do boleto, que a plataforma não publica; é a data da OPERAÇÃO na
-- plataforma, e o desvio medido contra as 217 que converteram pelo caminho normal é de
-- 1,86 dia em média.
--
-- Não é `now()` por dois motivos, e o segundo é o que decide: a data de hoje faria a
-- comissão de julho ser paga pelo titular de setembro, e faria a competência de uma cessão
-- depender de quando o nosso cron rodou em vez de quando a operação aconteceu.
--
-- ── O que isso paga ──
--
-- Nada de julho e nada de agosto: julho é anterior ao primeiro parâmetro publicado
-- (25/08) e agosto está com a competência fechada — o trigger da 0175 recusa, e o piso do
-- backfill nem as oferece. Só setembro entra, que é a competência aberta.

update public.antecipacoes a
   set convertida_em = least(coalesce(a.completion_date, a.created_at_plataforma), now()),
       atualizada_em = now()
 where a.convertida_em is null
   and a.regrediu_em is null
   and a.invoice_cancelled_at is null
   and a.status = any (
     select jsonb_array_elements_text(c.valor -> 'status_conversores')
     from public.antecipacao_config c where c.chave = 'conversao'
   )
   and coalesce(a.completion_date, a.created_at_plataforma) is not null;

-- ─── O marco de ativação passa a conhecer a operação inteira ────────────────
--
-- `marco_ativacao` é o zero do relógio de fase, e a regra é que ele nunca RECUA depois de
-- gravado — mover o zero move todas as taxas da conta pelos anos seguintes. A exceção é
-- esta, e ela é única: o marco que existe hoje foi calculado sobre um universo em que
-- 77% das cessões não existiam. Ele não está sendo movido, está sendo calculado pela
-- primeira vez com a base completa.
--
-- Só recua, nunca avança (`<`). E hoje não muda taxa nenhuma: todas as contas têm menos
-- de seis meses, então todas seguem em CRESCIMENTO com marco de julho ou de agosto. A
-- diferença aparece daqui a meio ano, que é exatamente quando ninguém lembraria de
-- conferir.

with real as (
  select public.app_holding_do_sacado(a.sacado_cnpj) as empresa_id,
         min((a.convertida_em at time zone 'America/Sao_Paulo')::date) as primeira
  from public.antecipacoes a
  where a.convertida_em is not null and a.regrediu_em is null
  group by 1
)
update public.empresas e
   set marco_ativacao = r.primeira
  from real r
 where e.id = r.empresa_id
   and r.primeira is not null
   and (e.marco_ativacao is null or r.primeira < e.marco_ativacao);
