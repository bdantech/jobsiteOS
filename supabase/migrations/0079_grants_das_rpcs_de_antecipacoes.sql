-- Mesma higiene das 0047 e 0073: revogar de `public` e conceder a
-- `authenticated`/`service_role`. Os gates de módulo continuam DENTRO de cada
-- função — isto só tira a execução de quem nunca deveria nem tentar.

revoke execute on function public.app_casar_antecipacao(jsonb) from public;
revoke execute on function public.antecipacao_candidatas(jsonb) from public;
revoke execute on function public.antecipacao_status_conversoes(jsonb) from public;
revoke execute on function public.antecipacao_calibracao_carteira(jsonb) from public;

grant execute on function public.app_casar_antecipacao(jsonb) to authenticated, service_role;
grant execute on function public.antecipacao_candidatas(jsonb) to authenticated, service_role;
grant execute on function public.antecipacao_status_conversoes(jsonb) to authenticated, service_role;
grant execute on function public.antecipacao_calibracao_carteira(jsonb) to authenticated, service_role;
