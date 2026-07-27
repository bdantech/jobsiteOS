-- 0043 — SPEs "afiançadas": opt-in de quais CNPJs entram no monitoramento periódico de
-- protesto. Antes a rotina mensal (protestosClientesMensal) pegava TODAS as SPEs ativas
-- do grupo de cada cliente; agora ela monitora os clientes Onepay + os CNPJs marcados
-- aqui. Curadoria manual pela aba Grupo econômico da ficha da empresa.
create table if not exists public.protesto_monitoramento (
  cnpj text primary key
    constraint protesto_monitoramento_cnpj_check check (cnpj ~ '^[0-9]{14}$'),
  empresa_id uuid references public.empresas (id) on delete set null,
  grupo_id uuid,
  criado_por uuid,
  criado_em timestamptz not null default now()
);
comment on table public.protesto_monitoramento is 'SPEs (afiançadas) marcadas para o monitoramento mensal de protesto. Curadoria manual pela aba Grupo econômico.';

alter table public.protesto_monitoramento enable row level security;
-- Leitura pelo módulo; escrita só pelos RPCs SECURITY DEFINER abaixo (resolvem grupo/empresa).
create policy protesto_monitoramento_select on public.protesto_monitoramento
  for select to authenticated using (public.app_tem_modulo('radar'));
grant select on public.protesto_monitoramento to authenticated;

-- Lista as SPEs do grupo com a flag `monitorada`. Definer para juntar mercado_universo
-- (RLS de outro módulo) com a tabela do Radar; gate no Radar no topo.
create or replace function public.radar_grupo_spes_monitoramento(p_grupo_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if not public.app_tem_modulo('radar') then
    return jsonb_build_object('tem_acesso', false);
  end if;
  select coalesce(
    jsonb_agg(to_jsonb(t) order by t.monitorada desc, (t.situacao_cadastral = 'ativa') desc, t.razao_social nulls last),
    '[]'::jsonb
  ) into v
  from (
    select
      u.cnpj, u.razao_social, u.situacao_cadastral, u.data_inicio_atividade,
      u.capital_social, u.empresa_id,
      (m.cnpj is not null) as monitorada
    from public.mercado_universo u
    left join public.protesto_monitoramento m on m.cnpj = u.cnpj
    where u.grupo_id = p_grupo_id and u.is_spe
    limit 1000
  ) t;
  return jsonb_build_object('tem_acesso', true, 'spes', v);
end $$;
revoke execute on function public.radar_grupo_spes_monitoramento(uuid) from public;
grant execute on function public.radar_grupo_spes_monitoramento(uuid) to authenticated;

create or replace function public.app_monitorar_protesto(p_cnpj text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_emp uuid; v_grupo uuid;
begin
  if not public.app_tem_modulo('radar') then
    raise exception 'Sem acesso ao módulo Radar.' using errcode = '42501';
  end if;
  if p_cnpj !~ '^[0-9]{14}$' then
    raise exception 'CNPJ inválido.' using errcode = '22023';
  end if;
  select empresa_id, grupo_id into v_emp, v_grupo from public.mercado_universo where cnpj = p_cnpj;
  insert into public.protesto_monitoramento (cnpj, empresa_id, grupo_id, criado_por)
  values (p_cnpj, v_emp, v_grupo, auth.uid())
  on conflict (cnpj) do nothing;
end $$;
revoke execute on function public.app_monitorar_protesto(text) from public;
grant execute on function public.app_monitorar_protesto(text) to authenticated;

create or replace function public.app_desmonitorar_protesto(p_cnpj text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.app_tem_modulo('radar') then
    raise exception 'Sem acesso ao módulo Radar.' using errcode = '42501';
  end if;
  delete from public.protesto_monitoramento where cnpj = p_cnpj;
end $$;
revoke execute on function public.app_desmonitorar_protesto(text) from public;
grant execute on function public.app_desmonitorar_protesto(text) to authenticated;
