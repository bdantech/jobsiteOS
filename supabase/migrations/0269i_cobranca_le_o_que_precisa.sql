-- ============================================================================
-- 0269i — Cobrança: o que ela precisa ler dos outros módulos
--
-- • Índices de correção: a tabela é do Jurídico (0143), e a cobrança usa o mesmo
--   motor de cálculo. Lê a mesma tabela — duas tabelas de IGP-M divergiriam no
--   primeiro mês em que alguém atualizasse só uma.
-- • Empresas, contatos e a timeline: notificar é falar com as pessoas da empresa
--   devedora, e a cobrança mora na Company 360 dela. Os perfis de cobrança ganham o
--   módulo `empresas` em vez de políticas paralelas em cada tabela.
-- • Endereço de SPE: a SPE devedora raramente está em `empresas` (o cadastro é do
--   cabeça do grupo), e o endereço da notificação vem do cadastral da Receita
--   (`mercado_universo`), que só o Mercado lê inteiro. A RPC abaixo devolve SÓ a
--   qualificação dos CNPJs pedidos, e só a quem tem o módulo Cobrança.
-- ============================================================================

create policy juridico_indices_select_cobranca on public.juridico_indices
  for select to authenticated using ((select public.app_tem_modulo('cobranca')));

insert into public.perfil_modulos (perfil_id, modulo_id)
select p.id, 'empresas' from public.perfis p
where p.nome in ('Cobrança', 'Gestor de Cobrança')
on conflict do nothing;

create or replace function public.app_cobranca_cadastro(p_cnpjs text[])
returns table (
  cnpj text, razao_social text, empresa_id uuid,
  logradouro text, numero text, bairro text, municipio text, uf text, cep text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.app_cobranca_exige_modulo();
  return query
  select c.cnpj,
         coalesce(e.razao_social, u.razao_social, (select max(t.sacado_nome) from public.titulos t where t.sacado_cnpj = c.cnpj),
                  (select max(t.cedente_nome) from public.titulos t where t.cedente_cnpj = c.cnpj)),
         e.id, u.logradouro, u.numero, u.bairro, u.municipio, u.uf, u.cep
  from unnest(p_cnpjs) as c(cnpj)
  left join public.empresas e on e.cnpj = c.cnpj
  left join public.mercado_universo u on u.cnpj = c.cnpj
  limit 500;
end;
$$;

revoke all on function public.app_cobranca_cadastro(text[]) from public, anon;
grant execute on function public.app_cobranca_cadastro(text[]) to authenticated, service_role;
