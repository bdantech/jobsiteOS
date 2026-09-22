-- 0239 — As funções novas não ficam abertas ao anon
--
-- `create function` nasce com EXECUTE para PUBLIC, e PUBLIC inclui `anon` — o
-- papel de quem NÃO está logado. As duas funções do 04s entraram assim.
--
-- Na prática `app_mover_oportunidade` já se defende: a primeira coisa que ela faz
-- é `app_tem_modulo('antecipacao')`, que lê `auth.uid()` e devolve falso para um
-- anônimo. Mas "se defende" e "não é alcançável" são coisas diferentes: a primeira
-- depende de a guarda continuar lá amanhã, a segunda não depende de nada. Uma
-- função SECURITY DEFINER publicada em `/rest/v1/rpc/` é superfície de ataque, e a
-- superfície some quando o grant some.
--
-- A régua é a de `app_marcar_sem_interesse`, que é a mais fechada da casa:
-- `authenticated` e `service_role`, mais ninguém.
revoke execute on function public.app_mover_oportunidade(jsonb) from public, anon;
grant execute on function public.app_mover_oportunidade(jsonb) to authenticated, service_role;

-- `app__matriz_do_cnpj` é SECURITY INVOKER e só lê `mercado_universo` com os
-- privilégios de quem chama — a RLS continua valendo. Mesmo assim ela sai de
-- PUBLIC: uma função de resolução de CNPJ aberta a quem não está logado é um
-- oráculo de CNPJ, ainda que devolva só o que a RLS permitir.
revoke execute on function public.app__matriz_do_cnpj(text) from public, anon;
grant execute on function public.app__matriz_do_cnpj(text) to authenticated, service_role;
