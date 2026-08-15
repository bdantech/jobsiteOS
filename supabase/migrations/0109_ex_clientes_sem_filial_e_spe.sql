-- =============================================================================
-- 0109 — Filial e SPE não são o cliente que saiu
--
-- A primeira carga real detectou 21 ex-clientes, e 17 deles não eram clientes:
--   5 FILIAIS de matriz ATIVA (a VALKA CONSTRUÇÕES apareceu quatro vezes, uma por
--     filial, sendo cliente ativa o tempo todo) — filial não é empresa, é endereço
--     da mesma pessoa jurídica;
--   12 SPEs, herança da prática antiga de abrir análise de crédito por SPE. A SPE é
--     veículo de obra: ela nasce com o empreendimento e some quando ele acaba. O
--     cliente é a holding.
--
-- Sobraram 4 matrizes comuns — os ex-clientes de verdade.
--
-- DUAS CORREÇÕES EM CAMADAS DIFERENTES, e as duas são necessárias:
--
--   No CLASSIFICADOR (core), o guard novo: raiz de CNPJ ou grupo econômico com
--   cliente ativo → não houve perda. Isso impede que os 6 casos factualmente errados
--   (5 filiais + 1 SPE de grupo ativo) voltem a ser marcados, e desfaz os já marcados.
--
--   AQUI, na view, as flags: `e_filial`, `e_spe` e `e_principal`. Elas não escondem
--   nada do banco — a lista é que passa a abrir no recorte de cliente principal, com
--   os outros a um clique. As 11 SPEs cujo grupo REALMENTE saiu continuam sendo
--   perda; elas só não são a resposta para "quais clientes perdemos?".
--
-- Por que flag e não filtro fixo na view: "todas as SPEs de um grupo saíram no mesmo
-- trimestre" é informação, e uma view que as apagasse tornaria essa leitura
-- impossível. Quem decide o recorte é a tela.
-- =============================================================================

create or replace view public.ex_clientes
with (security_invoker = true) as
  select
    e.id as empresa_id, e.cnpj,
    coalesce(e.razao_social, e.nome_fantasia, a.company_name) as nome,
    e.ex_cliente_desde,
    case when e.ex_cliente_desde is null then null
      else greatest(0, (extract(year from age(current_date, e.ex_cliente_desde)) * 12
                        + extract(month from age(current_date, e.ex_cliente_desde)))::int) end as meses_desde,
    e.ex_cliente_motivo, m.motivo as ex_cliente_motivo_label, e.ex_cliente_motivo_obs,
    e.gestao_operacao, e.uf, e.municipio,
    a.credit_limit as ultimo_limite, a.consumed_limit as consumo_historico,
    a.monthly_rate_d0 as ultima_taxa_d0, a.expiration_date as ultima_analise_expirou_em,
    a.status as ultima_analise_status,
    sug.motivo_id as motivo_sugerido, sug.motivo as motivo_sugerido_label,
    sug.evidencia as motivo_sugerido_evidencia,
    substring(e.cnpj from 9 for 4) <> '0001' as e_filial,
    coalesce(mu.is_spe, e.is_spe, false) as e_spe,
    not (substring(e.cnpj from 9 for 4) <> '0001' or coalesce(mu.is_spe, e.is_spe, false)) as e_principal
  from public.empresas e
    left join public.analises_plataforma_atual a on a.cnpj = e.cnpj
    left join public.motivos_perda m on m.id = e.ex_cliente_motivo
    left join public.mercado_universo mu on mu.cnpj = e.cnpj
    left join lateral (
      select mp.id as motivo_id, mp.motivo, s.evidencia
      from (
        select
          case
            when mu2.situacao_cadastral in ('baixada','nula') then 'Encerrou atividades / recuperação judicial'
            when coalesce(pa.tem_protesto,false) then 'Inadimplência / default'
            when cert.cnpj is not null and cert.expires_at < e.ex_cliente_desde then 'Certificado / cadastro vencido e não renovado'
            when a.status = 'blocked' then 'Análise não renovada pela plataforma'
          end as alvo,
          case
            when mu2.situacao_cadastral in ('baixada','nula') then 'Situação cadastral na Receita: ' || mu2.situacao_cadastral || '.'
            when coalesce(pa.tem_protesto,false) then 'Protesto registrado (consulta de ' || to_char(pa.consultado_em,'DD/MM/YYYY') || ').'
            when cert.cnpj is not null and cert.expires_at < e.ex_cliente_desde then 'Certificado digital venceu em ' || to_char(cert.expires_at,'DD/MM/YYYY') || ', antes da saída, e não foi renovado.'
            when a.status = 'blocked' then 'A análise na plataforma está BLOQUEADA — foi a plataforma que fechou a porta.'
          end as evidencia
        from (select 1) _
          left join public.mercado_universo mu2 on mu2.cnpj = e.cnpj
          left join public.protestos_atual pa on pa.cnpj = e.cnpj
          left join public.certificados cert on cert.cnpj = e.cnpj
      ) s
      join public.motivos_perda mp on mp.contexto = 'ex_cliente' and mp.motivo = s.alvo and mp.ativo
      limit 1
    ) sug on true
  where e.estagio = 'ex_cliente';

grant select on public.ex_clientes to authenticated;

comment on column public.ex_clientes.e_principal is
  'Nem filial nem SPE — o cliente de verdade. É o recorte padrão da lista: a carteira '
  'se olha por matriz e holding, e a prática antiga de abrir análise por SPE e por '
  'filial enche a lista de veículos de obra e endereços da mesma pessoa jurídica.';
