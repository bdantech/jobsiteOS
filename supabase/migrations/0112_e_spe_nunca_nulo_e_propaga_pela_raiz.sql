-- =============================================================================
-- 0112 — Dois defeitos no recorte de SPE: o NULO e a raiz do CNPJ
--
-- Depois da 0111 as SPEs do RFM continuavam na lista de principais. Duas causas.
--
-- 1. `e_spe` VINHA NULO em 45 das 148 linhas. `false or false or NULL` é NULL em
--    SQL, não false, e `natureza_juridica_codigo()` devolve NULL para quem não está
--    em `mercado_universo`. `e_principal = not(filial or NULL)` também virava NULL, e
--    um filtro de tela que testa `<> false` deixa NULO passar — a empresa voltava
--    para a lista sem nunca ter sido classificada. O COALESCE agora é por parcela,
--    não no fim: é a única posição em que ele fecha o buraco.
--
-- 2. SPE É ATRIBUTO DA PESSOA JURÍDICA, não do estabelecimento. A filial
--    40717487/0002-23 vem marcada do universo e a matriz 40717487/0001-42 — que nem
--    está no universo — passava como cliente principal. É a MESMA empresa. A marca
--    passa a propagar pela raiz do CNPJ, e isso resolveu 4 dos 14 casos restantes.
--
-- SOBRE A PERFORMANCE, que quase custou a solução: a primeira versão de
-- `raiz_e_spe` comparava `substring(cnpj from 1 for 8)` e o planejador ignorou o
-- índice por expressão que criei para ela — seq scan de 783 mil linhas, 3.361 ms por
-- chamada, e a view chama duas vezes por linha. Estourou o statement_timeout.
--
-- A varredura de FAIXA sobre o próprio `cnpj` usa o índice da chave primária e sai em
-- 0,145 ms: vinte mil vezes mais rápido, e sem índice novo para manter. Os limites
-- são o CNPJ inteiro em vez de LIKE porque prefixo com LIKE depende de
-- text_pattern_ops quando a coluna tem collation, enquanto uma faixa fechada compara
-- os dois extremos com a MESMA regra que ordena o índice.
-- =============================================================================

drop index if exists public.mercado_universo_raiz_idx;

create or replace function public.raiz_e_spe(p_cnpj text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.mercado_universo m
    where m.cnpj >= substring(p_cnpj from 1 for 8) || '000000'
      and m.cnpj <= substring(p_cnpj from 1 for 8) || '999999'
      and (m.is_spe
           or coalesce(m.razao_social ~* '(^|[^A-Za-z])(SPE|SCP)([^A-Za-z]|$)', false)
           or public.natureza_juridica_codigo(m.natureza_juridica) = '2127')
  );
$$;

comment on function public.raiz_e_spe(text) is
  'Algum CNPJ da mesma raiz é veículo (flag, nome ou natureza 2127)? SPE é atributo da '
  'pessoa jurídica; a matriz não enriquecida herda o que a filial já revelou. Faixa '
  'sobre o cnpj para usar o índice da PK — a versão com substring() fazia seq scan.';

grant execute on function public.raiz_e_spe(text) to authenticated;

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
    v.e_spe,
    not (substring(e.cnpj from 9 for 4) <> '0001' or v.e_spe) as e_principal,
    v.origem_spe
  from public.empresas e
    left join public.analises_plataforma_atual a on a.cnpj = e.cnpj
    left join public.motivos_perda m on m.id = e.ex_cliente_motivo
    left join public.mercado_universo mu on mu.cnpj = e.cnpj
    left join lateral (
      select
        coalesce(mu.is_spe, e.is_spe, false)
          or coalesce(coalesce(e.razao_social, e.nome_fantasia, '') ~* '(^|[^A-Za-z])(SPE|SCP)([^A-Za-z]|$)', false)
          or coalesce(public.natureza_juridica_codigo(mu.natureza_juridica) = '2127', false)
          or public.raiz_e_spe(e.cnpj)
          as e_spe,
        case
          when coalesce(mu.is_spe, e.is_spe, false) then 'flag'
          when coalesce(coalesce(e.razao_social, e.nome_fantasia, '') ~* '(^|[^A-Za-z])(SPE|SCP)([^A-Za-z]|$)', false) then 'nome'
          when coalesce(public.natureza_juridica_codigo(mu.natureza_juridica) = '2127', false) then 'natureza_2127'
          when public.raiz_e_spe(e.cnpj) then 'raiz'
        end as origem_spe
    ) v on true
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
