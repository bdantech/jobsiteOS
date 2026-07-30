-- 0067 — O preço da consulta de protesto, legível por quem vai clicar no botão.
--
-- O botão de protesto no funil precisa dizer quanto custa ANTES do clique. O preço
-- mora em `radar_config` (chave `custos`), cuja policy é `app_tem_modulo('radar')` —
-- e o público do funil é o Comercial, que não tem Radar.
--
-- As alternativas eram piores. Chumbar o número no front cria uma segunda verdade
-- que diverge no dia em que alguém mudar o preço em Radar, e um botão que promete
-- R$ 0,36 e cobra outra coisa é pior do que um botão sem preço. Ler com service role
-- no servidor da web abriria a quinta exceção do `createAdminClient`, cuja
-- documentação existe justamente para essas exceções não crescerem.
--
-- Então: uma função DEFINER que devolve DOIS NÚMEROS e nada mais. Não é acesso a
-- `radar_config` — é acesso ao preço de uma ação que a pessoa já pode disparar.

create or replace function public.antecipacao_custo_protesto()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_custos jsonb;
begin
  if not (public.app_tem_modulo('antecipacao') or public.app_tem_modulo('radar')) then
    raise exception 'Sem acesso.' using errcode = '42501';
  end if;

  select valor into v_custos from public.radar_config where chave = 'custos';

  -- Os defaults espelham `lerCustos()` no worker: se a linha sumir, a tela mostra o
  -- mesmo número que o job vai cobrar, em vez de "—".
  return jsonb_build_object(
    'sp', coalesce((v_custos ->> 'protesto_sp')::numeric, 0.36),
    'nacional', coalesce((v_custos ->> 'protesto_nacional')::numeric, 3.5)
  );
end; $$;

revoke execute on function public.antecipacao_custo_protesto() from public;
grant execute on function public.antecipacao_custo_protesto() to authenticated, service_role;

comment on function public.antecipacao_custo_protesto is
  'Preço da consulta de protesto (SP e nacional), para o botão sob demanda do funil. '
  'DEFINER porque radar_config exige o módulo Radar e o público do funil é o '
  'Comercial — devolve dois números, não a tabela.';
