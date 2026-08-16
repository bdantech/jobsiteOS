-- =============================================================================
-- 0111 — SPE que o flag não pega: nome e natureza jurídica
--
-- `mercado_universo.is_spe` é derivado do enriquecimento cadastral, e 55 dos 148
-- ex-clientes NÃO ESTÃO no universo — nunca foram enriquecidos. Para eles o flag é
-- `false` por ausência de dado, não por serem matriz, e o resultado é que empresas
-- com "SPE" na própria razão social passavam como cliente principal.
--
-- Duas evidências novas, ambas baratas e independentes do enriquecimento:
--
--   NOME — `SPE` ou `SCP` como palavra inteira. A borda de palavra é o detalhe que
--     faz a regra funcionar: sem ela, "ESPECIAL" e "PROSPECT" virariam veículo.
--
--   NATUREZA JURÍDICA 2127 — Sociedade em Conta de Participação. É veículo de
--     investimento por definição legal, e o código veio de graça com a 0105.
--
-- `origem_spe` registra QUAL das três decidiu. Uma heurística que não diz por que
-- classificou é uma heurística que ninguém consegue contestar — e esta vai errar
-- em algum caso.
--
-- O efeito medido: os "principais" caem de 90 para 37, e o grupo RFM sai de 14
-- entidades na lista para 4 — que são as operacionais (RFM CONSTRUTORA e RFM
-- INCORPORADORA, ambas com R$ 5 mi de limite, contra R$ 1 mi dos veículos).
--
-- A RAIZ do problema continua sendo o enriquecimento: os 55 CNPJs ausentes foram
-- enfileirados em `cnpj_lookup_fila`. Quando o lookup rodar, `is_spe` e o grupo
-- econômico passam a funcionar para eles, e a heurística de nome vira rede.
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
          or coalesce(e.razao_social, e.nome_fantasia, '') ~* '(^|[^A-Za-z])(SPE|SCP)([^A-Za-z]|$)'
          or public.natureza_juridica_codigo(mu.natureza_juridica) = '2127'
          as e_spe,
        case
          when coalesce(mu.is_spe, e.is_spe, false) then 'flag'
          when coalesce(e.razao_social, e.nome_fantasia, '') ~* '(^|[^A-Za-z])(SPE|SCP)([^A-Za-z]|$)' then 'nome'
          when public.natureza_juridica_codigo(mu.natureza_juridica) = '2127' then 'natureza_2127'
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

comment on column public.ex_clientes.origem_spe is
  'De onde veio a marca de veículo: `flag` (is_spe do universo), `nome` (SPE/SCP na '
  'razão social) ou `natureza_2127` (Sociedade em Conta de Participação). Explicita '
  'a heurística para quem discordar do recorte saber o que contestar.';

-- Os CNPJs ausentes do universo entram na fila de lookup: sem enriquecimento,
-- `is_spe` e o grupo econômico não têm como funcionar para eles.
insert into public.cnpj_lookup_fila (cnpj, motivo, status)
select x.cnpj from public.ex_clientes x
  left join public.mercado_universo mu on mu.cnpj = x.cnpj
where mu.cnpj is null
on conflict (cnpj) do nothing;
