/*
 * O funil diz o que entrou desde o último expediente (04t).
 *
 * O pedido era "filtrar o que entrou nas últimas 6 horas", com a exceção de que na
 * segunda-feira vale desde sexta. A exceção é a regra: o originador quer o que chegou
 * desde o fim do último expediente útil. A janela é calculada no core
 * (`funil/janela-novidades.ts`); aqui fica o que ela lê — o carimbo de entrada, o
 * calendário e o marcador de visita.
 *
 * ── O CARIMBO É DO BANCO, NÃO DO SYNC ───────────────────────────────────────
 * `entrou_funil_em` é quando o item apareceu no funil, não quando a nota foi emitida:
 * a NF de três dias atrás que o certificado só capturou hoje é novidade hoje. Ele é
 * gravado e protegido por GATILHO porque há uma dúzia de escritores nessas três
 * tabelas (os três syncs, o roteamento, a dedup, o casamento de antecipação, o RPC do
 * gestor) e o upsert do supabase-js não tem `coalesce` no conflito. Com o gatilho
 * nenhum deles consegue reescrever o carimbo — nem mandando NULL num lote de formato
 * misturado, que é como o PostgREST preenche a chave que falta.
 *
 * ── A REENTRADA ─────────────────────────────────────────────────────────────
 * `reentrou_funil_em` é para o item que já existia e só agora virou trabalho de
 * alguém. Três casos, e só eles:
 *   carteira         mudou de titular (`vendedor_id`);
 *   sacado_aprovado  o crédito do sacado virou APPROVED;
 *   operavel         a nota deixou de ser não operável (só NF).
 * Mudança de estágio NÃO carimba: é trabalho acontecendo, não chegada.
 *
 * Duas guardas, as duas medidas em 12/10/2026:
 *   1. O roteamento roda logo atrás do sync, então TODA nota nova ganha dono minutos
 *      depois de nascer. Isso é parte da chegada: a primeira atribuição nas primeiras
 *      12 horas não carimba, senão todo card novo diria "voltou ao funil".
 *   2. O status de crédito oscila na origem: 35 dos 37 sacados que viraram APPROVED
 *      viraram mais de uma vez (1.576 viradas em 77 dias). Só carimba quando o sacado
 *      NÃO estava aprovado no último snapshot com mais de 12 horas — a virada de quem
 *      já era aprovado ontem é oscilação, não aprovação.
 *
 * ── AS VIEWS ────────────────────────────────────────────────────────────────
 * Quatro colunas novas, sempre no FIM: os dois carimbos, o motivo e `novidade_em`
 * (`coalesce(reentrou, entrou)`), que é a coluna que o filtro e o índice usam — o
 * PostgREST não filtra por expressão. O índice é sobre a expressão, e não sobre
 * `entrou_funil_em` como a spec desenhou, porque é ela que o `where` lê.
 * Toda view recriada aqui reafirma `security_invoker` logo abaixo (0099, 0225).
 */

-- ─── 1. Os carimbos ─────────────────────────────────────────────────────────

alter table public.notas_fiscais
  add column if not exists entrou_funil_em timestamptz,
  add column if not exists reentrou_funil_em timestamptz,
  add column if not exists reentrou_funil_motivo text;
alter table public.sienge_titulos
  add column if not exists entrou_funil_em timestamptz,
  add column if not exists reentrou_funil_em timestamptz,
  add column if not exists reentrou_funil_motivo text;
alter table public.pre_autorizacoes
  add column if not exists entrou_funil_em timestamptz,
  add column if not exists reentrou_funil_em timestamptz,
  add column if not exists reentrou_funil_motivo text;

-- O que já existe entra com a data em que foi visto pela primeira vez. Sem isto o
-- filtro volta vazio no primeiro dia e parece quebrado.
-- `atualizada_em` da nota não pode andar por causa do backfill: ela diz quando a nota
-- mudou de verdade, e 115 mil linhas "alteradas hoje" apagariam essa informação.
alter table public.notas_fiscais disable trigger notas_fiscais_set_atualizada_em;
update public.notas_fiscais set entrou_funil_em = criada_em where entrou_funil_em is null;
alter table public.notas_fiscais enable trigger notas_fiscais_set_atualizada_em;

update public.sienge_titulos
   set entrou_funil_em = coalesce(primeira_vez_visto, sincronizado_em, now())
 where entrou_funil_em is null;
update public.pre_autorizacoes
   set entrou_funil_em = coalesce(criada_em, sincronizada_em, now())
 where entrou_funil_em is null;

alter table public.notas_fiscais drop constraint if exists notas_fiscais_reentrou_motivo_chk;
alter table public.sienge_titulos drop constraint if exists sienge_titulos_reentrou_motivo_chk;
alter table public.pre_autorizacoes drop constraint if exists pre_autorizacoes_reentrou_motivo_chk;

alter table public.notas_fiscais
  alter column entrou_funil_em set default now(),
  alter column entrou_funil_em set not null,
  add constraint notas_fiscais_reentrou_motivo_chk
    check (reentrou_funil_motivo is null or reentrou_funil_motivo in ('carteira', 'sacado_aprovado', 'operavel'));
alter table public.sienge_titulos
  alter column entrou_funil_em set default now(),
  alter column entrou_funil_em set not null,
  add constraint sienge_titulos_reentrou_motivo_chk
    check (reentrou_funil_motivo is null or reentrou_funil_motivo in ('carteira', 'sacado_aprovado', 'operavel'));
alter table public.pre_autorizacoes
  alter column entrou_funil_em set default now(),
  alter column entrou_funil_em set not null,
  add constraint pre_autorizacoes_reentrou_motivo_chk
    check (reentrou_funil_motivo is null or reentrou_funil_motivo in ('carteira', 'sacado_aprovado', 'operavel'));

comment on column public.notas_fiscais.entrou_funil_em is
  'Quando a nota apareceu no funil (não quando foi emitida). Imutável: o gatilho funil_carimbar_entrada desfaz qualquer reescrita.';
comment on column public.notas_fiscais.reentrou_funil_em is
  'Quando a nota voltou a ser novidade para alguém: troca de titular, sacado aprovado ou nota que virou operável. Só o gatilho grava.';
comment on column public.sienge_titulos.entrou_funil_em is
  'Quando o título apareceu no funil. Imutável (gatilho funil_carimbar_entrada).';
comment on column public.pre_autorizacoes.entrou_funil_em is
  'Quando a pré-autorização apareceu no funil. Imutável (gatilho funil_carimbar_entrada).';

create index if not exists notas_fiscais_novidade_idx
  on public.notas_fiscais ((coalesce(reentrou_funil_em, entrou_funil_em)) desc);
create index if not exists sienge_titulos_novidade_idx
  on public.sienge_titulos ((coalesce(reentrou_funil_em, entrou_funil_em)) desc);
create index if not exists pre_autorizacoes_novidade_idx
  on public.pre_autorizacoes ((coalesce(reentrou_funil_em, entrou_funil_em)) desc);

-- ─── 2. O gatilho ───────────────────────────────────────────────────────────
-- Um só para as três tabelas: as colunas que ele lê têm o mesmo nome nas três, e o
-- ramo da nota só é avaliado quando a tabela é a da nota.
-- SECURITY DEFINER porque lê `credito_snapshots`, e quem dispara pode ser um usuário
-- movendo o card — a RLS dele não pode decidir o que se carimba.
create or replace function public.funil_carimbar_entrada()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motivo text;
  v_status_anterior text;
begin
  if tg_op = 'INSERT' then
    new.entrou_funil_em := coalesce(new.entrou_funil_em, now());
    return new;
  end if;

  -- Imutável, venha o que vier no update.
  new.entrou_funil_em := coalesce(old.entrou_funil_em, new.entrou_funil_em, now());
  -- A reentrada é só deste gatilho: o que o escritor mandar é ignorado.
  new.reentrou_funil_em := old.reentrou_funil_em;
  new.reentrou_funil_motivo := old.reentrou_funil_motivo;

  -- Item encerrado não volta a ser novidade por trocar de dono.
  if new.estagio_funil in ('convertida', 'perdida', 'expirada') then
    return new;
  end if;

  if new.vendedor_id is not null
     and new.vendedor_id is distinct from old.vendedor_id
     and (old.vendedor_id is not null or new.entrou_funil_em < now() - interval '12 hours') then
    v_motivo := 'carteira';

  elsif new.credit_status = 'APPROVED' and old.credit_status is distinct from 'APPROVED' then
    select s.status into v_status_anterior
      from public.credito_snapshots s
     where s.cnpj = new.sacado_cnpj
       and s.capturado_em < now() - interval '12 hours'
     order by s.capturado_em desc
     limit 1;
    if v_status_anterior is distinct from 'APPROVED' then
      v_motivo := 'sacado_aprovado';
    end if;

  elsif tg_table_name = 'notas_fiscais' then
    if (new.situacao = 'valida' and coalesce(new.operavel_manual, new.operavel, false))
       and not (old.situacao = 'valida' and coalesce(old.operavel_manual, old.operavel, false)) then
      v_motivo := 'operavel';
    end if;
  end if;

  if v_motivo is not null then
    new.reentrou_funil_em := now();
    new.reentrou_funil_motivo := v_motivo;
  end if;
  return new;
end;
$$;

-- Função de gatilho não é endpoint (0222i).
revoke all on function public.funil_carimbar_entrada() from public, anon, authenticated;

drop trigger if exists notas_fiscais_carimbo_funil on public.notas_fiscais;
create trigger notas_fiscais_carimbo_funil
  before insert or update on public.notas_fiscais
  for each row execute function public.funil_carimbar_entrada();

drop trigger if exists sienge_titulos_carimbo_funil on public.sienge_titulos;
create trigger sienge_titulos_carimbo_funil
  before insert or update on public.sienge_titulos
  for each row execute function public.funil_carimbar_entrada();

drop trigger if exists pre_autorizacoes_carimbo_funil on public.pre_autorizacoes;
create trigger pre_autorizacoes_carimbo_funil
  before insert or update on public.pre_autorizacoes
  for each row execute function public.funil_carimbar_entrada();

-- ─── 3. As views: quatro colunas novas, sempre no FIM ───────────────────────

create or replace view public.notas_funil as
 SELECT nf.access_key,
    nf.nf_id_externo,
    nf.tipo AS tipo_nf,
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
    (nf.vencimento - CURRENT_DATE) AS dias_para_vencimento,
    nf.fornecedor_cnpj,
    nf.fornecedor_nome,
    COALESCE(nf.fornecedor_cadastrado, false) AS fornecedor_cadastrado,
    nf.fornecedor_empresa_id,
    COALESCE(fe.uf, fu.uf) AS fornecedor_uf,
    COALESCE(fpa.tem_protesto, false) AS fornecedor_tem_protesto,
    (fco.cnpj IS NOT NULL) AS fornecedor_e_cliente_onepay,
    ((fco.last_anticipation IS NOT NULL) OR (fe.ultima_antecipacao IS NOT NULL)) AS fornecedor_ja_antecipou,
        CASE
            WHEN (NOT COALESCE(nf.fornecedor_cadastrado, false)) THEN 'aquisicao'::text
            WHEN ((fco.last_anticipation IS NOT NULL) OR (fe.ultima_antecipacao IS NOT NULL)) THEN 'recorrencia'::text
            ELSE 'ativacao'::text
        END AS fornecedor_tipagem,
    (fsup.valor IS NOT NULL) AS fornecedor_suprimido,
    nf.sacado_cnpj,
    nf.sacado_nome,
    COALESCE(nf.sacado_cadastrado, false) AS sacado_cadastrado,
    nf.sacado_empresa_id,
    nf.contato_sacado,
    COALESCE(se.uf, su.uf) AS sacado_uf,
    nf.credit_status AS sacado_credito_status,
    nf.credit_role AS sacado_credito_role,
    nf.credit_limite AS sacado_limite,
    nf.limite_disponivel_sacado AS sacado_limite_disponivel,
    (nf.limite_disponivel_sacado >= nf.valor) AS sacado_limite_cobre_nota,
    nf.contato_fornecedor,
    COALESCE(su.cnae_principal, se.cnae_principal) AS sacado_cnae_principal,
    NULLIF(COALESCE(su.cnae_grupos, cnae_grupos_de(se.cnae_principal, NULL::text[])), '{}'::text[]) AS sacado_cnae_grupos,
    COALESCE((NULLIF(COALESCE(su.cnae_grupos, cnae_grupos_de(se.cnae_principal, NULL::text[])), '{}'::text[]) && ARRAY['41'::text, '42'::text, '43'::text]), false) AS sacado_construcao,
    COALESCE(su.razao_social, se.razao_social) AS sacado_razao_social,
    COALESCE(su.municipio, se.municipio) AS sacado_municipio,
    (fu.capital_social)::numeric(16,2) AS fornecedor_capital_social,
    fu.situacao_cadastral AS fornecedor_situacao_cadastral,
    fpa.valor_total AS fornecedor_protesto_valor,
    fnf.ultimo_numero_nf AS fornecedor_ultimo_numero_nf,
    nf.natureza_operacao,
    ((nf.situacao = 'valida'::text) AND COALESCE(nf.operavel_manual, nf.operavel)) AS operavel,
        CASE
            WHEN (nf.situacao = 'cancelada'::text) THEN 'Nota cancelada'::text
            WHEN (nf.situacao = 'denegada'::text) THEN 'Nota denegada'::text
            ELSE nf.nao_operavel_motivo
        END AS nao_operavel_motivo,
    su.camada AS sacado_camada,
    fpa.consultado_em AS fornecedor_protesto_em,
    nf.conversao_antecipacao_id,
    nf.conversao_em_disputa,
    ant.gross_value AS conversao_valor,
    ant.monthly_interest_rate AS conversao_taxa,
    ant.status AS conversao_status,
    nf.vendedor_id,
    nf.vendedor_origem,
    se.gestao_operacao AS sacado_gestao_operacao,
    (fsi.cnpj IS NOT NULL) AS fornecedor_sem_interesse,
    natureza_juridica_codigo(fu.natureza_juridica) AS fornecedor_natureza_juridica,
    nf.tac_estimada,
    nf.seguro_estimado,
    GREATEST((0)::numeric, (((nf.valor - COALESCE(nf.receita_esperada, (0)::numeric)) - COALESCE(nf.tac_estimada, (0)::numeric)) - COALESCE(nf.seguro_estimado, (0)::numeric))) AS liquido_estimado,
    nf.taxa_analise_am,
    nf.taxa_analise_origem,
    nf.limite_sacado_origem AS sacado_limite_origem,
    nf.situacao,
    nf.cancelada_em,
    nf.xml_resumo,
    nf.bilateral,
    'nf'::text AS tipo,
    nf.entrou_funil_em,
    nf.reentrou_funil_em,
    nf.reentrou_funil_motivo,
    COALESCE(nf.reentrou_funil_em, nf.entrou_funil_em) AS novidade_em
   FROM ((((((((((notas_fiscais nf
     LEFT JOIN empresas fe ON ((fe.id = nf.fornecedor_empresa_id)))
     LEFT JOIN empresas se ON ((se.id = nf.sacado_empresa_id)))
     LEFT JOIN LATERAL app__cadastro_do_cnpj(nf.fornecedor_cnpj) fu(cnpj, razao_social, nome_fantasia, uf, municipio, capital_social, situacao_cadastral, natureza_juridica, cnae_principal, cnae_grupos, camada) ON (true))
     LEFT JOIN LATERAL app__cadastro_do_cnpj(nf.sacado_cnpj) su(cnpj, razao_social, nome_fantasia, uf, municipio, capital_social, situacao_cadastral, natureza_juridica, cnae_principal, cnae_grupos, camada) ON (true))
     LEFT JOIN protestos_atual fpa ON ((fpa.cnpj = nf.fornecedor_cnpj)))
     LEFT JOIN clientes_onepay fco ON ((fco.cnpj = nf.fornecedor_cnpj)))
     LEFT JOIN supressao fsup ON (((fsup.escopo = 'empresa'::text) AND (fsup.valor = nf.fornecedor_cnpj) AND ((fsup.expira_em IS NULL) OR (fsup.expira_em >= CURRENT_DATE)))))
     LEFT JOIN antecipacao_fornecedor_sem_interesse fsi ON ((fsi.cnpj = nf.fornecedor_cnpj)))
     LEFT JOIN antecipacoes ant ON ((ant.id_externo = nf.conversao_antecipacao_id)))
     LEFT JOIN LATERAL ( SELECT max((n2.numero)::bigint) AS ultimo_numero_nf
           FROM notas_fiscais n2
          WHERE ((n2.fornecedor_cnpj = nf.fornecedor_cnpj) AND (n2.tipo = 'NFe'::text) AND (n2.numero ~ '^[0-9]{1,9}$'::text))) fnf ON (true));

alter view public.notas_funil set (security_invoker = on);

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
    NULL::text AS bill_document_type,
    nf.entrou_funil_em,
    nf.reentrou_funil_em,
    nf.reentrou_funil_motivo,
    nf.novidade_em
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
    pa.sienge_bill_document_type AS bill_document_type,
    pa.entrou_funil_em,
    pa.reentrou_funil_em,
    pa.reentrou_funil_motivo,
    COALESCE(pa.reentrou_funil_em, pa.entrou_funil_em) AS novidade_em
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
          WHERE ((o.tipo = 'pre_autorizacao'::text) AND (o.referencia_id = (pa.id_externo)::text))))) AND ((pa.vencimento IS NULL) OR (pa.vencimento <= (CURRENT_DATE + 180)) OR ((COALESCE(pa.origin, ''::text) <> 'sienge'::text) AND (pa.sienge_bill_document_type IS NULL))));

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
    st.bill_document_type,
    st.entrou_funil_em,
    st.reentrou_funil_em,
    st.reentrou_funil_motivo,
    COALESCE(st.reentrou_funil_em, st.entrou_funil_em) AS novidade_em
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
          WHERE ((o.tipo = 'titulo'::text) AND (o.referencia_id = (st.id_externo)::text))))) AND ((st.vencimento IS NULL) OR (st.vencimento <= (CURRENT_DATE + 180))));

alter view public.funil_oportunidades_titulo set (security_invoker = on);

create or replace view public.funil_oportunidades as
 SELECT funil_oportunidades_nf.tipo,
    funil_oportunidades_nf.id,
    funil_oportunidades_nf.access_key,
    funil_oportunidades_nf.fornecedor_cnpj,
    funil_oportunidades_nf.fornecedor_nome,
    funil_oportunidades_nf.fornecedor_empresa_id,
    funil_oportunidades_nf.fornecedor_cadastrado,
    funil_oportunidades_nf.fornecedor_tipagem,
    funil_oportunidades_nf.fornecedor_tem_protesto,
    funil_oportunidades_nf.fornecedor_suprimido,
    funil_oportunidades_nf.fornecedor_sem_interesse,
    funil_oportunidades_nf.fornecedor_uf,
    funil_oportunidades_nf.credor_pessoa_fisica,
    funil_oportunidades_nf.sacado_cnpj,
    funil_oportunidades_nf.sacado_nome,
    funil_oportunidades_nf.sacado_matriz_cnpj,
    funil_oportunidades_nf.sacado_empresa_id,
    funil_oportunidades_nf.sacado_cadastrado,
    funil_oportunidades_nf.valor,
    funil_oportunidades_nf.vencimento,
    funil_oportunidades_nf.data_base,
    funil_oportunidades_nf.numero_exibicao,
    funil_oportunidades_nf.estado_origem,
    funil_oportunidades_nf.relogio,
    funil_oportunidades_nf.dias_para_vencimento,
    funil_oportunidades_nf.sacado_credito_status,
    funil_oportunidades_nf.sacado_limite_disponivel,
    funil_oportunidades_nf.sacado_limite_cobre_valor,
    funil_oportunidades_nf.receita_esperada,
    funil_oportunidades_nf.taxa_usada,
    funil_oportunidades_nf.tac_estimada,
    funil_oportunidades_nf.seguro_estimado,
    funil_oportunidades_nf.liquido_estimado,
    funil_oportunidades_nf.faixa,
    funil_oportunidades_nf.faixa_motivo,
    funil_oportunidades_nf.estagio_funil,
    funil_oportunidades_nf.estagio_alterado_em,
    funil_oportunidades_nf.perda_motivo,
    funil_oportunidades_nf.vendedor_id,
    funil_oportunidades_nf.vendedor_origem,
    funil_oportunidades_nf.operavel,
    funil_oportunidades_nf.linha_contexto,
    funil_oportunidades_nf.pre_autorizacao_id,
    funil_oportunidades_nf.pre_autorizacao_status,
    funil_oportunidades_nf.pre_autorizacao_em,
    funil_oportunidades_nf.conversao_antecipacao_id,
    funil_oportunidades_nf.conversao_em_disputa,
    funil_oportunidades_nf.sacado_limite_cobre_nota,
    funil_oportunidades_nf.fornecedor_ja_antecipou,
    funil_oportunidades_nf.fornecedor_e_cliente_onepay,
    funil_oportunidades_nf.fornecedor_protesto_valor,
    funil_oportunidades_nf.fornecedor_capital_social,
    funil_oportunidades_nf.fornecedor_situacao_cadastral,
    funil_oportunidades_nf.fornecedor_ultimo_numero_nf,
    funil_oportunidades_nf.fornecedor_natureza_juridica,
    funil_oportunidades_nf.sacado_uf,
    funil_oportunidades_nf.direction,
    funil_oportunidades_nf.tipo_nf,
    funil_oportunidades_nf.vencimento_origem,
    funil_oportunidades_nf.natureza_operacao,
    funil_oportunidades_nf.numero,
    funil_oportunidades_nf.serie,
    funil_oportunidades_nf.emitida_em,
    funil_oportunidades_nf.nao_operavel_motivo,
    funil_oportunidades_nf.fornecedor_protesto_em,
    funil_oportunidades_nf.conversao_valor,
    funil_oportunidades_nf.conversao_taxa,
    funil_oportunidades_nf.bill_origin,
    funil_oportunidades_nf.bill_document_type,
    funil_oportunidades_nf.entrou_funil_em,
    funil_oportunidades_nf.reentrou_funil_em,
    funil_oportunidades_nf.reentrou_funil_motivo,
    funil_oportunidades_nf.novidade_em
   FROM funil_oportunidades_nf
UNION ALL
 SELECT funil_oportunidades_preauth.tipo,
    funil_oportunidades_preauth.id,
    funil_oportunidades_preauth.access_key,
    funil_oportunidades_preauth.fornecedor_cnpj,
    funil_oportunidades_preauth.fornecedor_nome,
    funil_oportunidades_preauth.fornecedor_empresa_id,
    funil_oportunidades_preauth.fornecedor_cadastrado,
    funil_oportunidades_preauth.fornecedor_tipagem,
    funil_oportunidades_preauth.fornecedor_tem_protesto,
    funil_oportunidades_preauth.fornecedor_suprimido,
    funil_oportunidades_preauth.fornecedor_sem_interesse,
    funil_oportunidades_preauth.fornecedor_uf,
    funil_oportunidades_preauth.credor_pessoa_fisica,
    funil_oportunidades_preauth.sacado_cnpj,
    funil_oportunidades_preauth.sacado_nome,
    funil_oportunidades_preauth.sacado_matriz_cnpj,
    funil_oportunidades_preauth.sacado_empresa_id,
    funil_oportunidades_preauth.sacado_cadastrado,
    funil_oportunidades_preauth.valor,
    funil_oportunidades_preauth.vencimento,
    funil_oportunidades_preauth.data_base,
    funil_oportunidades_preauth.numero_exibicao,
    funil_oportunidades_preauth.estado_origem,
    funil_oportunidades_preauth.relogio,
    funil_oportunidades_preauth.dias_para_vencimento,
    funil_oportunidades_preauth.sacado_credito_status,
    funil_oportunidades_preauth.sacado_limite_disponivel,
    funil_oportunidades_preauth.sacado_limite_cobre_valor,
    funil_oportunidades_preauth.receita_esperada,
    funil_oportunidades_preauth.taxa_usada,
    funil_oportunidades_preauth.tac_estimada,
    funil_oportunidades_preauth.seguro_estimado,
    funil_oportunidades_preauth.liquido_estimado,
    funil_oportunidades_preauth.faixa,
    funil_oportunidades_preauth.faixa_motivo,
    funil_oportunidades_preauth.estagio_funil,
    funil_oportunidades_preauth.estagio_alterado_em,
    funil_oportunidades_preauth.perda_motivo,
    funil_oportunidades_preauth.vendedor_id,
    funil_oportunidades_preauth.vendedor_origem,
    funil_oportunidades_preauth.operavel,
    funil_oportunidades_preauth.linha_contexto,
    funil_oportunidades_preauth.pre_autorizacao_id,
    funil_oportunidades_preauth.pre_autorizacao_status,
    funil_oportunidades_preauth.pre_autorizacao_em,
    funil_oportunidades_preauth.conversao_antecipacao_id,
    funil_oportunidades_preauth.conversao_em_disputa,
    funil_oportunidades_preauth.sacado_limite_cobre_nota,
    funil_oportunidades_preauth.fornecedor_ja_antecipou,
    funil_oportunidades_preauth.fornecedor_e_cliente_onepay,
    funil_oportunidades_preauth.fornecedor_protesto_valor,
    funil_oportunidades_preauth.fornecedor_capital_social,
    funil_oportunidades_preauth.fornecedor_situacao_cadastral,
    funil_oportunidades_preauth.fornecedor_ultimo_numero_nf,
    funil_oportunidades_preauth.fornecedor_natureza_juridica,
    funil_oportunidades_preauth.sacado_uf,
    funil_oportunidades_preauth.direction,
    funil_oportunidades_preauth.tipo_nf,
    funil_oportunidades_preauth.vencimento_origem,
    funil_oportunidades_preauth.natureza_operacao,
    funil_oportunidades_preauth.numero,
    funil_oportunidades_preauth.serie,
    funil_oportunidades_preauth.emitida_em,
    funil_oportunidades_preauth.nao_operavel_motivo,
    funil_oportunidades_preauth.fornecedor_protesto_em,
    funil_oportunidades_preauth.conversao_valor,
    funil_oportunidades_preauth.conversao_taxa,
    funil_oportunidades_preauth.bill_origin,
    funil_oportunidades_preauth.bill_document_type,
    funil_oportunidades_preauth.entrou_funil_em,
    funil_oportunidades_preauth.reentrou_funil_em,
    funil_oportunidades_preauth.reentrou_funil_motivo,
    funil_oportunidades_preauth.novidade_em
   FROM funil_oportunidades_preauth
UNION ALL
 SELECT funil_oportunidades_titulo.tipo,
    funil_oportunidades_titulo.id,
    funil_oportunidades_titulo.access_key,
    funil_oportunidades_titulo.fornecedor_cnpj,
    funil_oportunidades_titulo.fornecedor_nome,
    funil_oportunidades_titulo.fornecedor_empresa_id,
    funil_oportunidades_titulo.fornecedor_cadastrado,
    funil_oportunidades_titulo.fornecedor_tipagem,
    funil_oportunidades_titulo.fornecedor_tem_protesto,
    funil_oportunidades_titulo.fornecedor_suprimido,
    funil_oportunidades_titulo.fornecedor_sem_interesse,
    funil_oportunidades_titulo.fornecedor_uf,
    funil_oportunidades_titulo.credor_pessoa_fisica,
    funil_oportunidades_titulo.sacado_cnpj,
    funil_oportunidades_titulo.sacado_nome,
    funil_oportunidades_titulo.sacado_matriz_cnpj,
    funil_oportunidades_titulo.sacado_empresa_id,
    funil_oportunidades_titulo.sacado_cadastrado,
    funil_oportunidades_titulo.valor,
    funil_oportunidades_titulo.vencimento,
    funil_oportunidades_titulo.data_base,
    funil_oportunidades_titulo.numero_exibicao,
    funil_oportunidades_titulo.estado_origem,
    funil_oportunidades_titulo.relogio,
    funil_oportunidades_titulo.dias_para_vencimento,
    funil_oportunidades_titulo.sacado_credito_status,
    funil_oportunidades_titulo.sacado_limite_disponivel,
    funil_oportunidades_titulo.sacado_limite_cobre_valor,
    funil_oportunidades_titulo.receita_esperada,
    funil_oportunidades_titulo.taxa_usada,
    funil_oportunidades_titulo.tac_estimada,
    funil_oportunidades_titulo.seguro_estimado,
    funil_oportunidades_titulo.liquido_estimado,
    funil_oportunidades_titulo.faixa,
    funil_oportunidades_titulo.faixa_motivo,
    funil_oportunidades_titulo.estagio_funil,
    funil_oportunidades_titulo.estagio_alterado_em,
    funil_oportunidades_titulo.perda_motivo,
    funil_oportunidades_titulo.vendedor_id,
    funil_oportunidades_titulo.vendedor_origem,
    funil_oportunidades_titulo.operavel,
    funil_oportunidades_titulo.linha_contexto,
    funil_oportunidades_titulo.pre_autorizacao_id,
    funil_oportunidades_titulo.pre_autorizacao_status,
    funil_oportunidades_titulo.pre_autorizacao_em,
    funil_oportunidades_titulo.conversao_antecipacao_id,
    funil_oportunidades_titulo.conversao_em_disputa,
    funil_oportunidades_titulo.sacado_limite_cobre_nota,
    funil_oportunidades_titulo.fornecedor_ja_antecipou,
    funil_oportunidades_titulo.fornecedor_e_cliente_onepay,
    funil_oportunidades_titulo.fornecedor_protesto_valor,
    funil_oportunidades_titulo.fornecedor_capital_social,
    funil_oportunidades_titulo.fornecedor_situacao_cadastral,
    funil_oportunidades_titulo.fornecedor_ultimo_numero_nf,
    funil_oportunidades_titulo.fornecedor_natureza_juridica,
    funil_oportunidades_titulo.sacado_uf,
    funil_oportunidades_titulo.direction,
    funil_oportunidades_titulo.tipo_nf,
    funil_oportunidades_titulo.vencimento_origem,
    funil_oportunidades_titulo.natureza_operacao,
    funil_oportunidades_titulo.numero,
    funil_oportunidades_titulo.serie,
    funil_oportunidades_titulo.emitida_em,
    funil_oportunidades_titulo.nao_operavel_motivo,
    funil_oportunidades_titulo.fornecedor_protesto_em,
    funil_oportunidades_titulo.conversao_valor,
    funil_oportunidades_titulo.conversao_taxa,
    funil_oportunidades_titulo.bill_origin,
    funil_oportunidades_titulo.bill_document_type,
    funil_oportunidades_titulo.entrou_funil_em,
    funil_oportunidades_titulo.reentrou_funil_em,
    funil_oportunidades_titulo.reentrou_funil_motivo,
    funil_oportunidades_titulo.novidade_em
   FROM funil_oportunidades_titulo;

alter view public.funil_oportunidades set (security_invoker = on);

-- ─── 4. O calendário de dias não úteis ──────────────────────────────────────
-- Tudo que está aqui conta como dia sem expediente. Os nacionais vêm da BrasilAPI
-- (job anual); estaduais, municipais e as emendas que a empresa decidiu tirar são
-- cadastro do gestor — e são exatamente esses que geram a segunda-feira errada.

create table if not exists public.dias_nao_uteis (
  data date primary key,
  nome text not null,
  escopo text not null default 'nacional'
    check (escopo in ('nacional', 'estadual', 'municipal', 'empresa')),
  uf text,
  municipio text,
  origem text not null default 'brasilapi' check (origem in ('brasilapi', 'manual')),
  criado_em timestamptz default now()
);

alter table public.dias_nao_uteis enable row level security;

-- Leitura para qualquer usuário ativo: o cálculo da janela roda no cliente, web e
-- mobile. Escrita só pelos RPCs abaixo (gestor) e pelo worker (service role).
drop policy if exists dias_nao_uteis_select on public.dias_nao_uteis;
create policy dias_nao_uteis_select on public.dias_nao_uteis
  for select to authenticated using ((select public.app_usuario_ativo()));

create or replace function public.app_salvar_dia_nao_util(p jsonb)
returns public.dias_nao_uteis
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dia public.dias_nao_uteis;
  v_nome text := nullif(btrim(p ->> 'nome'), '');
begin
  if not public.app_gestor_comercial() then
    raise exception 'Só gestores editam o calendário de dias não úteis.' using errcode = '42501';
  end if;
  if (p ->> 'data') is null or v_nome is null then
    raise exception 'Informe a data e o nome do dia.' using errcode = '22023';
  end if;

  insert into public.dias_nao_uteis (data, nome, escopo, uf, municipio, origem)
  values ((p ->> 'data')::date, v_nome, coalesce(nullif(p ->> 'escopo', ''), 'empresa'),
          nullif(upper(btrim(p ->> 'uf')), ''), nullif(btrim(p ->> 'municipio'), ''), 'manual')
  on conflict (data) do update
    set nome = excluded.nome, escopo = excluded.escopo, uf = excluded.uf,
        municipio = excluded.municipio, origem = 'manual'
  returning * into v_dia;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (auth.uid(), 'funil.dia_nao_util_salvo', 'dias_nao_uteis', v_dia.data::text, p);

  return v_dia;
end;
$$;

create or replace function public.app_remover_dia_nao_util(p_data date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.app_gestor_comercial() then
    raise exception 'Só gestores editam o calendário de dias não úteis.' using errcode = '42501';
  end if;

  delete from public.dias_nao_uteis where data = p_data;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (auth.uid(), 'funil.dia_nao_util_removido', 'dias_nao_uteis', p_data::text,
          jsonb_build_object('data', p_data));
end;
$$;

revoke all on function public.app_salvar_dia_nao_util(jsonb) from public, anon;
revoke all on function public.app_remover_dia_nao_util(date) from public, anon;
grant execute on function public.app_salvar_dia_nao_util(jsonb) to authenticated, service_role;
grant execute on function public.app_remover_dia_nao_util(date) to authenticated, service_role;

-- ─── 5. O expediente ────────────────────────────────────────────────────────
-- Mora em `antecipacao_config` porque quem lê é quem tem o módulo do funil. A escrita
-- da tabela é de admin; esta chave é do gestor comercial, então tem RPC próprio.

insert into public.antecipacao_config (chave, valor)
values ('funil_novidades',
        '{"expediente_inicio": "09:00", "expediente_fim": "18:00", "minutos_para_avancar_marcador": 30}'::jsonb)
on conflict (chave) do nothing;

create or replace function public.app_salvar_funil_novidades_config(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inicio text := p ->> 'expediente_inicio';
  v_fim text := p ->> 'expediente_fim';
  v_min integer := (p ->> 'minutos_para_avancar_marcador')::integer;
  v_valor jsonb;
begin
  if not public.app_gestor_comercial() then
    raise exception 'Só gestores configuram o expediente do funil.' using errcode = '42501';
  end if;
  if v_inicio !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or v_fim !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Horário de expediente inválido. Use HH:MM.' using errcode = '22023';
  end if;
  if v_inicio >= v_fim then
    raise exception 'O expediente precisa terminar depois de começar.' using errcode = '22023';
  end if;
  if v_min is null or v_min < 1 or v_min > 720 then
    raise exception 'O marcador de visita avança entre 1 e 720 minutos.' using errcode = '22023';
  end if;

  v_valor := jsonb_build_object('expediente_inicio', v_inicio, 'expediente_fim', v_fim,
                                'minutos_para_avancar_marcador', v_min);

  insert into public.antecipacao_config (chave, valor, atualizado_por)
  values ('funil_novidades', v_valor, auth.uid())
  on conflict (chave) do update set valor = excluded.valor, atualizado_por = excluded.atualizado_por;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (auth.uid(), 'funil.novidades_config_salva', 'antecipacao_config', 'funil_novidades', v_valor);

  return v_valor;
end;
$$;

revoke all on function public.app_salvar_funil_novidades_config(jsonb) from public, anon;
grant execute on function public.app_salvar_funil_novidades_config(jsonb) to authenticated, service_role;

-- ─── 6. O selo "novo": o marcador de visita ─────────────────────────────────
-- Dois carimbos por usuário, sem tabela nova. O selo compara com o ANTERIOR, e não com
-- o atual: assim ele fica estável durante a sessão em vez de sumir no primeiro refresh.

alter table public.usuarios
  add column if not exists funil_visto_em timestamptz,
  add column if not exists funil_visto_anterior timestamptz;

create or replace function public.app_funil_marcar_visita(p_tudo boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_min integer;
  v_visto timestamptz;
  v_anterior timestamptz;
begin
  if v_uid is null then
    raise exception 'Sem sessão.' using errcode = '42501';
  end if;

  select (c.valor ->> 'minutos_para_avancar_marcador')::integer into v_min
    from public.antecipacao_config c where c.chave = 'funil_novidades';
  v_min := coalesce(v_min, 30);

  update public.usuarios u
     set funil_visto_anterior = case
           when p_tudo then now()
           when u.funil_visto_em is null or u.funil_visto_em < now() - make_interval(mins => v_min)
             then u.funil_visto_em
           else u.funil_visto_anterior
         end,
         funil_visto_em = case
           when p_tudo or u.funil_visto_em is null
                or u.funil_visto_em < now() - make_interval(mins => v_min) then now()
           else u.funil_visto_em
         end
   where u.id = v_uid
  returning u.funil_visto_em, u.funil_visto_anterior into v_visto, v_anterior;

  return jsonb_build_object('visto_em', v_visto, 'visto_anterior', v_anterior);
end;
$$;

revoke all on function public.app_funil_marcar_visita(boolean) from public, anon;
grant execute on function public.app_funil_marcar_visita(boolean) to authenticated;

-- ─── 7. O resumo da janela: contador da aba, card do Meu Dia e a tool ───────
-- SECURITY INVOKER: lê as views, que são `security_invoker` — o número é o da carteira
-- de quem pergunta, e o gestor vê tudo. O recorte é o do Kanban aberto sem filtro:
-- estágio aberto, operável, fornecedor que não foi descartado.
-- `execute ... using` e não SQL estático: com o instante como parâmetro genérico o
-- planejador estima um terço da tabela e larga o índice da novidade.
create or replace function public.funil_novidades_resumo(
  p_desde timestamptz,
  p_ate timestamptz default null,
  p_vendedor_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  r jsonb;
begin
  execute $q$
    with itens as (
      select tipo, valor, vendedor_id from public.funil_oportunidades_nf
       where novidade_em >= $1 and novidade_em < $2
         and operavel and not fornecedor_sem_interesse and not fornecedor_suprimido
         and estagio_funil in ('a_prospectar', 'em_prospeccao', 'em_negociacao', 'antecipacao_andamento')
         and ($3::uuid is null or vendedor_id = $3)
      union all
      select tipo, valor, vendedor_id from public.funil_oportunidades_preauth
       where novidade_em >= $1 and novidade_em < $2
         and operavel and not fornecedor_sem_interesse and not fornecedor_suprimido
         and estagio_funil in ('a_prospectar', 'em_prospeccao', 'em_negociacao', 'antecipacao_andamento')
         and ($3::uuid is null or vendedor_id = $3)
      union all
      select tipo, valor, vendedor_id from public.funil_oportunidades_titulo
       where novidade_em >= $1 and novidade_em < $2
         and operavel and not fornecedor_sem_interesse and not fornecedor_suprimido
         and estagio_funil in ('a_prospectar', 'em_prospeccao', 'em_negociacao', 'antecipacao_andamento')
         and ($3::uuid is null or vendedor_id = $3)
    )
    select jsonb_build_object(
      'total', (select count(*) from itens),
      'valor', (select coalesce(sum(valor), 0) from itens),
      'por_tipo', (select coalesce(jsonb_agg(jsonb_build_object('tipo', t.tipo, 'qtd', t.qtd, 'valor', t.valor)
                                             order by t.qtd desc), '[]'::jsonb)
                     from (select tipo, count(*) as qtd, coalesce(sum(valor), 0) as valor
                             from itens group by tipo) t),
      'por_vendedor', (select coalesce(jsonb_agg(jsonb_build_object(
                                'vendedor_id', c.vendedor_id, 'nome', v.nome, 'qtd', c.qtd, 'valor', c.valor)
                              order by c.qtd desc), '[]'::jsonb)
                         from (select vendedor_id, count(*) as qtd, coalesce(sum(valor), 0) as valor
                                 from itens group by vendedor_id) c
                         left join public.vendedores v on v.id = c.vendedor_id))
  $q$ into r using p_desde, coalesce(p_ate, 'infinity'::timestamptz), p_vendedor_id;
  return r;
end;
$$;

revoke all on function public.funil_novidades_resumo(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.funil_novidades_resumo(timestamptz, timestamptz, uuid) to authenticated, service_role;
