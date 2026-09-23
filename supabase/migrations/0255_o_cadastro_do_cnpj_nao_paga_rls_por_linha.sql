/*
 * O funil não abre, e a causa é a política de `mercado_universo` — outra vez.
 *
 * ── O SINTOMA ───────────────────────────────────────────────────────────────
 * Todas as colunas do Kanban voltam "erro ao carregar", menos "Antecipação em
 * andamento", que tem 11 cards. Nas DUAS telas: o funil de Antecipações e o funil
 * de NFs do Comercial. Sintoma clássico de custo por linha — o mesmo que a 0241
 * descreveu — e o timeout do papel `authenticated` é 8 s.
 *
 * ── A MEDIÇÃO (23/09/2026, primeira página de "A prospectar") ───────────────
 *     sem RLS (superusuário) ..........    107 ms
 *     com RLS, como está hoje .........  7.496 ms      ← 70× a consulta inteira
 *
 * O plano diz onde: `LEFT JOIN mercado_universo` — duas vezes, fornecedor e
 * sacado — vira Seq Scan de 906.486 linhas e Hash com spill para disco (8 batches,
 * temp written=3677), 6,5 s de um lado e 4,4 s do outro, para casar com 159 notas.
 *
 * ── POR QUE O PLANNER FAZ ISSO ──────────────────────────────────────────────
 * A política da 0253 é um `case` cujo ramo `else` tem dois `in (select ... union
 * all ...)`. Para quem tem `mercado` o `case` é `true` e os SubPlans aparecem como
 * "never executed" — a EXECUÇÃO do filtro é trivial. Mas o PLANEJAMENTO não é: o
 * ramo caro entra no custo estimado do scan (startup 37.154), e com isso o planner
 * nunca considera um Index Scan parametrizado pela PK. Ele varre a tabela toda.
 *
 * Não é o método de join: forçar nested loop piorou para 19.876 ms, porque sem
 * hash join os SubPlans da política deixam de ser hasheados uma vez e passam a ser
 * correlatos, por linha. A política é caro-por-construção, em qualquer plano.
 *
 * E não atinge só quem tem `mercado`. O perfil Comercial — 10 pessoas, e é o
 * "funil de NFs em comercial" do relato — não tem `mercado`, cai no `else`, e paga
 * o mesmo scan. As duas telas do relato, a mesma linha do plano.
 *
 * ── A CORREÇÃO É A DA 0241, E NÃO UMA IDEIA NOVA ────────────────────────────
 * `app__matriz_do_cnpj` já enfrentou exatamente isto e virou SECURITY DEFINER: uma
 * resolução por CNPJ, chamada uma vez por linha, não pode carregar a RLS de uma
 * tabela de 906 mil linhas nas costas. `app__cadastro_do_cnpj` é a mesma decisão
 * para os campos de cadastro, e as views passam a chamá-la por LATERAL.
 *
 *     join direto (hoje) ..... 6.446 ms
 *     função definer .........     9 ms      ← 718×, com a MESMA soma de verificação
 *
 * ── O QUE ISSO AMPLIA, DITO EM VOZ ALTA ─────────────────────────────────────
 * A função recebe um CNPJ que o chamador JÁ TEM na mão, de uma linha que ele pode
 * ver, e devolve razão social, UF, município, capital social, situação cadastral,
 * natureza jurídica, CNAE e camada — dado público da Receita. Antes, quem tinha
 * `antecipacao` e não `mercado` só via esses campos se o CNPJ caísse no recorte da
 * política; agora vê para qualquer CNPJ que esteja numa linha dele. É o mesmo
 * trade que a 0241 fez e documentou. O que NÃO muda: ninguém ganha o direito de
 * LISTAR `mercado_universo` — a política dela fica exatamente como a 0253 deixou,
 * e o Explorador continua sendo a tela de quem tem `mercado`.
 *
 * ── O QUE SE REPETE AQUI, DE PROPÓSITO ──────────────────────────────────────
 * As três definições abaixo são as do banco, palavra por palavra, com DUAS linhas
 * trocadas em cada: os dois `left join mercado_universo` viram `left join lateral`.
 * `security_invoker` é reafirmado em todas — a 0099 existe porque um
 * `create or replace view` sem ele já entregou a tabela inteira a qualquer logado.
 */

-- ── 0. A ficha da Receita de UM CNPJ ───────────────────────────────────────
--
-- `capital_social` sai como `numeric(16,2)`, e o typmod não é detalhe: sem ele o
-- `create or replace view` recusa com "cannot change data type of view column"
-- — a coluna da view herda o typmod da tabela, e a função tem de devolver o mesmo.

drop function if exists public.app__cadastro_do_cnpj(text);

create function public.app__cadastro_do_cnpj(p_cnpj text)
returns table (
  cnpj text,
  razao_social text,
  nome_fantasia text,
  uf text,
  municipio text,
  capital_social numeric(16,2),
  situacao_cadastral text,
  natureza_juridica text,
  cnae_principal text,
  cnae_grupos text[],
  camada text
)
language sql
stable
security definer
set search_path to ''
as $fn$
  select u.cnpj, u.razao_social, u.nome_fantasia, u.uf, u.municipio, u.capital_social,
         u.situacao_cadastral, u.natureza_juridica, u.cnae_principal, u.cnae_grupos, u.camada
    from public.mercado_universo u
   where u.cnpj = p_cnpj;
$fn$;

comment on function public.app__cadastro_do_cnpj(text) is
  'A ficha da Receita de UM CNPJ, por chave primária. SECURITY DEFINER pela mesma razão '
  'de app__matriz_do_cnpj (0241): é chamada UMA VEZ POR LINHA do funil, e como invoker '
  'cada chamada arrastava a política de mercado_universo — 906 mil linhas hasheadas duas '
  'vezes por consulta, 107 ms viravam 7.500 ms e as colunas do Kanban estouravam o '
  'timeout de 8 s. Recebe um CNPJ que o chamador JÁ TEM na linha que ele pode ver, e '
  'devolve dado público da Receita: não amplia o que ninguém enxerga.';

revoke execute on function public.app__cadastro_do_cnpj(text) from public, anon;
grant execute on function public.app__cadastro_do_cnpj(text) to authenticated, service_role;

-- ── 1. notas_funil ─────────────────────────────────────────────────────────

create or replace view public.notas_funil
with (security_invoker = on) as
 select nf.access_key,
    nf.nf_id_externo,
    nf.tipo as tipo_nf,
    nf.direction,
    nf.numero,
    nf.serie,
    nf.valor,
    nf.emitida_em,
    nf.vencimento,
    nf.vencimento_origem,
    nf.status_sync,
    nf.parcelas,
    nf.faixa,
    nf.faixa_regra_versao,
    nf.faixa_motivo,
    nf.faixa_alterada_em,
    nf.estagio_funil,
    nf.estagio_alterado_em,
    nf.perda_motivo,
    nf.receita_esperada,
    nf.taxa_usada,
    nf.sincronizada_em,
    nf.vencimento - CURRENT_DATE as dias_para_vencimento,
    nf.fornecedor_cnpj,
    nf.fornecedor_nome,
    COALESCE(nf.fornecedor_cadastrado, false) as fornecedor_cadastrado,
    nf.fornecedor_empresa_id,
    COALESCE(fe.uf, fu.uf) as fornecedor_uf,
    COALESCE(fpa.tem_protesto, false) as fornecedor_tem_protesto,
    fco.cnpj is not null as fornecedor_e_cliente_onepay,
    fco.last_anticipation is not null or fe.ultima_antecipacao is not null as fornecedor_ja_antecipou,
        case
            when not COALESCE(nf.fornecedor_cadastrado, false) then 'aquisicao'::text
            when fco.last_anticipation is not null or fe.ultima_antecipacao is not null then 'recorrencia'::text
            else 'ativacao'::text
        end as fornecedor_tipagem,
    fsup.valor is not null as fornecedor_suprimido,
    nf.sacado_cnpj,
    nf.sacado_nome,
    COALESCE(nf.sacado_cadastrado, false) as sacado_cadastrado,
    nf.sacado_empresa_id,
    nf.contato_sacado,
    COALESCE(se.uf, su.uf) as sacado_uf,
    nf.credit_status as sacado_credito_status,
    nf.credit_role as sacado_credito_role,
    nf.credit_limite as sacado_limite,
    nf.limite_disponivel_sacado as sacado_limite_disponivel,
    nf.limite_disponivel_sacado >= nf.valor as sacado_limite_cobre_nota,
    nf.contato_fornecedor,
    COALESCE(su.cnae_principal, se.cnae_principal) as sacado_cnae_principal,
    NULLIF(COALESCE(su.cnae_grupos, cnae_grupos_de(se.cnae_principal, NULL::text[])), '{}'::text[]) as sacado_cnae_grupos,
    COALESCE(NULLIF(COALESCE(su.cnae_grupos, cnae_grupos_de(se.cnae_principal, NULL::text[])), '{}'::text[]) && ARRAY['41'::text, '42'::text, '43'::text], false) as sacado_construcao,
    COALESCE(su.razao_social, se.razao_social) as sacado_razao_social,
    COALESCE(su.municipio, se.municipio) as sacado_municipio,
    -- O cast é obrigatório: `returns table` NÃO carrega o typmod, e a coluna da view
    -- é `numeric(16,2)`. Sem ele o `create or replace view` recusa.
    fu.capital_social::numeric(16,2) as fornecedor_capital_social,
    fu.situacao_cadastral as fornecedor_situacao_cadastral,
    fpa.valor_total as fornecedor_protesto_valor,
    fnf.ultimo_numero_nf as fornecedor_ultimo_numero_nf,
    nf.natureza_operacao,
    nf.situacao = 'valida'::text and COALESCE(nf.operavel_manual, nf.operavel) as operavel,
        case
            when nf.situacao = 'cancelada'::text then 'Nota cancelada'::text
            when nf.situacao = 'denegada'::text then 'Nota denegada'::text
            else nf.nao_operavel_motivo
        end as nao_operavel_motivo,
    su.camada as sacado_camada,
    fpa.consultado_em as fornecedor_protesto_em,
    nf.conversao_antecipacao_id,
    nf.conversao_em_disputa,
    ant.gross_value as conversao_valor,
    ant.monthly_interest_rate as conversao_taxa,
    ant.status as conversao_status,
    nf.vendedor_id,
    nf.vendedor_origem,
    se.gestao_operacao as sacado_gestao_operacao,
    fsi.cnpj is not null as fornecedor_sem_interesse,
    natureza_juridica_codigo(fu.natureza_juridica) as fornecedor_natureza_juridica,
    nf.tac_estimada,
    nf.seguro_estimado,
    GREATEST(0::numeric, nf.valor - COALESCE(nf.receita_esperada, 0::numeric) - COALESCE(nf.tac_estimada, 0::numeric) - COALESCE(nf.seguro_estimado, 0::numeric)) as liquido_estimado,
    nf.taxa_analise_am,
    nf.taxa_analise_origem,
    nf.limite_sacado_origem as sacado_limite_origem,
    nf.situacao,
    nf.cancelada_em,
    nf.xml_resumo,
    nf.bilateral,
    'nf'::text as tipo
   from notas_fiscais nf
     left join empresas fe on fe.id = nf.fornecedor_empresa_id
     left join empresas se on se.id = nf.sacado_empresa_id
     -- AS DUAS LINHAS DA CORREÇÃO. Eram `left join mercado_universo ... on cnpj = ...`.
     left join lateral public.app__cadastro_do_cnpj(nf.fornecedor_cnpj) fu on true
     left join lateral public.app__cadastro_do_cnpj(nf.sacado_cnpj) su on true
     left join protestos_atual fpa on fpa.cnpj = nf.fornecedor_cnpj
     left join clientes_onepay fco on fco.cnpj = nf.fornecedor_cnpj
     left join supressao fsup on fsup.escopo = 'empresa'::text and fsup.valor = nf.fornecedor_cnpj and (fsup.expira_em is null or fsup.expira_em >= CURRENT_DATE)
     left join antecipacao_fornecedor_sem_interesse fsi on fsi.cnpj = nf.fornecedor_cnpj
     left join antecipacoes ant on ant.id_externo = nf.conversao_antecipacao_id
     left join lateral ( select max(n2.numero::bigint) as ultimo_numero_nf
           from notas_fiscais n2
          where n2.fornecedor_cnpj = nf.fornecedor_cnpj and n2.tipo = 'NFe'::text and n2.numero ~ '^[0-9]{1,9}$'::text) fnf on true;

-- ── 2. funil_oportunidades_preauth ─────────────────────────────────────────

create or replace view public.funil_oportunidades_preauth
with (security_invoker = true) as
 select 'pre_autorizacao'::text as tipo,
    pa.id_externo::text as id,
    NULL::text as access_key,
    pa.fornecedor_cnpj,
    COALESCE(pa.fornecedor_nome, fe.razao_social, fu.razao_social, fu.nome_fantasia, 'Sem cadastro'::text) as fornecedor_nome,
    pa.fornecedor_empresa_id,
    COALESCE(pa.fornecedor_cadastrado, false) as fornecedor_cadastrado,
        case
            when not COALESCE(pa.fornecedor_cadastrado, false) then 'aquisicao'::text
            when fco.last_anticipation is not null or fe.ultima_antecipacao is not null then 'recorrencia'::text
            else 'ativacao'::text
        end as fornecedor_tipagem,
    COALESCE(fpa.tem_protesto, false) as fornecedor_tem_protesto,
    fsup.valor is not null as fornecedor_suprimido,
    fsi.cnpj is not null as fornecedor_sem_interesse,
    COALESCE(fe.uf, fu.uf) as fornecedor_uf,
    false as credor_pessoa_fisica,
    pa.sacado_cnpj,
    pa.sacado_nome,
    pa.sacado_matriz_cnpj,
    pa.sacado_empresa_id,
    se.id is not null as sacado_cadastrado,
    pa.valor,
    pa.vencimento,
    pa.criada_em as data_base,
    COALESCE(pa.invoice_number, pa.sienge_document_number, pa.identification) as numero_exibicao,
    pa.status as estado_origem,
    pa.expira_em as relogio,
    pa.vencimento - CURRENT_DATE as dias_para_vencimento,
    pa.credit_status as sacado_credito_status,
    pa.limite_disponivel_sacado as sacado_limite_disponivel,
    pa.limite_disponivel_sacado >= pa.valor as sacado_limite_cobre_valor,
    pa.receita_esperada,
    pa.taxa_usada,
    pa.tac_estimada,
    pa.seguro_estimado,
    GREATEST(0::numeric, pa.valor - COALESCE(pa.receita_esperada, 0::numeric) - COALESCE(pa.tac_estimada, 0::numeric) - COALESCE(pa.seguro_estimado, 0::numeric)) as liquido_estimado,
    pa.faixa,
    pa.faixa_motivo,
    pa.estagio_funil,
    pa.estagio_alterado_em,
    pa.perda_motivo,
    pa.vendedor_id,
    pa.vendedor_origem,
    true as operavel,
    (
        case
            when pa.expira_em is null then 'origem '::text || pa.origin
            when pa.expira_em < now() then 'expirou em '::text || to_char(pa.expira_em, 'DD/MM'::text)
            else ('expira em '::text || GREATEST(0, pa.expira_em::date - CURRENT_DATE)::text) || ' dias'::text
        end || ' · '::text) || pa.origin as linha_contexto,
    pa.id_externo as pre_autorizacao_id,
    pa.status as pre_autorizacao_status,
    pa.criada_em as pre_autorizacao_em,
    pa.anticipation_id_externo as conversao_antecipacao_id,
    false as conversao_em_disputa,
    pa.limite_disponivel_sacado >= pa.valor as sacado_limite_cobre_nota,
    fco.last_anticipation is not null or fe.ultima_antecipacao is not null as fornecedor_ja_antecipou,
    fco.cnpj is not null as fornecedor_e_cliente_onepay,
    fpa.valor_total as fornecedor_protesto_valor,
    -- O cast é obrigatório: `returns table` NÃO carrega o typmod, e a coluna da view
    -- é `numeric(16,2)`. Sem ele o `create or replace view` recusa.
    fu.capital_social::numeric(16,2) as fornecedor_capital_social,
    fu.situacao_cadastral as fornecedor_situacao_cadastral,
    NULL::bigint as fornecedor_ultimo_numero_nf,
    natureza_juridica_codigo(fu.natureza_juridica) as fornecedor_natureza_juridica,
    COALESCE(se.uf, su.uf) as sacado_uf,
    NULL::text as direction,
    NULL::text as tipo_nf,
    NULL::text as vencimento_origem,
    NULL::text as natureza_operacao,
    NULL::text as numero,
    NULL::text as serie,
    NULL::timestamp with time zone as emitida_em,
    NULL::text as nao_operavel_motivo,
    fpa.consultado_em as fornecedor_protesto_em,
    NULL::numeric as conversao_valor,
    NULL::numeric as conversao_taxa
   from pre_autorizacoes pa
     left join empresas fe on fe.id = pa.fornecedor_empresa_id
     left join empresas se on se.id = pa.sacado_empresa_id
     left join lateral public.app__cadastro_do_cnpj(pa.fornecedor_cnpj) fu on true
     left join lateral public.app__cadastro_do_cnpj(pa.sacado_cnpj) su on true
     left join protestos_atual fpa on fpa.cnpj = pa.fornecedor_cnpj
     left join clientes_onepay fco on fco.cnpj = pa.fornecedor_cnpj
     left join supressao fsup on fsup.escopo = 'empresa'::text and fsup.valor = pa.fornecedor_cnpj and (fsup.expira_em is null or fsup.expira_em >= CURRENT_DATE)
     left join antecipacao_fornecedor_sem_interesse fsi on fsi.cnpj = pa.fornecedor_cnpj
  where pa.origem_exibida and not (exists ( select 1
           from funil_ocultacoes o
          where o.tipo = 'pre_autorizacao'::text and o.referencia_id = pa.id_externo::text));

-- ── 3. funil_oportunidades_titulo ──────────────────────────────────────────

create or replace view public.funil_oportunidades_titulo
with (security_invoker = true) as
 with parcelas_do_bill as (
         select sienge_titulos.connection_id,
            sienge_titulos.bill_id,
            count(*)::integer as total
           from sienge_titulos
          group by sienge_titulos.connection_id, sienge_titulos.bill_id
        )
 select 'titulo'::text as tipo,
    st.id_externo::text as id,
    COALESCE(st.bill_access_key, st.nfe_candidate_access_key) as access_key,
    st.credor_cnpj as fornecedor_cnpj,
    COALESCE(st.credor_nome, ce.razao_social, cu.razao_social, cu.nome_fantasia,
        case
            when st.credor_pessoa_fisica then 'Credor PF'::text
            else 'Sem cadastro'::text
        end) as fornecedor_nome,
    st.credor_empresa_id as fornecedor_empresa_id,
    COALESCE(st.credor_cadastrado, false) as fornecedor_cadastrado,
        case
            when st.credor_pessoa_fisica then NULL::text
            when not COALESCE(st.credor_cadastrado, false) then 'aquisicao'::text
            when cco.last_anticipation is not null or ce.ultima_antecipacao is not null then 'recorrencia'::text
            else 'ativacao'::text
        end as fornecedor_tipagem,
    COALESCE(cpa.tem_protesto, false) as fornecedor_tem_protesto,
    csup.valor is not null as fornecedor_suprimido,
    csi.cnpj is not null as fornecedor_sem_interesse,
    COALESCE(ce.uf, cu.uf) as fornecedor_uf,
    st.credor_pessoa_fisica,
    st.sacado_cnpj,
    st.sacado_nome,
    st.sacado_matriz_cnpj,
    st.sacado_empresa_id,
    sse.id is not null as sacado_cadastrado,
    st.valor,
    st.vencimento,
    st.primeira_vez_visto as data_base,
    COALESCE(st.bill_document_number, st.bill_id::text) || COALESCE((', parcela '::text || st.installment_number::text) || COALESCE('/'::text || pb.total::text, ''::text), ''::text) as numero_exibicao,
    st.situation as estado_origem,
    NULL::timestamp with time zone as relogio,
    st.vencimento - CURRENT_DATE as dias_para_vencimento,
    st.credit_status as sacado_credito_status,
    st.limite_disponivel_sacado as sacado_limite_disponivel,
    st.limite_disponivel_sacado >= st.valor as sacado_limite_cobre_valor,
    st.receita_esperada,
    st.taxa_usada,
    st.tac_estimada,
    st.seguro_estimado,
    GREATEST(0::numeric, st.valor - COALESCE(st.receita_esperada, 0::numeric) - COALESCE(st.tac_estimada, 0::numeric) - COALESCE(st.seguro_estimado, 0::numeric)) as liquido_estimado,
    st.faixa,
    st.faixa_motivo,
    st.estagio_funil,
    st.estagio_alterado_em,
    st.perda_motivo,
    st.vendedor_id,
    st.vendedor_origem,
    true as operavel,
    (((COALESCE(st.bill_document_number, 'doc '::text || st.bill_id::text) || COALESCE((' · parcela '::text || st.installment_number::text) || COALESCE('/'::text || pb.total::text, ''::text), ''::text)) || ' · '::text) || st.situation) || COALESCE(' · '::text || st.guard_reason, ''::text) as linha_contexto,
    selo2.pre_autorizacao_id,
    selo2.status as pre_autorizacao_status,
    selo2.criada_em as pre_autorizacao_em,
    st.anticipation_id_externo as conversao_antecipacao_id,
    false as conversao_em_disputa,
    st.limite_disponivel_sacado >= st.valor as sacado_limite_cobre_nota,
    cco.last_anticipation is not null or ce.ultima_antecipacao is not null as fornecedor_ja_antecipou,
    cco.cnpj is not null as fornecedor_e_cliente_onepay,
    cpa.valor_total as fornecedor_protesto_valor,
    cu.capital_social::numeric(16,2) as fornecedor_capital_social,
    cu.situacao_cadastral as fornecedor_situacao_cadastral,
    NULL::bigint as fornecedor_ultimo_numero_nf,
    natureza_juridica_codigo(cu.natureza_juridica) as fornecedor_natureza_juridica,
    COALESCE(sse.uf, ssu.uf) as sacado_uf,
    NULL::text as direction,
    NULL::text as tipo_nf,
    NULL::text as vencimento_origem,
    NULL::text as natureza_operacao,
    NULL::text as numero,
    NULL::text as serie,
    NULL::timestamp with time zone as emitida_em,
    NULL::text as nao_operavel_motivo,
    cpa.consultado_em as fornecedor_protesto_em,
    NULL::numeric as conversao_valor,
    NULL::numeric as conversao_taxa
   from sienge_titulos st
     left join parcelas_do_bill pb on pb.bill_id = st.bill_id and not pb.connection_id is distinct from st.connection_id
     left join empresas ce on ce.id = st.credor_empresa_id
     left join empresas sse on sse.id = st.sacado_empresa_id
     left join lateral public.app__cadastro_do_cnpj(st.credor_cnpj) cu on true
     left join lateral public.app__cadastro_do_cnpj(st.sacado_cnpj) ssu on true
     left join protestos_atual cpa on cpa.cnpj = st.credor_cnpj
     left join clientes_onepay cco on cco.cnpj = st.credor_cnpj
     left join supressao csup on csup.escopo = 'empresa'::text and csup.valor = st.credor_cnpj and (csup.expira_em is null or csup.expira_em >= CURRENT_DATE)
     left join antecipacao_fornecedor_sem_interesse csi on csi.cnpj = st.credor_cnpj
     left join funil_selos_preauth selo2 on selo2.tipo = 'titulo'::text and selo2.referencia_id = st.id_externo::text
  where st.origem_exibida and not (exists ( select 1
           from funil_ocultacoes o
          where o.tipo = 'titulo'::text and o.referencia_id = st.id_externo::text));
