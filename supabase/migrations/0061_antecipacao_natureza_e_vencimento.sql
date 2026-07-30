-- =============================================================================
-- 0061 — Natureza da operação, notas não operáveis e vencimento lido da prosa
--
-- Três coisas que os dados reais desta base motivaram:
--
-- 1. `natureza_operacao` passa a ser COLUNA. Ela já era lida do XML pelo
--    visualizador tipo-DANFE, mas ficava só na tela; para decidir se a nota entra
--    no funil precisa ser filtrável, e para 6.077 notas ela existe no XML.
--
-- 2. `operavel` — remessa, devolução, retorno, transferência e comodato NÃO são
--    crédito a receber. Eram 460 notas, R$ 23,9 milhões, 213 delas com faixa
--    atribuída e portanto ativas no Kanban. Uma "REMESSA DE MERC. OU BEM PARA
--    DEMONSTRACAO" de R$ 1,6 milhão no topo da fila não é oportunidade: é alguém
--    ligando para oferecer antecipação de uma nota que ninguém deve.
--
--    A coluna é sinal COMPUTADO, como `faixa` — não estágio. Estágio é ação
--    humana; misturar os dois transformaria um sinal automático em opinião
--    editável (é a mesma disciplina do 0045). E `operavel_manual` existe para o
--    caso de a regra errar: a natureza real mistura os dois mundos em textos como
--    "VENDA MERC RECEBTERC SUBSTTRIBUT CONT SUBSTITUTO / REMESSA", e sem escape o
--    operador não teria como recuperar a nota.
--
-- 3. `vencimento_origem` ganha `xml_texto`. 70% da base caía em emissão + 30 —
--    99,5% das NFS-e, que não têm bloco de cobrança nenhum. A data estava escrita
--    na prosa da nota o tempo todo (`infCpl`, `xDescServ`), e agora é lida de lá.
-- =============================================================================

alter table notas_fiscais
  add column if not exists natureza_operacao text,
  add column if not exists operavel boolean not null default true,
  add column if not exists nao_operavel_motivo text,
  -- null = segue a regra; true/false = um humano decidiu e a regra não sobrescreve.
  add column if not exists operavel_manual boolean;

comment on column notas_fiscais.natureza_operacao is
  'natOp do XML da NFe. NFS-e não tem o campo e fica nula — ausência não torna a nota inoperável.';
comment on column notas_fiscais.operavel is
  'Computado da natureza. false = remessa/devolução/retorno/transferência/comodato: não é crédito a receber.';
comment on column notas_fiscais.operavel_manual is
  'Override humano. Quando não nulo, vence o cálculo — a regra lê a natureza em texto livre e erra às vezes.';

-- `vencimento_origem` agora aceita 'xml_texto' (lido da prosa da nota).
alter table notas_fiscais drop constraint if exists notas_fiscais_vencimento_origem_check;
alter table notas_fiscais add constraint notas_fiscais_vencimento_origem_check
  check (vencimento_origem is null
         or vencimento_origem in ('xml', 'endpoint', 'xml_texto', 'estimado'));

-- O funil filtra por isto; sem índice é varredura na tabela inteira a cada abertura.
create index if not exists notas_fiscais_operavel_idx
  on notas_fiscais (coalesce(operavel_manual, operavel))
  where coalesce(operavel_manual, operavel) = false;

-- ─── Backfill do que já está na base ────────────────────────────────────────
-- Extrai natOp do raw_xml guardado. O sync novo grava na entrada; isto resolve as
-- 12.516 notas que já chegaram. Idempotente: pode rodar de novo sem efeito.

update notas_fiscais
   set natureza_operacao = substring(raw_xml from '<natOp>(.*?)</natOp>')
 where raw_xml is not null
   and natureza_operacao is null
   and raw_xml like '%<natOp>%';

-- Mesma lista de termos de packages/core/src/antecipacao/natureza-operacao.ts.
-- Duplicada aqui de propósito, e só aqui: é um backfill de uma vez: o cálculo
-- corrente vive no core, em um lugar só, e é o que o sync usa.
with avaliada as (
  select access_key,
         lower(translate(coalesce(natureza_operacao, ''),
           'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
           'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')) as nat
    from notas_fiscais
   where natureza_operacao is not null
)
update notas_fiscais nf
   set operavel = false,
       nao_operavel_motivo = initcap(m.termo) || ' — natureza da operação não gera crédito a receber.'
  from (
    select a.access_key,
           (regexp_match(a.nat,
             'remessa|devolucao|devolvida|retorno|transferencia|comodato|emprestimo|bonificacao|bonif\.|doacao|brinde|amostra|consignacao|demonstracao|mostruario|vasilhame|sacaria'))[1] as termo
      from avaliada a
  ) m
 where nf.access_key = m.access_key
   and m.termo is not null
   and nf.operavel is true;

-- Nota não operável sai das faixas, pelo mesmo caminho que fornecedor suprimido:
-- faixa nula com motivo legível, para "sumiu do Kanban" ter sempre resposta.
update notas_fiscais
   set faixa = null,
       faixa_motivo = 'nao_operavel',
       faixa_alterada_em = now()
 where coalesce(operavel_manual, operavel) = false
   and faixa is not null;

-- ─── A view do funil ────────────────────────────────────────────────────────
-- Recriada (base: 0059) só para expor natureza/operavel. `create or replace`
-- exige a lista de colunas anterior intacta e na mesma ordem, por isso a
-- definição vem inteira. Nada mais mudou.

create or replace view public.notas_funil as
select
  nf.access_key,
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
  (nf.vencimento - current_date)::int as dias_para_vencimento,

  nf.fornecedor_cnpj,
  nf.fornecedor_nome,
  coalesce(nf.fornecedor_cadastrado, false) as fornecedor_cadastrado,
  nf.fornecedor_empresa_id,
  coalesce(fe.uf, fu.uf) as fornecedor_uf,
  coalesce(fpa.tem_protesto, false) as fornecedor_tem_protesto,
  (fco.cnpj is not null) as fornecedor_e_cliente_onepay,
  (fco.last_anticipation is not null or fe.ultima_antecipacao is not null) as fornecedor_ja_antecipou,
  case
    when not coalesce(nf.fornecedor_cadastrado, false) then 'aquisicao'
    when fco.last_anticipation is not null or fe.ultima_antecipacao is not null then 'recorrencia'
    else 'ativacao'
  end as fornecedor_tipagem,
  (fsup.valor is not null) as fornecedor_suprimido,

  nf.sacado_cnpj,
  nf.sacado_nome,
  coalesce(nf.sacado_cadastrado, false) as sacado_cadastrado,
  nf.sacado_empresa_id,
  nf.contato_sacado,
  coalesce(se.uf, su.uf) as sacado_uf,
  nf.credit_status as sacado_credito_status,
  nf.credit_role as sacado_credito_role,
  nf.credit_limite as sacado_limite,
  nf.credit_disponivel as sacado_limite_disponivel,
  (coalesce(nf.credit_disponivel, 0) >= nf.valor) as sacado_limite_cobre_nota,
  nf.contato_fornecedor,
  coalesce(su.cnae_principal, se.cnae_principal) as sacado_cnae_principal,
  nullif(coalesce(su.cnae_grupos, public.cnae_grupos_de(se.cnae_principal, null::text[])), '{}') as sacado_cnae_grupos,
  coalesce(
    nullif(coalesce(su.cnae_grupos, public.cnae_grupos_de(se.cnae_principal, null::text[])), '{}')
      && array['41', '42', '43'],
    false
  ) as sacado_construcao,
  coalesce(su.razao_social, se.razao_social) as sacado_razao_social,
  coalesce(su.municipio, se.municipio) as sacado_municipio,

  -- ─── Novas (0058) ─────────────────────────────────────────────────────────
  -- Só de `mercado_universo`: `empresas` não guarda dado da Receita, e duplicar
  -- capital social lá criaria duas verdades que divergem no dia seguinte.
  fu.capital_social as fornecedor_capital_social,
  fu.situacao_cadastral as fornecedor_situacao_cadastral,
  fpa.valor_total as fornecedor_protesto_valor,
  fnf.ultimo_numero_nf as fornecedor_ultimo_numero_nf,

  -- ─── Novas (0061) ─────────────────────────────────────────────────────────
  -- No fim da lista porque `create or replace view` não deixa inserir coluna no
  -- meio: as anteriores têm de manter nome e posição.
  nf.natureza_operacao,
  -- O override humano vence a regra: a natureza vem em texto livre e mistura os
  -- mundos ("VENDA MERC RECEBTERC ... / REMESSA"). Quem consulta vê a decisão final.
  coalesce(nf.operavel_manual, nf.operavel) as operavel,
  nf.nao_operavel_motivo

from public.notas_fiscais nf
  left join public.empresas fe on fe.id = nf.fornecedor_empresa_id
  left join public.empresas se on se.id = nf.sacado_empresa_id
  left join public.mercado_universo fu on fu.cnpj = nf.fornecedor_cnpj
  left join public.mercado_universo su on su.cnpj = nf.sacado_cnpj
  left join public.protestos_atual fpa on fpa.cnpj = nf.fornecedor_cnpj
  left join public.clientes_onepay fco on fco.cnpj = nf.fornecedor_cnpj
  left join public.supressao fsup
    on fsup.escopo = 'empresa'
   and fsup.valor = nf.fornecedor_cnpj
   and (fsup.expira_em is null or fsup.expira_em >= current_date)

  -- Só NFe, e no máximo 9 dígitos (o teto do `nNF` no schema). Ver 0059.
  --
  -- LATERAL e não subquery agrupada: a leitura dominante do funil é PAGINADA
  -- (50 cards por coluna do Kanban), e ali um agregado sobre a tabela inteira
  -- seria pago a cada scroll. Assim são 50 index scans em
  -- notas_fiscais_fornecedor_faixa_idx, cujo prefixo é fornecedor_cnpj.
  left join lateral (
    select max(n2.numero::bigint) as ultimo_numero_nf
    from public.notas_fiscais n2
    where n2.fornecedor_cnpj = nf.fornecedor_cnpj
      and n2.tipo = 'NFe'
      and n2.numero ~ '^[0-9]{1,9}$'
  ) fnf on true;

alter view public.notas_funil set (security_invoker = on);
