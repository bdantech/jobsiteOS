-- 0071 — Cobertura de headcount no painel do Radar (04c §8).
--
-- O painel já responde "quantos têm domínio, contato e protesto por camada". Sem o
-- headcount ali, a pergunta "dá para estimar faturamento do SAM?" não tinha onde ser
-- respondida — e ela é a que decide se vale montar um lote de funcionários.
--
-- `com_funcionarios` conta pela EMPRESA, não pela série: é o cache que alimenta o
-- filtro do Explorador, e é ele que precisa estar preenchido para o lote fazer
-- sentido. Contar snapshots contaria também CNPJs que têm série mas não têm empresa
-- — que são exatamente os que o lote não consegue trabalhar.

create or replace function public.radar_cobertura()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  if not public.app_tem_modulo('radar') then
    raise exception 'Sem acesso ao módulo Radar.' using errcode = '42501';
  end if;

  select jsonb_agg(row_to_json(t)) into v from (
    select
      u.camada,
      count(*)::int as total,
      count(*) filter (where coalesce(e.dominio, u.dominio) is not null)::int as com_dominio,
      count(*) filter (
        where u.empresa_id in (select distinct empresa_id from public.contatos where empresa_id is not null)
      )::int as com_contato,
      count(*) filter (
        where u.cnpj in (select distinct cnpj from public.protestos_consultas)
      )::int as com_protesto,
      count(*) filter (where e.funcionarios is not null)::int as com_funcionarios,
      count(*) filter (where e.faturamento_anual is not null)::int as com_faturamento
    from public.mercado_universo u
    left join public.empresas e on e.id = u.empresa_id
    group by u.camada
  ) t;

  return coalesce(v, '[]'::jsonb);
end; $$;

comment on function public.radar_cobertura is
  'Cobertura de enriquecimento por camada: domínio, contato, protesto, headcount e '
  'faturamento. Headcount e faturamento contam pelo CACHE em empresas — é ele que o '
  'filtro do Explorador lê.';
