-- =============================================================================
-- 0107 — A sugestão de motivo da saída, com evidência (04h §2)
--
-- O motivo do churn é conhecimento humano, e a 0106 deixou isso explícito: o sync
-- grava "Motivo desconhecido" e alguém classifica. Mas há casos em que a base JÁ
-- SABE, e pedir que a pessoa digite o que o sistema tem na frente é o tipo de
-- fricção que faz a lista inteira ficar sem classificação.
--
-- A REGRA É "PRÉ-PREENCHE, HUMANO CONFIRMA". A sugestão nunca é gravada em
-- `empresas.ex_cliente_motivo` — ela é CALCULADA na view, aparece na tela como
-- sugestão e só vira dado quando alguém clica. Gravar automaticamente produziria
-- um gráfico de churn cheio de causas que ninguém verificou, e ele seria lido como
-- se tivesse sido.
--
-- SÓ TRÊS EVIDÊNCIAS, e as três são FATOS de fonte externa, não inferências:
--
--   1. Situação cadastral baixada/nula na Receita → "Encerrou atividades". A
--      empresa fechou; não há o que reativar.
--   2. Protesto registrado → "Inadimplência / default". A saída pelo lado do risco.
--   3. Certificado digital vencido e não renovado → "Certificado / cadastro
--      vencido". A conexão morreu por fricção operacional, não por decisão.
--
-- A ORDEM É DE FORÇA, não de conveniência: uma empresa baixada pode ter protesto e
-- certificado vencido ao mesmo tempo, e das três a que explica a saída é o
-- fechamento. Trocar a ordem faria "inadimplência" carimbar empresas que
-- simplesmente encerraram.
--
-- O que NÃO virou evidência: "score despencou no período". O scorecard é recalculado
-- por versão e não guarda série por data de saída, então "despencou" não é uma
-- pergunta que a base responde hoje — e uma sugestão baseada em comparação que não
-- existe seria um palpite com cara de fato.
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

    -- ── A sugestão (nunca gravada; a tela pré-preenche e a pessoa confirma) ──
    sug.motivo_id as motivo_sugerido,
    sug.motivo as motivo_sugerido_label,
    -- A evidência viaja junto do palpite. Uma sugestão sem o porquê é um chute com
    -- autoridade de sistema, e quem confirma precisa poder discordar com base.
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
          end as alvo,
          case
            when mu.situacao_cadastral in ('baixada', 'nula')
              then 'Situação cadastral na Receita: ' || mu.situacao_cadastral || '.'
            when coalesce(pa.tem_protesto, false)
              then 'Protesto registrado (consulta de ' || to_char(pa.consultado_em, 'DD/MM/YYYY') || ').'
            when cert.cnpj is not null and cert.expires_at < e.ex_cliente_desde
              then 'Certificado digital venceu em ' || to_char(cert.expires_at, 'DD/MM/YYYY')
                   || ', antes da saída, e não foi renovado.'
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

comment on column public.ex_clientes.motivo_sugerido_evidencia is
  'Por que o sistema sugeriu aquele motivo, em uma frase. Sem ela a sugestão é um '
  'chute com autoridade de sistema, e quem confirma não tem como discordar com base.';
