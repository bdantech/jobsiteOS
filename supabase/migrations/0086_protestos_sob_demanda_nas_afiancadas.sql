-- ─────────────────────────────────────────────────────────────────────────────
-- "Rodar protestos" ganha o escopo das SPEs AFIANÇADAS
--
-- Hoje há dois escopos: só a empresa, ou a empresa + todas as SPEs ativas do grupo
-- criadas a partir de um ano. O ano é um proxy — "as recentes provavelmente são as
-- que importam" —, e quem sabe quais importam já respondeu isso ao marcar as
-- afiançadas em `protesto_monitoramento`. Consulta é paga: rodar em 40 SPEs por
-- corte de ano quando 6 são afiançadas é gastar 34 consultas para confirmar que as
-- outras seguem sem protesto.
--
-- O parâmetro novo tem DEFAULT false, e isso é deliberado: a migração vai para o
-- banco antes de a Vercel publicar, e a tela antiga chama a função com três
-- argumentos. Com default, essa chamada continua resolvendo — sem default, ela
-- quebraria durante a janela entre um deploy e outro.
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists public.radar_protestos_empresa_previa(uuid, boolean, integer);

create or replace function public.radar_protestos_empresa_previa(
  p_empresa_id uuid,
  p_incluir_spes boolean,
  p_ano_min integer,
  p_somente_afiancadas boolean default false
)
returns jsonb language plpgsql stable security definer set search_path to '' as $function$
declare
  v_cnpj text;
  v_grupo uuid;
  v_qtd int;
  v_custo_unit numeric;
begin
  if not public.app_tem_modulo('radar') then
    return jsonb_build_object('tem_acesso', false);
  end if;

  select cnpj, grupo_id into v_cnpj, v_grupo from public.empresas where id = p_empresa_id;
  if v_cnpj is null then
    return jsonb_build_object('tem_acesso', true, 'qtd', 0, 'custo_estimado', 0);
  end if;

  -- A própria empresa sempre entra. Depois, um dos dois recortes de SPE.
  with alvo as (
    select v_cnpj as cnpj
    union
    -- Afiançadas: quem foi marcado à mão. Duas portas porque a marcação guarda cnpj
    -- E grupo_id — uma SPE marcada pode não estar em mercado_universo, e aí só o
    -- grupo_id a alcança. Sem filtro de ano nem de situação: se alguém marcou, é
    -- porque quer acompanhar.
    select pm.cnpj
    from public.protesto_monitoramento pm
    where p_incluir_spes and p_somente_afiancadas and v_grupo is not null
      and (pm.grupo_id = v_grupo
           or exists (select 1 from public.mercado_universo u2
                      where u2.cnpj = pm.cnpj and u2.grupo_id = v_grupo))
    union
    -- Por ano: SPEs ATIVAS do grupo criadas a partir do ano escolhido.
    -- data_inicio_atividade nula fica de fora quando há filtro de ano.
    select u.cnpj
    from public.mercado_universo u
    where p_incluir_spes and not p_somente_afiancadas and v_grupo is not null
      and u.grupo_id = v_grupo and u.is_spe and u.situacao_cadastral = 'ativa'
      and (p_ano_min is null or extract(year from u.data_inicio_atividade) >= p_ano_min)
  )
  select count(*) into v_qtd from alvo;

  select coalesce((valor ->> 'protesto_nacional')::numeric, 3.5) into v_custo_unit
  from public.radar_config where chave = 'custos';
  v_custo_unit := coalesce(v_custo_unit, 3.5);

  return jsonb_build_object(
    'tem_acesso', true,
    'qtd', v_qtd,
    'custo_estimado', round(v_qtd * v_custo_unit, 2)
  );
end $function$;

revoke execute on function public.radar_protestos_empresa_previa(uuid, boolean, integer, boolean) from public;
grant execute on function public.radar_protestos_empresa_previa(uuid, boolean, integer, boolean)
  to authenticated, service_role;

comment on function public.radar_protestos_empresa_previa is
  'Quantas empresas e quanto custa rodar protestos a partir de uma empresa. Três '
  'escopos: só ela, + SPEs ativas por ano de criação, ou + SPEs afiançadas '
  '(protesto_monitoramento). A tela mostra o número ANTES de cobrar.';
