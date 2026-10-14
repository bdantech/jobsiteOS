-- 0300 — A decisão de crédito chega ao closer também por e-mail
--
-- Aprovada ou negada, o closer fica sabendo por sino, push E e-mail. Push só chega a
-- quem registrou aparelho (em 12/10/2026, três pessoas), então sem e-mail a decisão
-- dependia de alguém abrir o sistema.
--
-- São dois caminhos até o closer, e os dois ganham e-mail:
--   venda.credito_decidido → o dono da venda, quando não foi ele quem pediu a análise;
--   analise.*              → quem pediu, que no funil de vendas é o próprio closer.
-- O worker pula o primeiro quando o dono da venda é quem pediu, para a mesma decisão não
-- chegar duas vezes; por isso o e-mail precisa estar nos dois.
--
-- As regras do perfil Crédito (só sino) não mudam.

update public.notificacao_regras
   set canais = array(select distinct unnest(canais || array['email']) order by 1),
       atualizado_em = now()
 where (tipo_evento = 'venda.credito_decidido' and papel = 'vendedor_da_venda')
    or (tipo_evento in ('analise.aprovada', 'analise.aprovada_parcial', 'analise.negada')
        and papel = 'quem_pediu');
