-- =============================================================================
-- 0108 — `blocked` como quarta evidência da sugestão de motivo
--
-- A primeira carga real ensinou o vocabulário da fonte: o endpoint não devolve
-- `expired`, devolve `approved` e **`blocked`** — e os 21 ex-clientes detectados são
-- todos `blocked`. O status é, ele mesmo, um FATO sobre a saída: foi a plataforma
-- que fechou a porta, não o cliente que sumiu.
--
-- Isso mapeia exatamente no motivo "Análise não renovada pela plataforma", que a
-- 0106 semeou com a descrição "nós optamos por não renovar (crédito/risco nosso)".
--
-- ENTRA EM ÚLTIMO na ordem de força, e não é detalhe: `blocked` diz QUEM fechou, não
-- POR QUÊ. Se houver protesto, a razão do bloqueio provavelmente é a inadimplência, e
-- é ela que explica; se a empresa está baixada na Receita, o bloqueio é consequência
-- do fechamento. Só quando nenhuma das três primeiras evidências existe é que
-- "a plataforma bloqueou" é a coisa mais precisa que se pode dizer.
-- =============================================================================

create or replace view public.ex_clientes
with (security_invoker = true) as
  select
    e.id as empresa_id,
    e.cnpj,
    coalesce(e.razao_social, e.nome_fantasia, a.company_name) as nome,
    e.ex_cliente_desde,
    case
      when e.ex_cliente_desde is null then null
      else greatest(0, (extract(year from age(current_date, e.ex_cliente_desde)) * 12
                        + extract(month from age(current_date, e.ex_cliente_desde)))::int)
    end as meses_desde,
    e.ex_cliente_motivo,
    m.motivo as ex_cliente_motivo_label,
    e.ex_cliente_motivo_obs,
    e.gestao_operacao,
    e.uf,
    e.municipio,
    a.credit_limit as ultimo_limite,
    a.consumed_limit as consumo_historico,
    a.monthly_rate_d0 as ultima_taxa_d0,
    a.expiration_date as ultima_analise_expirou_em,
    a.status as ultima_analise_status,
    sug.motivo_id as motivo_sugerido,
    sug.motivo as motivo_sugerido_label,
    sug.evidencia as motivo_sugerido_evidencia
  from public.empresas e
    left join public.analises_plataforma_atual a on a.cnpj = e.cnpj
    left join public.motivos_perda m on m.id = e.ex_cliente_motivo
    left join lateral (
      select mp.id as motivo_id, mp.motivo, s.evidencia
      from (
        select
          case
            when mu.situacao_cadastral in ('baixada', 'nula')
              then 'Encerrou atividades / recuperação judicial'
            when coalesce(pa.tem_protesto, false)
              then 'Inadimplência / default'
            when cert.cnpj is not null and cert.expires_at < e.ex_cliente_desde
              then 'Certificado / cadastro vencido e não renovado'
            when a.status = 'blocked'
              then 'Análise não renovada pela plataforma'
          end as alvo,
          case
            when mu.situacao_cadastral in ('baixada', 'nula')
              then 'Situação cadastral na Receita: ' || mu.situacao_cadastral || '.'
            when coalesce(pa.tem_protesto, false)
              then 'Protesto registrado (consulta de ' || to_char(pa.consultado_em, 'DD/MM/YYYY') || ').'
            when cert.cnpj is not null and cert.expires_at < e.ex_cliente_desde
              then 'Certificado digital venceu em ' || to_char(cert.expires_at, 'DD/MM/YYYY')
                   || ', antes da saída, e não foi renovado.'
            when a.status = 'blocked'
              then 'A análise na plataforma está BLOQUEADA — foi a plataforma que fechou a porta.'
          end as evidencia
        from (select 1) _
          left join public.mercado_universo mu on mu.cnpj = e.cnpj
          left join public.protestos_atual pa on pa.cnpj = e.cnpj
          left join public.certificados cert on cert.cnpj = e.cnpj
      ) s
      join public.motivos_perda mp
        on mp.contexto = 'ex_cliente' and mp.motivo = s.alvo and mp.ativo
      limit 1
    ) sug on true
  where e.estagio = 'ex_cliente';

grant select on public.ex_clientes to authenticated;

comment on view public.ex_clientes is
  'Quem foi cliente e saiu, com desde quando, último limite, consumo histórico, a taxa '
  'que tinha e — quando a base tem FATO externo que explique — um motivo sugerido com '
  'a evidência. A sugestão nunca é gravada: pré-preenche, e a pessoa confirma.';
