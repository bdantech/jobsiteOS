-- 0236 — A projeção passa a ser um superconjunto estrito do card de NF
--
-- O card é o mesmo para os três tipos (§8), e isso só é verdade se a projeção
-- disser TUDO o que o card da NF já dizia. Sete colunas faltavam, e cada uma era
-- uma perda pequena e concreta na tela de hoje:
--
--   `numero` / `serie`        o chip "nº 8821/1" vira "nº —"
--   `emitida_em`              o tooltip perde a data de emissão
--   `nao_operavel_motivo`     a auditoria de "por que esta nota sumiu?" emudece
--   `fornecedor_protesto_em`  o card de protesto volta a dizer "nunca consultamos"
--                             mesmo depois da consulta PAGA — o mesmo defeito que
--                             a lista de colunas do funil já causou uma vez
--   `conversao_valor`/`taxa`  a tira da nota convertida perde o valor e a taxa
--
-- Nenhuma delas aparece em typecheck. Todas aparecem como um campo vazio que
-- ninguém sabe explicar.
--
-- Nas fontes novas elas vêm NULAS, e isso é a resposta certa: uma parcela do ERP
-- não tem série, e "não operável" é um veredito sobre a natureza de operação de um
-- documento fiscal — uma oferta de antecipação já é, por definição, um recebível
-- que a construtora quis pagar. A exceção é a data do protesto, que é do
-- FORNECEDOR e não do documento: essa as três têm.

drop view if exists public.funil_oportunidades;

create view public.funil_oportunidades
with (security_invoker = true)
as
with parcelas_do_bill as (
  -- Quantas parcelas tem o título desta parcela — o "N de M" do card. Por
  -- (connection_id, bill_id) e nunca por bill_id sozinho.
  select connection_id, bill_id, count(*)::int as total
    from public.sienge_titulos
   group by connection_id, bill_id
)
-- ── NF ──
select
  'nf'::text                             as tipo,
  nf.access_key                          as id,
  nf.access_key,
  nf.fornecedor_cnpj,
  nf.fornecedor_nome,
  nf.fornecedor_empresa_id,
  nf.fornecedor_cadastrado,
  nf.fornecedor_tipagem,
  nf.fornecedor_tem_protesto,
  nf.fornecedor_suprimido,
  nf.fornecedor_sem_interesse,
  nf.fornecedor_uf,
  false                                  as credor_pessoa_fisica,
  nf.sacado_cnpj,
  nf.sacado_nome,
  public.app__matriz_do_cnpj(nf.sacado_cnpj) as sacado_matriz_cnpj,
  nf.sacado_empresa_id,
  nf.sacado_cadastrado,
  nf.valor,
  nf.vencimento,
  nf.emitida_em                          as data_base,
  nf.numero || coalesce('/' || nf.serie, '') as numero_exibicao,
  nf.status_sync                         as estado_origem,
  null::timestamptz                      as relogio,
  nf.dias_para_vencimento,
  nf.sacado_credito_status,
  nf.sacado_limite_disponivel,
  nf.sacado_limite_cobre_nota            as sacado_limite_cobre_valor,
  nf.receita_esperada,
  nf.taxa_usada,
  nf.tac_estimada,
  nf.seguro_estimado,
  nf.liquido_estimado,
  nf.faixa,
  nf.faixa_motivo,
  nf.estagio_funil,
  nf.estagio_alterado_em,
  nf.perda_motivo,
  nf.vendedor_id,
  nf.vendedor_origem,
  nf.operavel,
  -- A ÚNICA linha que varia por tipo, no mesmo lugar do card (§8).
  'nº ' || coalesce(nf.numero, '—') || coalesce('/' || nf.serie, '') as linha_contexto,
  selo.pre_autorizacao_id,
  selo.status                            as pre_autorizacao_status,
  selo.criada_em                         as pre_autorizacao_em,
  nf.conversao_antecipacao_id,
  nf.conversao_em_disputa,
  nf.sacado_limite_cobre_nota,
  nf.fornecedor_ja_antecipou,
  nf.fornecedor_e_cliente_onepay,
  nf.fornecedor_protesto_valor,
  nf.fornecedor_capital_social,
  nf.fornecedor_situacao_cadastral,
  nf.fornecedor_ultimo_numero_nf,
  nf.fornecedor_natureza_juridica,
  nf.sacado_uf,
  nf.direction,
  nf.tipo_nf,
  nf.vencimento_origem,
  nf.natureza_operacao,
  nf.numero,
  nf.serie,
  nf.emitida_em,
  nf.nao_operavel_motivo,
  nf.fornecedor_protesto_em,
  nf.conversao_valor,
  nf.conversao_taxa
from public.notas_funil nf
left join public.funil_selos_preauth selo
       on selo.tipo = 'nf' and selo.referencia_id = nf.access_key
where not exists (
  select 1 from public.funil_ocultacoes o
   where o.tipo = 'nf' and o.referencia_id = nf.access_key
)

union all

-- ── Pré-autorização ──
select
  'pre_autorizacao'::text,
  pa.id_externo::text,
  null::text,
  pa.fornecedor_cnpj,
  -- "Sem cadastro" é informação, não buraco: é o card de AQUISIÇÃO.
  coalesce(pa.fornecedor_nome, 'Sem cadastro'),
  pa.fornecedor_empresa_id,
  coalesce(pa.fornecedor_cadastrado, false),
  case
    when not coalesce(pa.fornecedor_cadastrado, false) then 'aquisicao'
    when fco.last_anticipation is not null or fe.ultima_antecipacao is not null then 'recorrencia'
    else 'ativacao'
  end,
  coalesce(fpa.tem_protesto, false),
  fsup.valor is not null,
  fsi.cnpj is not null,
  coalesce(fe.uf, fu.uf),
  false,
  pa.sacado_cnpj,
  pa.sacado_nome,
  pa.sacado_matriz_cnpj,
  pa.sacado_empresa_id,
  se.id is not null,
  pa.valor,
  pa.vencimento,
  pa.criada_em,
  coalesce(pa.invoice_number, pa.sienge_document_number, pa.identification),
  pa.status,
  pa.expira_em,
  -- Calculado AO VIVO, como na NF: o que envelhece não é o registro, é o
  -- calendário. A coluna gravada existe só para o motor de faixa ver a transição.
  (pa.vencimento - current_date)::int,
  pa.credit_status,
  pa.limite_disponivel_sacado,
  pa.limite_disponivel_sacado >= pa.valor,
  pa.receita_esperada,
  pa.taxa_usada,
  pa.tac_estimada,
  pa.seguro_estimado,
  greatest(0::numeric, pa.valor - coalesce(pa.receita_esperada, 0) - coalesce(pa.tac_estimada, 0)
                                - coalesce(pa.seguro_estimado, 0)),
  pa.faixa,
  pa.faixa_motivo,
  pa.estagio_funil,
  pa.estagio_alterado_em,
  pa.perda_motivo,
  pa.vendedor_id,
  pa.vendedor_origem,
  true,
  -- O RELÓGIO em palavras. É o que a pré-autorização tem e os outros dois não.
  case
    when pa.expira_em is null then 'origem ' || pa.origin
    when pa.expira_em < now() then 'expirou em ' || to_char(pa.expira_em, 'DD/MM')
    else 'expira em ' || greatest(0, (pa.expira_em::date - current_date))::text || ' dias'
  end || ' · ' || pa.origin,
  pa.id_externo,
  pa.status,
  pa.criada_em,
  pa.anticipation_id_externo,
  false,
  pa.limite_disponivel_sacado >= pa.valor,
  fco.last_anticipation is not null or fe.ultima_antecipacao is not null,
  fco.cnpj is not null,
  fpa.valor_total,
  fu.capital_social,
  fu.situacao_cadastral,
  -- O último número de NF do fornecedor é uma régua sobre a NUMERAÇÃO dele, e a
  -- pré-autorização não traz nota. Nulo aqui é honesto: a regra que usa esta
  -- variável simplesmente não casa, em vez de casar com um número inventado.
  null::bigint,
  public.natureza_juridica_codigo(fu.natureza_juridica),
  coalesce(se.uf, su.uf),
  null::text,
  null::text,
  null::text,
  null::text,
  null::text,
  null::text,
  null::timestamptz,
  -- "Não operável" é um veredito sobre a NATUREZA DA OPERAÇÃO de uma nota fiscal
  -- (remessa, devolução, comodato). Uma oferta de antecipação não tem natureza de
  -- operação — ela já é, por definição, um recebível que a construtora quis pagar.
  null::text,
  fpa.consultado_em,
  null::numeric,
  null::numeric
from public.pre_autorizacoes pa
left join public.empresas fe on fe.id = pa.fornecedor_empresa_id
left join public.empresas se on se.id = pa.sacado_empresa_id
left join public.mercado_universo fu on fu.cnpj = pa.fornecedor_cnpj
left join public.mercado_universo su on su.cnpj = pa.sacado_cnpj
left join public.protestos_atual fpa on fpa.cnpj = pa.fornecedor_cnpj
left join public.clientes_onepay fco on fco.cnpj = pa.fornecedor_cnpj
left join public.supressao fsup
       on fsup.escopo = 'empresa' and fsup.valor = pa.fornecedor_cnpj
      and (fsup.expira_em is null or fsup.expira_em >= current_date)
left join public.antecipacao_fornecedor_sem_interesse fsi on fsi.cnpj = pa.fornecedor_cnpj
where pa.origem_exibida
  and not exists (
    select 1 from public.funil_ocultacoes o
     where o.tipo = 'pre_autorizacao' and o.referencia_id = pa.id_externo::text
  )

union all

-- ── Título Sienge ──
select
  'titulo'::text,
  st.id_externo::text,
  -- A chave de acesso do título é a da NF que ele representa. Ela abre o mesmo
  -- documento no modal quando existe — e vem nula quando o ERP não a informou.
  coalesce(st.bill_access_key, st.nfe_candidate_access_key),
  st.credor_cnpj,
  coalesce(st.credor_nome, case when st.credor_pessoa_fisica then 'Credor PF' else 'Sem cadastro' end),
  st.credor_empresa_id,
  coalesce(st.credor_cadastrado, false),
  case
    when st.credor_pessoa_fisica then null
    when not coalesce(st.credor_cadastrado, false) then 'aquisicao'
    when cco.last_anticipation is not null or ce.ultima_antecipacao is not null then 'recorrencia'
    else 'ativacao'
  end,
  coalesce(cpa.tem_protesto, false),
  csup.valor is not null,
  csi.cnpj is not null,
  coalesce(ce.uf, cu.uf),
  st.credor_pessoa_fisica,
  st.sacado_cnpj,
  st.sacado_nome,
  st.sacado_matriz_cnpj,
  st.sacado_empresa_id,
  sse.id is not null,
  st.valor,
  st.vencimento,
  st.primeira_vez_visto,
  coalesce(st.bill_document_number, st.bill_id::text)
    || coalesce(', parcela ' || st.installment_number::text
                || coalesce('/' || pb.total::text, ''), ''),
  st.situation,
  null::timestamptz,
  (st.vencimento - current_date)::int,
  st.credit_status,
  st.limite_disponivel_sacado,
  st.limite_disponivel_sacado >= st.valor,
  st.receita_esperada,
  st.taxa_usada,
  st.tac_estimada,
  st.seguro_estimado,
  greatest(0::numeric, st.valor - coalesce(st.receita_esperada, 0) - coalesce(st.tac_estimada, 0)
                                - coalesce(st.seguro_estimado, 0)),
  st.faixa,
  st.faixa_motivo,
  st.estagio_funil,
  st.estagio_alterado_em,
  st.perda_motivo,
  st.vendedor_id,
  st.vendedor_origem,
  true,
  coalesce(st.bill_document_number, 'doc ' || st.bill_id::text)
    || coalesce(' · parcela ' || st.installment_number::text
                || coalesce('/' || pb.total::text, ''), '')
    || ' · ' || st.situation
    || coalesce(' · ' || st.guard_reason, ''),
  selo2.pre_autorizacao_id,
  selo2.status,
  selo2.criada_em,
  st.anticipation_id_externo,
  false,
  st.limite_disponivel_sacado >= st.valor,
  cco.last_anticipation is not null or ce.ultima_antecipacao is not null,
  cco.cnpj is not null,
  cpa.valor_total,
  cu.capital_social,
  cu.situacao_cadastral,
  null::bigint,
  public.natureza_juridica_codigo(cu.natureza_juridica),
  coalesce(sse.uf, ssu.uf),
  null::text,
  null::text,
  null::text,
  null::text,
  null::text,
  null::text,
  null::timestamptz,
  null::text,
  cpa.consultado_em,
  null::numeric,
  null::numeric
from public.sienge_titulos st
left join parcelas_do_bill pb
       on pb.bill_id = st.bill_id and pb.connection_id is not distinct from st.connection_id
left join public.empresas ce on ce.id = st.credor_empresa_id
left join public.empresas sse on sse.id = st.sacado_empresa_id
left join public.mercado_universo cu on cu.cnpj = st.credor_cnpj
left join public.mercado_universo ssu on ssu.cnpj = st.sacado_cnpj
left join public.protestos_atual cpa on cpa.cnpj = st.credor_cnpj
left join public.clientes_onepay cco on cco.cnpj = st.credor_cnpj
left join public.supressao csup
       on csup.escopo = 'empresa' and csup.valor = st.credor_cnpj
      and (csup.expira_em is null or csup.expira_em >= current_date)
left join public.antecipacao_fornecedor_sem_interesse csi on csi.cnpj = st.credor_cnpj
left join public.funil_selos_preauth selo2
       on selo2.tipo = 'titulo' and selo2.referencia_id = st.id_externo::text
where st.origem_exibida
  and not exists (
    select 1 from public.funil_ocultacoes o
     where o.tipo = 'titulo' and o.referencia_id = st.id_externo::text
  );


comment on view public.funil_oportunidades is
  'A projeção do funil (04s §6): NFs, pré-autorizações e parcelas do Sienge sob o MESMO contrato de card, com os MESMOS nomes de coluna que o motor de faixas lê. Superconjunto estrito do que o card da NF já mostrava. Somente leitura. security_invoker = true.';

grant select on public.funil_oportunidades to authenticated;
