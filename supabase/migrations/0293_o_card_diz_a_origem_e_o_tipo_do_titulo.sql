/*
 * O card do funil diz de onde o título veio no ERP e que documento ele é.
 *
 * O Sienge marca cada título com uma ORIGEM (`bill.origin`: ME, AC, CP, SE…) e um
 * TIPO DE DOCUMENTO (`bill.documentType`: PCT, NFE, NFSE, NF, FAT…). O originador usa
 * os dois para saber que conversa ter: parcela de contrato medida não é nota de
 * material, e quem cuida de cada uma do lado da construtora é outra pessoa.
 * `sienge_titulos` guarda os dois desde a 0233; eles só nunca chegavam ao card.
 *
 * ── O TÍTULO: direto da tabela ──────────────────────────────────────────────
 * `bill_origin` e `bill_document_type` já são colunas de `sienge_titulos`.
 *
 * ── A PRÉ-AUTORIZAÇÃO: COPIADA, NÃO JUNTADA ─────────────────────────────────
 * Em 09/10/2026, as 981 pré-autorizações de origem `sienge` casam com exatamente um
 * título por `sienge_titulos.pre_autorizacao_id_externo`. Juntar na view seria o
 * caminho curto, e é o errado por dois motivos:
 *   1. A view é `security_invoker`, então o join passaria pela RLS de
 *      `sienge_titulos` — e a oferta revela a SPE enquanto o título fica na matriz.
 *      Quem enxerga a oferta pela carteira da SPE veria os dois campos vazios, sem
 *      erro nenhum.
 *   2. Política com subquery encarece o PLANEJAMENTO mesmo quando o ramo não roda,
 *      e o funil já pagou caro por isso.
 * Por isso os dois campos são copiados para `pre_autorizacoes` por gatilho, nos dois
 * sentidos — porque o worker sincroniza as duas fontes em ordens que não garantimos.
 *
 * ── A NF ───────────────────────────────────────────────────────────────────
 * Não tem os campos: entra com NULL, e o card não mostra o chip.
 *
 * Toda view recriada aqui reafirma `security_invoker` logo abaixo (0099, 0225).
 */

-- ─── 1. Os dois campos na pré-autorização ──────────────────────────────────

alter table public.pre_autorizacoes
  add column if not exists sienge_bill_origin text,
  add column if not exists sienge_bill_document_type text;

comment on column public.pre_autorizacoes.sienge_bill_origin is
  'Origem do título no Sienge (bill.origin), copiada de sienge_titulos por gatilho. NULL fora da origem sienge.';
comment on column public.pre_autorizacoes.sienge_bill_document_type is
  'Tipo de documento do título no Sienge (bill.documentType), copiado de sienge_titulos por gatilho.';

-- A oferta chega depois do título: busca o que o título já sabe.
-- SECURITY DEFINER porque quem dispara pode ser um usuário movendo o card, e a RLS
-- de `sienge_titulos` não pode decidir o que se grava.
create or replace function public.pre_autorizacoes_documento_sienge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_origem text;
  v_tipo   text;
begin
  select st.bill_origin, st.bill_document_type
    into v_origem, v_tipo
    from public.sienge_titulos st
   where st.pre_autorizacao_id_externo = new.id_externo
   limit 1;

  if found then
    new.sienge_bill_origin := v_origem;
    new.sienge_bill_document_type := v_tipo;
  end if;
  return new;
end;
$$;

drop trigger if exists pre_autorizacoes_documento_sienge on public.pre_autorizacoes;
create trigger pre_autorizacoes_documento_sienge
  before insert or update on public.pre_autorizacoes
  for each row
  when (new.origin = 'sienge' and new.sienge_bill_origin is null and new.sienge_bill_document_type is null)
  execute function public.pre_autorizacoes_documento_sienge();

-- O título chega depois da oferta (ou muda): empurra para ela.
create or replace function public.sienge_titulos_documento_para_preauth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.pre_autorizacoes pa
     set sienge_bill_origin = new.bill_origin,
         sienge_bill_document_type = new.bill_document_type
   where pa.id_externo = new.pre_autorizacao_id_externo
     and (pa.sienge_bill_origin, pa.sienge_bill_document_type)
         is distinct from (new.bill_origin, new.bill_document_type);
  return null;
end;
$$;

drop trigger if exists sienge_titulos_documento_para_preauth on public.sienge_titulos;
create trigger sienge_titulos_documento_para_preauth
  after insert or update of bill_origin, bill_document_type, pre_autorizacao_id_externo
  on public.sienge_titulos
  for each row
  when (new.pre_autorizacao_id_externo is not null)
  execute function public.sienge_titulos_documento_para_preauth();

-- Função de gatilho não é endpoint (0222i).
revoke all on function public.pre_autorizacoes_documento_sienge() from public, anon, authenticated;
revoke all on function public.sienge_titulos_documento_para_preauth() from public, anon, authenticated;

-- O que já existe.
update public.pre_autorizacoes pa
   set sienge_bill_origin = st.bill_origin,
       sienge_bill_document_type = st.bill_document_type
  from public.sienge_titulos st
 where st.pre_autorizacao_id_externo = pa.id_externo
   and (pa.sienge_bill_origin, pa.sienge_bill_document_type)
       is distinct from (st.bill_origin, st.bill_document_type);

-- ─── 2. As views por fonte: duas colunas novas, sempre no FIM ───────────────

create or replace view public.funil_oportunidades_nf as
 SELECT 'nf'::text AS tipo,
    nf.access_key AS id,
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
    false AS credor_pessoa_fisica,
    nf.sacado_cnpj,
    nf.sacado_nome,
    app__matriz_do_cnpj(nf.sacado_cnpj) AS sacado_matriz_cnpj,
    nf.sacado_empresa_id,
    nf.sacado_cadastrado,
    nf.valor,
    nf.vencimento,
    nf.emitida_em AS data_base,
    (nf.numero || COALESCE(('/'::text || nf.serie), ''::text)) AS numero_exibicao,
    nf.status_sync AS estado_origem,
    NULL::timestamp with time zone AS relogio,
    nf.dias_para_vencimento,
    nf.sacado_credito_status,
    nf.sacado_limite_disponivel,
    nf.sacado_limite_cobre_nota AS sacado_limite_cobre_valor,
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
    (('nº '::text || COALESCE(nf.numero, '—'::text)) || COALESCE(('/'::text || nf.serie), ''::text)) AS linha_contexto,
    selo.pre_autorizacao_id,
    selo.status AS pre_autorizacao_status,
    selo.criada_em AS pre_autorizacao_em,
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
    nf.conversao_taxa,
    NULL::text AS bill_origin,
    NULL::text AS bill_document_type
   FROM (notas_funil nf
     LEFT JOIN funil_selos_preauth selo ON (((selo.tipo = 'nf'::text) AND (selo.referencia_id = nf.access_key))))
  WHERE (NOT (EXISTS ( SELECT 1
           FROM funil_ocultacoes o
          WHERE ((o.tipo = 'nf'::text) AND (o.referencia_id = nf.access_key)))));

alter view public.funil_oportunidades_nf set (security_invoker = on);

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
          WHERE ((o.tipo = 'pre_autorizacao'::text) AND (o.referencia_id = (pa.id_externo)::text))))));

alter view public.funil_oportunidades_preauth set (security_invoker = on);

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
          WHERE ((o.tipo = 'titulo'::text) AND (o.referencia_id = (st.id_externo)::text))))));

alter view public.funil_oportunidades_titulo set (security_invoker = on);

-- ─── 3. A união acompanha ───────────────────────────────────────────────────
-- Mesma lista de colunas nas três pernas; listada por extenso para que uma coluna
-- nova numa fonte não desalinhe a união em silêncio.

create or replace view public.funil_oportunidades as
 SELECT tipo, id, access_key, fornecedor_cnpj, fornecedor_nome, fornecedor_empresa_id,
    fornecedor_cadastrado, fornecedor_tipagem, fornecedor_tem_protesto, fornecedor_suprimido,
    fornecedor_sem_interesse, fornecedor_uf, credor_pessoa_fisica, sacado_cnpj, sacado_nome,
    sacado_matriz_cnpj, sacado_empresa_id, sacado_cadastrado, valor, vencimento, data_base,
    numero_exibicao, estado_origem, relogio, dias_para_vencimento, sacado_credito_status,
    sacado_limite_disponivel, sacado_limite_cobre_valor, receita_esperada, taxa_usada,
    tac_estimada, seguro_estimado, liquido_estimado, faixa, faixa_motivo, estagio_funil,
    estagio_alterado_em, perda_motivo, vendedor_id, vendedor_origem, operavel, linha_contexto,
    pre_autorizacao_id, pre_autorizacao_status, pre_autorizacao_em, conversao_antecipacao_id,
    conversao_em_disputa, sacado_limite_cobre_nota, fornecedor_ja_antecipou,
    fornecedor_e_cliente_onepay, fornecedor_protesto_valor, fornecedor_capital_social,
    fornecedor_situacao_cadastral, fornecedor_ultimo_numero_nf, fornecedor_natureza_juridica,
    sacado_uf, direction, tipo_nf, vencimento_origem, natureza_operacao, numero, serie,
    emitida_em, nao_operavel_motivo, fornecedor_protesto_em, conversao_valor, conversao_taxa,
    bill_origin, bill_document_type
   FROM funil_oportunidades_nf
UNION ALL
 SELECT tipo, id, access_key, fornecedor_cnpj, fornecedor_nome, fornecedor_empresa_id,
    fornecedor_cadastrado, fornecedor_tipagem, fornecedor_tem_protesto, fornecedor_suprimido,
    fornecedor_sem_interesse, fornecedor_uf, credor_pessoa_fisica, sacado_cnpj, sacado_nome,
    sacado_matriz_cnpj, sacado_empresa_id, sacado_cadastrado, valor, vencimento, data_base,
    numero_exibicao, estado_origem, relogio, dias_para_vencimento, sacado_credito_status,
    sacado_limite_disponivel, sacado_limite_cobre_valor, receita_esperada, taxa_usada,
    tac_estimada, seguro_estimado, liquido_estimado, faixa, faixa_motivo, estagio_funil,
    estagio_alterado_em, perda_motivo, vendedor_id, vendedor_origem, operavel, linha_contexto,
    pre_autorizacao_id, pre_autorizacao_status, pre_autorizacao_em, conversao_antecipacao_id,
    conversao_em_disputa, sacado_limite_cobre_nota, fornecedor_ja_antecipou,
    fornecedor_e_cliente_onepay, fornecedor_protesto_valor, fornecedor_capital_social,
    fornecedor_situacao_cadastral, fornecedor_ultimo_numero_nf, fornecedor_natureza_juridica,
    sacado_uf, direction, tipo_nf, vencimento_origem, natureza_operacao, numero, serie,
    emitida_em, nao_operavel_motivo, fornecedor_protesto_em, conversao_valor, conversao_taxa,
    bill_origin, bill_document_type
   FROM funil_oportunidades_preauth
UNION ALL
 SELECT tipo, id, access_key, fornecedor_cnpj, fornecedor_nome, fornecedor_empresa_id,
    fornecedor_cadastrado, fornecedor_tipagem, fornecedor_tem_protesto, fornecedor_suprimido,
    fornecedor_sem_interesse, fornecedor_uf, credor_pessoa_fisica, sacado_cnpj, sacado_nome,
    sacado_matriz_cnpj, sacado_empresa_id, sacado_cadastrado, valor, vencimento, data_base,
    numero_exibicao, estado_origem, relogio, dias_para_vencimento, sacado_credito_status,
    sacado_limite_disponivel, sacado_limite_cobre_valor, receita_esperada, taxa_usada,
    tac_estimada, seguro_estimado, liquido_estimado, faixa, faixa_motivo, estagio_funil,
    estagio_alterado_em, perda_motivo, vendedor_id, vendedor_origem, operavel, linha_contexto,
    pre_autorizacao_id, pre_autorizacao_status, pre_autorizacao_em, conversao_antecipacao_id,
    conversao_em_disputa, sacado_limite_cobre_nota, fornecedor_ja_antecipou,
    fornecedor_e_cliente_onepay, fornecedor_protesto_valor, fornecedor_capital_social,
    fornecedor_situacao_cadastral, fornecedor_ultimo_numero_nf, fornecedor_natureza_juridica,
    sacado_uf, direction, tipo_nf, vencimento_origem, natureza_operacao, numero, serie,
    emitida_em, nao_operavel_motivo, fornecedor_protesto_em, conversao_valor, conversao_taxa,
    bill_origin, bill_document_type
   FROM funil_oportunidades_titulo;

alter view public.funil_oportunidades set (security_invoker = on);
