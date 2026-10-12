/*
 * Título com vencimento além de 180 dias não aparece no funil.
 *
 * Em 12/10/2026, 2.116 dos 3.472 títulos Sienge exibidos venciam depois de 180 dias —
 * quase todos PCT (parcela de contrato), com cronograma mensal até 2050. Isso não é
 * título operável: ninguém antecipa uma parcela de 2031. Eles só ocupavam o Kanban.
 *
 * ── A RÉGUA ────────────────────────────────────────────────────────────────
 * `vencimento > CURRENT_DATE + 180` fica fora. É a mesma conta de `dias_para_vencimento`
 * do card, e por ser calculada na leitura ela anda sozinha: o título que hoje vence em
 * 181 dias aparece amanhã, sem job nenhum. Título sem vencimento continua aparecendo.
 *
 * ── A PRÉ-AUTORIZAÇÃO NASCIDA DO TÍTULO SEGUE A MESMA RÉGUA ─────────────────
 * Quando a oferta é criada o título some atrás dela (0257). Filtrar só o título
 * deixaria a mesma parcela de 2031 no Kanban, agora com cara de oferta. Vale para a
 * pré-autorização de origem `sienge` ou que carrega tipo de documento do Sienge.
 *
 * A pré-autorização MANUAL e a NF ficam de fora de propósito: das 84 pré-autorizações
 * manuais acima de 180 dias, 70 viraram antecipação. Lá o prazo longo é operado.
 *
 * ── É APRESENTAÇÃO, NÃO DADO ───────────────────────────────────────────────
 * Nada é apagado nem muda de estágio. Roteamento e sync continuam lendo as tabelas.
 * A reclassificação de faixa lê a view, então o título escondido fica com a faixa
 * parada até voltar a aparecer — e é reclassificado na corrida seguinte.
 *
 * `funil_oportunidades` (a união) não muda: mesma lista de colunas.
 * Toda view recriada aqui reafirma `security_invoker` logo abaixo (0099, 0225).
 */

-- ─── 1. A pré-autorização nascida de título Sienge ──────────────────────────

create or replace view public.funil_oportunidades_preauth as
 SELECT 'pre_autorizacao'::text AS tipo,
    (pa.id_externo)::text AS id,
    NULL::text AS access_key,
    pa.fornecedor_cnpj,
    COALESCE(pa.fornecedor_nome, fe.razao_social, fu.razao_social, fu.nome_fantasia, 'Sem cadastro'::text) AS fornecedor_nome,
    pa.fornecedor_empresa_id,
    COALESCE(pa.fornecedor_cadastrado, false) AS fornecedor_cadastrado,
        CASE
            WHEN (NOT COALESCE(pa.fornecedor_cadastrado, false)) THEN 'aquisicao'::text
            WHEN ((fco.last_anticipation IS NOT NULL) OR (fe.ultima_antecipacao IS NOT NULL)) THEN 'recorrencia'::text
            ELSE 'ativacao'::text
        END AS fornecedor_tipagem,
    COALESCE(fpa.tem_protesto, false) AS fornecedor_tem_protesto,
    (fsup.valor IS NOT NULL) AS fornecedor_suprimido,
    (fsi.cnpj IS NOT NULL) AS fornecedor_sem_interesse,
    COALESCE(fe.uf, fu.uf) AS fornecedor_uf,
    false AS credor_pessoa_fisica,
    pa.sacado_cnpj,
    pa.sacado_nome,
    pa.sacado_matriz_cnpj,
    pa.sacado_empresa_id,
    (se.id IS NOT NULL) AS sacado_cadastrado,
    pa.valor,
    pa.vencimento,
    pa.criada_em AS data_base,
    COALESCE(pa.invoice_number, pa.sienge_document_number, pa.identification) AS numero_exibicao,
    pa.status AS estado_origem,
    pa.expira_em AS relogio,
    (pa.vencimento - CURRENT_DATE) AS dias_para_vencimento,
    pa.credit_status AS sacado_credito_status,
    pa.limite_disponivel_sacado AS sacado_limite_disponivel,
    (pa.limite_disponivel_sacado >= pa.valor) AS sacado_limite_cobre_valor,
    pa.receita_esperada,
    pa.taxa_usada,
    pa.tac_estimada,
    pa.seguro_estimado,
    GREATEST((0)::numeric, (((pa.valor - COALESCE(pa.receita_esperada, (0)::numeric)) - COALESCE(pa.tac_estimada, (0)::numeric)) - COALESCE(pa.seguro_estimado, (0)::numeric))) AS liquido_estimado,
    pa.faixa,
    pa.faixa_motivo,
    pa.estagio_funil,
    pa.estagio_alterado_em,
    pa.perda_motivo,
    pa.vendedor_id,
    pa.vendedor_origem,
    true AS operavel,
    ((
        CASE
            WHEN (pa.expira_em IS NULL) THEN ('origem '::text || pa.origin)
            WHEN (pa.expira_em < now()) THEN ('expirou em '::text || to_char(pa.expira_em, 'DD/MM'::text))
            ELSE (('expira em '::text || (GREATEST(0, ((pa.expira_em)::date - CURRENT_DATE)))::text) || ' dias'::text)
        END || ' · '::text) || pa.origin) AS linha_contexto,
    pa.id_externo AS pre_autorizacao_id,
    pa.status AS pre_autorizacao_status,
    pa.criada_em AS pre_autorizacao_em,
    pa.anticipation_id_externo AS conversao_antecipacao_id,
    false AS conversao_em_disputa,
    (pa.limite_disponivel_sacado >= pa.valor) AS sacado_limite_cobre_nota,
    ((fco.last_anticipation IS NOT NULL) OR (fe.ultima_antecipacao IS NOT NULL)) AS fornecedor_ja_antecipou,
    (fco.cnpj IS NOT NULL) AS fornecedor_e_cliente_onepay,
    fpa.valor_total AS fornecedor_protesto_valor,
    (fu.capital_social)::numeric(16,2) AS fornecedor_capital_social,
    fu.situacao_cadastral AS fornecedor_situacao_cadastral,
    NULL::bigint AS fornecedor_ultimo_numero_nf,
    natureza_juridica_codigo(fu.natureza_juridica) AS fornecedor_natureza_juridica,
    COALESCE(se.uf, su.uf) AS sacado_uf,
    NULL::text AS direction,
    NULL::text AS tipo_nf,
    NULL::text AS vencimento_origem,
    NULL::text AS natureza_operacao,
    NULL::text AS numero,
    NULL::text AS serie,
    NULL::timestamp with time zone AS emitida_em,
    NULL::text AS nao_operavel_motivo,
    fpa.consultado_em AS fornecedor_protesto_em,
    NULL::numeric AS conversao_valor,
    NULL::numeric AS conversao_taxa,
    pa.sienge_bill_origin AS bill_origin,
    pa.sienge_bill_document_type AS bill_document_type
   FROM ((((((((pre_autorizacoes pa
     LEFT JOIN empresas fe ON ((fe.id = pa.fornecedor_empresa_id)))
     LEFT JOIN empresas se ON ((se.id = pa.sacado_empresa_id)))
     LEFT JOIN LATERAL app__cadastro_do_cnpj(pa.fornecedor_cnpj) fu(cnpj, razao_social, nome_fantasia, uf, municipio, capital_social, situacao_cadastral, natureza_juridica, cnae_principal, cnae_grupos, camada) ON (true))
     LEFT JOIN LATERAL app__cadastro_do_cnpj(pa.sacado_cnpj) su(cnpj, razao_social, nome_fantasia, uf, municipio, capital_social, situacao_cadastral, natureza_juridica, cnae_principal, cnae_grupos, camada) ON (true))
     LEFT JOIN protestos_atual fpa ON ((fpa.cnpj = pa.fornecedor_cnpj)))
     LEFT JOIN clientes_onepay fco ON ((fco.cnpj = pa.fornecedor_cnpj)))
     LEFT JOIN supressao fsup ON (((fsup.escopo = 'empresa'::text) AND (fsup.valor = pa.fornecedor_cnpj) AND ((fsup.expira_em IS NULL) OR (fsup.expira_em >= CURRENT_DATE)))))
     LEFT JOIN antecipacao_fornecedor_sem_interesse fsi ON ((fsi.cnpj = pa.fornecedor_cnpj)))
  WHERE (pa.origem_exibida AND (NOT (EXISTS ( SELECT 1
           FROM funil_ocultacoes o
          WHERE ((o.tipo = 'pre_autorizacao'::text) AND (o.referencia_id = (pa.id_externo)::text)))))
    AND ((pa.vencimento IS NULL) OR (pa.vencimento <= (CURRENT_DATE + 180))
         OR ((COALESCE(pa.origin, ''::text) <> 'sienge'::text) AND (pa.sienge_bill_document_type IS NULL))));

alter view public.funil_oportunidades_preauth set (security_invoker = on);

-- ─── 2. O título ────────────────────────────────────────────────────────────

create or replace view public.funil_oportunidades_titulo as
 WITH parcelas_do_bill AS (
         SELECT sienge_titulos.connection_id,
            sienge_titulos.bill_id,
            (count(*))::integer AS total
           FROM sienge_titulos
          GROUP BY sienge_titulos.connection_id, sienge_titulos.bill_id
        )
 SELECT 'titulo'::text AS tipo,
    (st.id_externo)::text AS id,
    COALESCE(st.bill_access_key, st.nfe_candidate_access_key) AS access_key,
    st.credor_cnpj AS fornecedor_cnpj,
    COALESCE(st.credor_nome, ce.razao_social, cu.razao_social, cu.nome_fantasia,
        CASE
            WHEN st.credor_pessoa_fisica THEN 'Credor PF'::text
            ELSE 'Sem cadastro'::text
        END) AS fornecedor_nome,
    st.credor_empresa_id AS fornecedor_empresa_id,
    COALESCE(st.credor_cadastrado, false) AS fornecedor_cadastrado,
        CASE
            WHEN st.credor_pessoa_fisica THEN NULL::text
            WHEN (NOT COALESCE(st.credor_cadastrado, false)) THEN 'aquisicao'::text
            WHEN ((cco.last_anticipation IS NOT NULL) OR (ce.ultima_antecipacao IS NOT NULL)) THEN 'recorrencia'::text
            ELSE 'ativacao'::text
        END AS fornecedor_tipagem,
    COALESCE(cpa.tem_protesto, false) AS fornecedor_tem_protesto,
    (csup.valor IS NOT NULL) AS fornecedor_suprimido,
    (csi.cnpj IS NOT NULL) AS fornecedor_sem_interesse,
    COALESCE(ce.uf, cu.uf) AS fornecedor_uf,
    st.credor_pessoa_fisica,
    st.sacado_cnpj,
    st.sacado_nome,
    st.sacado_matriz_cnpj,
    st.sacado_empresa_id,
    (sse.id IS NOT NULL) AS sacado_cadastrado,
    st.valor,
    st.vencimento,
    st.primeira_vez_visto AS data_base,
    (COALESCE(st.bill_document_number, (st.bill_id)::text) || COALESCE(((', parcela '::text || (st.installment_number)::text) || COALESCE(('/'::text || (pb.total)::text), ''::text)), ''::text)) AS numero_exibicao,
    st.situation AS estado_origem,
    NULL::timestamp with time zone AS relogio,
    (st.vencimento - CURRENT_DATE) AS dias_para_vencimento,
    st.credit_status AS sacado_credito_status,
    st.limite_disponivel_sacado AS sacado_limite_disponivel,
    (st.limite_disponivel_sacado >= st.valor) AS sacado_limite_cobre_valor,
    st.receita_esperada,
    st.taxa_usada,
    st.tac_estimada,
    st.seguro_estimado,
    GREATEST((0)::numeric, (((st.valor - COALESCE(st.receita_esperada, (0)::numeric)) - COALESCE(st.tac_estimada, (0)::numeric)) - COALESCE(st.seguro_estimado, (0)::numeric))) AS liquido_estimado,
    st.faixa,
    st.faixa_motivo,
    st.estagio_funil,
    st.estagio_alterado_em,
    st.perda_motivo,
    st.vendedor_id,
    st.vendedor_origem,
    true AS operavel,
    ((((COALESCE(st.bill_document_number, ('doc '::text || (st.bill_id)::text)) || COALESCE(((' · parcela '::text || (st.installment_number)::text) || COALESCE(('/'::text || (pb.total)::text), ''::text)), ''::text)) || ' · '::text) || st.situation) || COALESCE((' · '::text || st.guard_reason), ''::text)) AS linha_contexto,
    selo2.pre_autorizacao_id,
    selo2.status AS pre_autorizacao_status,
    selo2.criada_em AS pre_autorizacao_em,
    st.anticipation_id_externo AS conversao_antecipacao_id,
    false AS conversao_em_disputa,
    (st.limite_disponivel_sacado >= st.valor) AS sacado_limite_cobre_nota,
    ((cco.last_anticipation IS NOT NULL) OR (ce.ultima_antecipacao IS NOT NULL)) AS fornecedor_ja_antecipou,
    (cco.cnpj IS NOT NULL) AS fornecedor_e_cliente_onepay,
    cpa.valor_total AS fornecedor_protesto_valor,
    (cu.capital_social)::numeric(16,2) AS fornecedor_capital_social,
    cu.situacao_cadastral AS fornecedor_situacao_cadastral,
    NULL::bigint AS fornecedor_ultimo_numero_nf,
    natureza_juridica_codigo(cu.natureza_juridica) AS fornecedor_natureza_juridica,
    COALESCE(sse.uf, ssu.uf) AS sacado_uf,
    NULL::text AS direction,
    NULL::text AS tipo_nf,
    NULL::text AS vencimento_origem,
    NULL::text AS natureza_operacao,
    NULL::text AS numero,
    NULL::text AS serie,
    NULL::timestamp with time zone AS emitida_em,
    NULL::text AS nao_operavel_motivo,
    cpa.consultado_em AS fornecedor_protesto_em,
    NULL::numeric AS conversao_valor,
    NULL::numeric AS conversao_taxa,
    st.bill_origin,
    st.bill_document_type
   FROM ((((((((((sienge_titulos st
     LEFT JOIN parcelas_do_bill pb ON (((pb.bill_id = st.bill_id) AND (NOT (pb.connection_id IS DISTINCT FROM st.connection_id)))))
     LEFT JOIN empresas ce ON ((ce.id = st.credor_empresa_id)))
     LEFT JOIN empresas sse ON ((sse.id = st.sacado_empresa_id)))
     LEFT JOIN LATERAL app__cadastro_do_cnpj(st.credor_cnpj) cu(cnpj, razao_social, nome_fantasia, uf, municipio, capital_social, situacao_cadastral, natureza_juridica, cnae_principal, cnae_grupos, camada) ON (true))
     LEFT JOIN LATERAL app__cadastro_do_cnpj(st.sacado_cnpj) ssu(cnpj, razao_social, nome_fantasia, uf, municipio, capital_social, situacao_cadastral, natureza_juridica, cnae_principal, cnae_grupos, camada) ON (true))
     LEFT JOIN protestos_atual cpa ON ((cpa.cnpj = st.credor_cnpj)))
     LEFT JOIN clientes_onepay cco ON ((cco.cnpj = st.credor_cnpj)))
     LEFT JOIN supressao csup ON (((csup.escopo = 'empresa'::text) AND (csup.valor = st.credor_cnpj) AND ((csup.expira_em IS NULL) OR (csup.expira_em >= CURRENT_DATE)))))
     LEFT JOIN antecipacao_fornecedor_sem_interesse csi ON ((csi.cnpj = st.credor_cnpj)))
     LEFT JOIN funil_selos_preauth selo2 ON (((selo2.tipo = 'titulo'::text) AND (selo2.referencia_id = (st.id_externo)::text))))
  WHERE (st.origem_exibida AND (NOT (EXISTS ( SELECT 1
           FROM funil_ocultacoes o
          WHERE ((o.tipo = 'titulo'::text) AND (o.referencia_id = (st.id_externo)::text)))))
    AND ((st.vencimento IS NULL) OR (st.vencimento <= (CURRENT_DATE + 180))));

alter view public.funil_oportunidades_titulo set (security_invoker = on);

-- ─── 3. O report de documentos sem dono usa o recorte da tela ───────────────
-- "Sem dono" é o que o filtro do Kanban mostra (0294); o que não é exibido sai da
-- fila. Na carteira de cada originador ele ganha status próprio, `prazo_longo`, em
-- vez de sumir da conta ou se passar por "substituído".

create or replace function public.app_report_documentos()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  r jsonb;
  v_hold jsonb;
begin
  if not public.app_report_gestor() then
    raise exception 'O report de documentos sem dono é leitura de gestor.' using errcode = '42501';
  end if;

  /*
   * A holding de cada sacado sem dono, num MAPA cnpj -> empresa, antes da consulta.
   *
   * Já foi uma CTE juntada à lista de documentos, e custou 18,5 s: o planejador estima
   * em uma linha o filtro sobre a CTE de documentos e escolhe laço aninhado contra outra
   * CTE sem índice — 13 mil x 7 mil comparações. Com o mapa, a consulta principal só faz
   * busca por chave em tabela indexada, e o erro de estimativa deixa de importar.
   */
  select coalesce(jsonb_object_agg(s.cnpj, s.hold_id) filter (where s.hold_id is not null), '{}'::jsonb)
    into v_hold
    from (
      select c.cnpj, public.app_holding_do_sacado(c.cnpj) as hold_id from (
        select nf.sacado_cnpj as cnpj from public.notas_fiscais nf
         where nf.vendedor_id is null and nf.situacao = 'valida'
           and coalesce(nf.operavel_manual, nf.operavel)
           and nf.estagio_funil in ('a_prospectar', 'em_prospeccao', 'em_negociacao', 'antecipacao_andamento')
        union
        select pa.sacado_cnpj from public.pre_autorizacoes pa
         where pa.vendedor_id is null and pa.origem_exibida
           and pa.estagio_funil in ('a_prospectar', 'em_prospeccao', 'em_negociacao', 'antecipacao_andamento')
        union
        select st.sacado_cnpj from public.sienge_titulos st
         where st.vendedor_id is null and st.origem_exibida
           and st.estagio_funil in ('a_prospectar', 'em_prospeccao', 'em_negociacao', 'antecipacao_andamento')
      ) c where c.cnpj is not null
    ) s;

  with docs as materialized (
    select 'nf'::text as tipo, nf.sacado_cnpj, nf.sacado_nome, nf.sacado_empresa_id,
           nf.fornecedor_cnpj, nf.fornecedor_nome, nf.fornecedor_empresa_id,
           nf.valor, nf.receita_esperada, nf.faixa, nf.vencimento, nf.credit_status,
           nf.estagio_funil, nf.vendedor_id,
           (nf.situacao = 'valida' and coalesce(nf.operavel_manual, nf.operavel)) as operavel,
           exists (select 1 from public.funil_ocultacoes o
                    where o.tipo = 'nf' and o.referencia_id = nf.access_key) as oculto,
           false as prazo_longo
      from public.notas_fiscais nf
     where nf.vendedor_id is not null
        or nf.estagio_funil in ('a_prospectar', 'em_prospeccao', 'em_negociacao', 'antecipacao_andamento')
    union all
    select 'pre_autorizacao', pa.sacado_cnpj, pa.sacado_nome, pa.sacado_empresa_id,
           pa.fornecedor_cnpj, pa.fornecedor_nome, pa.fornecedor_empresa_id,
           pa.valor, pa.receita_esperada, pa.faixa, pa.vencimento, pa.credit_status,
           pa.estagio_funil, pa.vendedor_id,
           true,
           (not pa.origem_exibida) or exists (select 1 from public.funil_ocultacoes o
                    where o.tipo = 'pre_autorizacao' and o.referencia_id = pa.id_externo::text),
           coalesce(pa.vencimento > current_date + 180
                    and (pa.origin = 'sienge' or pa.sienge_bill_document_type is not null), false)
      from public.pre_autorizacoes pa
     where pa.vendedor_id is not null
        or pa.estagio_funil in ('a_prospectar', 'em_prospeccao', 'em_negociacao', 'antecipacao_andamento')
    union all
    select 'titulo', st.sacado_cnpj, st.sacado_nome, st.sacado_empresa_id,
           st.credor_cnpj, st.credor_nome, st.credor_empresa_id,
           st.valor, st.receita_esperada, st.faixa, st.vencimento, st.credit_status,
           st.estagio_funil, st.vendedor_id,
           true,
           (not st.origem_exibida) or exists (select 1 from public.funil_ocultacoes o
                    where o.tipo = 'titulo' and o.referencia_id = st.id_externo::text),
           coalesce(st.vencimento > current_date + 180, false)
      from public.sienge_titulos st
     where st.vendedor_id is not null
        or st.estagio_funil in ('a_prospectar', 'em_prospeccao', 'em_negociacao', 'antecipacao_andamento')
  ),

  -- ── A carteira explícita de cada originador, como o roteamento a lê ──────────
  orig as materialized (
    select v.id as vendedor_id, e.id::uuid as empresa_id
      from public.vendedores v,
           lateral jsonb_array_elements_text(coalesce(v.settings -> 'empresas_escolhidas', '[]'::jsonb)) e(id)
     where v.tipo = 'originador' and v.ativo
  ),
  grupos as materialized (
    select distinct em.grupo_id
      from orig o join public.empresas em on em.id = o.empresa_id
     where em.grupo_id is not null
  ),

  sem_dono as materialized (
    select d.* from docs d
     where d.vendedor_id is null and d.operavel and not d.oculto and not d.prazo_longo
       and d.estagio_funil in ('a_prospectar', 'em_prospeccao', 'em_negociacao', 'antecipacao_andamento')
  ),
  sd as materialized (
    select d.*,
           left(d.sacado_cnpj, 8) as sacado_raiz,
           left(d.fornecedor_cnpj, 8) as fornecedor_raiz,
           se.razao_social as sacado_razao, se.estagio as sacado_estagio,
           fe.razao_social as fornecedor_razao, fe.estagio as fornecedor_estagio,
           hold.id as hold_id, hold.razao_social as hold_nome, hold.cnpj as hold_cnpj,
           hold.estagio as hold_estagio, hold.gestao_operacao as hold_gestao,
           case
             when hold.gestao_operacao = 'passivo' then 'passivo'
             when exists (select 1 from orig o
                           where o.empresa_id in (d.sacado_empresa_id, d.fornecedor_empresa_id))
               or exists (select 1 from public.mercado_universo mu
                           where mu.cnpj in (d.sacado_cnpj, d.fornecedor_cnpj) and mu.is_spe
                             and mu.grupo_id in (select g.grupo_id from grupos g))
               then 'em_carteira'
             when d.sacado_empresa_id is null then 'sacado_sem_cadastro'
             else 'fora_de_carteira'
           end as motivo
      from sem_dono d
      left join public.empresas hold on hold.id = (v_hold ->> d.sacado_cnpj)::uuid
      left join public.empresas se on se.id = d.sacado_empresa_id
      left join public.empresas fe on fe.id = d.fornecedor_empresa_id
  ),
  tot as (select coalesce(sum(valor), 0) as valor from sd),

  j_totais as (
    select jsonb_build_object(
      'docs', count(*), 'valor', coalesce(sum(valor), 0),
      'receita', coalesce(sum(receita_esperada), 0),
      'sacados', count(distinct sacado_raiz), 'cedentes', count(distinct fornecedor_raiz),
      'docs_nf', count(*) filter (where tipo = 'nf'),
      'valor_nf', coalesce(sum(valor) filter (where tipo = 'nf'), 0),
      'docs_pa', count(*) filter (where tipo = 'pre_autorizacao'),
      'valor_pa', coalesce(sum(valor) filter (where tipo = 'pre_autorizacao'), 0),
      'docs_ti', count(*) filter (where tipo = 'titulo'),
      'valor_ti', coalesce(sum(valor) filter (where tipo = 'titulo'), 0)) as j
    from sd
  ),

  j_motivos as (
    select coalesce(jsonb_agg(x.j order by x.valor desc), '[]'::jsonb) as j from (
      select sum(valor) as valor, jsonb_build_object(
        'motivo', motivo, 'docs', count(*), 'valor', coalesce(sum(valor), 0),
        'sacados', count(distinct sacado_raiz), 'cedentes', count(distinct fornecedor_raiz),
        'docs_nf', count(*) filter (where tipo = 'nf'),
        'valor_nf', coalesce(sum(valor) filter (where tipo = 'nf'), 0),
        'docs_pa', count(*) filter (where tipo = 'pre_autorizacao'),
        'valor_pa', coalesce(sum(valor) filter (where tipo = 'pre_autorizacao'), 0),
        'docs_ti', count(*) filter (where tipo = 'titulo'),
        'valor_ti', coalesce(sum(valor) filter (where tipo = 'titulo'), 0)) as j
      from sd group by motivo) x
  ),

  j_sacados as (
    select coalesce(jsonb_agg(x.j order by x.valor desc), '[]'::jsonb) as j from (
      select sum(valor) as valor, jsonb_build_object(
        'raiz', sacado_raiz,
        'nome', mode() within group (order by coalesce(sacado_razao, sacado_nome)),
        'empresa_id', (array_agg(sacado_empresa_id) filter (where sacado_empresa_id is not null))[1],
        'cnpjs', count(distinct sacado_cnpj),
        'docs', count(*), 'valor', coalesce(sum(valor), 0),
        'pct', round(100 * sum(valor) / nullif((select valor from tot), 0), 1),
        'receita', coalesce(sum(receita_esperada), 0),
        'contrapartes', count(distinct fornecedor_raiz),
        'vence_30d', coalesce(sum(valor) filter (where vencimento between current_date and current_date + 30), 0),
        'alta_boa', count(*) filter (where faixa in ('alta', 'boa')),
        'estagio', mode() within group (order by sacado_estagio),
        'cadastrado', bool_or(sacado_empresa_id is not null),
        'gestao', mode() within group (order by hold_gestao),
        'credito', mode() within group (order by credit_status),
        'motivo', mode() within group (order by motivo),
        'docs_nf', count(*) filter (where tipo = 'nf'),
        'docs_pa', count(*) filter (where tipo = 'pre_autorizacao'),
        'docs_ti', count(*) filter (where tipo = 'titulo')) as j
      from sd where sacado_raiz is not null
      group by sacado_raiz order by sum(valor) desc limit 30) x
  ),

  maior_sacado as (
    select distinct on (fornecedor_raiz) fornecedor_raiz, nome, valor from (
      select fornecedor_raiz, mode() within group (order by coalesce(sacado_razao, sacado_nome)) as nome,
             sum(valor) as valor
        from sd where fornecedor_raiz is not null group by fornecedor_raiz, sacado_raiz) t
    order by fornecedor_raiz, valor desc
  ),
  j_cedentes as (
    select coalesce(jsonb_agg(x.j order by x.valor desc), '[]'::jsonb) as j from (
      select c.valor, c.j || jsonb_build_object(
               'maior_sacado', ms.nome, 'maior_sacado_valor', ms.valor,
               'sem_interesse', exists (select 1 from public.antecipacao_fornecedor_sem_interesse si
                                         where left(si.cnpj, 8) = c.raiz),
               'cliente_onepay', exists (select 1 from public.clientes_onepay co
                                          where left(co.cnpj, 8) = c.raiz),
               'protesto', exists (select 1 from public.protestos_atual pr
                                    where left(pr.cnpj, 8) = c.raiz and pr.tem_protesto)) as j
      from (
        select fornecedor_raiz as raiz, sum(valor) as valor, jsonb_build_object(
          'raiz', fornecedor_raiz,
          'nome', mode() within group (order by coalesce(fornecedor_razao, fornecedor_nome)),
          'empresa_id', (array_agg(fornecedor_empresa_id) filter (where fornecedor_empresa_id is not null))[1],
          'cnpjs', count(distinct fornecedor_cnpj),
          'docs', count(*), 'valor', coalesce(sum(valor), 0),
          'pct', round(100 * sum(valor) / nullif((select valor from tot), 0), 1),
          'receita', coalesce(sum(receita_esperada), 0),
          'contrapartes', count(distinct sacado_raiz),
          'vence_30d', coalesce(sum(valor) filter (where vencimento between current_date and current_date + 30), 0),
          'alta_boa', count(*) filter (where faixa in ('alta', 'boa')),
          'estagio', mode() within group (order by fornecedor_estagio),
          'cadastrado', bool_or(fornecedor_empresa_id is not null),
          'motivo', mode() within group (order by motivo),
          'docs_nf', count(*) filter (where tipo = 'nf'),
          'docs_pa', count(*) filter (where tipo = 'pre_autorizacao'),
          'docs_ti', count(*) filter (where tipo = 'titulo')) as j
        from sd where fornecedor_raiz is not null
        group by fornecedor_raiz order by sum(valor) desc limit 30) c
      left join maior_sacado ms on ms.fornecedor_raiz = c.raiz) x
  ),

  -- ── Contas que dá para atribuir: a holding já é cliente, ex-cliente, tem gestão
  --    definida ou crédito aprovado. É onde UMA decisão de carteira esvazia a fila. ──
  j_contas as (
    select coalesce(jsonb_agg(x.j order by x.valor desc), '[]'::jsonb) as j from (
      select sum(valor) as valor, jsonb_build_object(
        'empresa_id', hold_id, 'nome', hold_nome, 'cnpj', hold_cnpj,
        'estagio', hold_estagio, 'gestao', hold_gestao,
        'cnpjs', count(distinct sacado_cnpj),
        'docs', count(*), 'valor', coalesce(sum(valor), 0),
        'receita', coalesce(sum(receita_esperada), 0),
        'cedentes', count(distinct fornecedor_raiz),
        'alta_boa', count(*) filter (where faixa in ('alta', 'boa')),
        'credito', mode() within group (order by credit_status),
        'docs_nf', count(*) filter (where tipo = 'nf'),
        'docs_pa', count(*) filter (where tipo = 'pre_autorizacao'),
        'docs_ti', count(*) filter (where tipo = 'titulo'),
        'carteira', (select string_agg(distinct v.nome, ', ')
                       from public.vendedor_carteira vc
                       join public.vendedores v on v.id = vc.vendedor_id
                      where vc.empresa_id = hold_id and vc.ate is null)) as j
      from sd
      where hold_id is not null
        and (hold_estagio in ('cliente', 'ex_cliente') or hold_gestao is not null
             or credit_status = 'APPROVED')
      group by hold_id, hold_nome, hold_cnpj, hold_estagio, hold_gestao
      order by sum(valor) desc limit 40) x
  ),

  -- ── Onde estão os documentos de cada originador ──────────────────────────────
  --    Vivos: a ordem do `case` é a ordem em que a tela descarta — nota não operável
  --    nunca entra no Kanban; card substituído some atrás do original; título com
  --    vencimento além de 180 dias não é exibido (0295); sem interesse
  --    e supressão saem do filtro padrão. Encerrados contam só o que é exibível, para
  --    a mesma operação não aparecer duas vezes (o título e a pré-autorização dele).
  com_dono as materialized (
    select d.vendedor_id, d.tipo, d.valor, si.motivo as si_motivo, d.fornecedor_cnpj,
           case
             when d.estagio_funil not in ('a_prospectar', 'em_prospeccao', 'em_negociacao', 'antecipacao_andamento')
               then d.estagio_funil
             when not d.operavel then 'nao_operavel'
             when d.oculto then 'substituido'
             when d.prazo_longo then 'prazo_longo'
             when si.cnpj is not null then 'sem_interesse'
             when exists (select 1 from public.supressao s
                           where s.escopo = 'empresa' and s.valor = d.fornecedor_cnpj
                             and (s.expira_em is null or s.expira_em >= current_date)) then 'suprimido'
             else 'no_funil'
           end as status
      from docs d
      left join public.antecipacao_fornecedor_sem_interesse si on si.cnpj = d.fornecedor_cnpj
     where d.vendedor_id is not null
       and (not d.oculto
            or d.estagio_funil in ('a_prospectar', 'em_prospeccao', 'em_negociacao', 'antecipacao_andamento'))
  ),
  o_status as (
    select vendedor_id, jsonb_agg(j order by valor desc) as j from (
      select vendedor_id, sum(valor) as valor, jsonb_build_object(
        'status', status, 'docs', count(*), 'valor', coalesce(sum(valor), 0),
        'docs_nf', count(*) filter (where tipo = 'nf'),
        'valor_nf', coalesce(sum(valor) filter (where tipo = 'nf'), 0),
        'docs_pa', count(*) filter (where tipo = 'pre_autorizacao'),
        'valor_pa', coalesce(sum(valor) filter (where tipo = 'pre_autorizacao'), 0),
        'docs_ti', count(*) filter (where tipo = 'titulo'),
        'valor_ti', coalesce(sum(valor) filter (where tipo = 'titulo'), 0)) as j
      from com_dono group by vendedor_id, status) t
    group by vendedor_id
  ),
  o_motivos as (
    select vendedor_id, jsonb_agg(j order by valor desc) as j from (
      select vendedor_id, sum(valor) as valor, jsonb_build_object(
        'motivo', coalesce(si_motivo, 'outro'), 'fornecedores', count(distinct fornecedor_cnpj),
        'docs', count(*), 'valor', coalesce(sum(valor), 0)) as j
      from com_dono where status = 'sem_interesse'
      group by vendedor_id, coalesce(si_motivo, 'outro')) t
    group by vendedor_id
  ),
  j_originadores as (
    select coalesce(jsonb_agg(x.j order by x.vivos desc), '[]'::jsonb) as j from (
      select (select count(*) from com_dono c
               where c.vendedor_id = s.vendedor_id
                 and c.status in ('no_funil', 'sem_interesse', 'suprimido', 'substituido', 'prazo_longo', 'nao_operavel')) as vivos,
             jsonb_build_object(
               'vendedor_id', s.vendedor_id, 'nome', coalesce(v.nome, 'Vendedor removido'),
               'tipo', v.tipo, 'ativo', coalesce(v.ativo, false),
               'status', s.j, 'sem_interesse_motivos', coalesce(m.j, '[]'::jsonb)) as j
        from o_status s
        left join public.vendedores v on v.id = s.vendedor_id
        left join o_motivos m on m.vendedor_id = s.vendedor_id) x
  )

  select jsonb_build_object(
    'gerado_em', now(),
    'totais', (select j from j_totais),
    'motivos', (select j from j_motivos),
    'sacados', (select j from j_sacados),
    'cedentes', (select j from j_cedentes),
    'contas', (select j from j_contas),
    'originadores', (select j from j_originadores))
    into r;

  return r;
end
$function$;

revoke all on function public.app_report_documentos() from public, anon;
grant execute on function public.app_report_documentos() to authenticated, service_role;
