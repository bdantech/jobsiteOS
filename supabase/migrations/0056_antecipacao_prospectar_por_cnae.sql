-- =============================================================================
-- 0056 — Antecipação: "sacados a prospectar" passa a recortar por CNAE
--
-- A regra anterior (§5 do Prompt) era: sacado não cadastrado E fornecedor que já
-- antecipou. A segunda metade NÃO FUNCIONA na prática, e o motivo é estrutural:
-- `fornecedor_ja_antecipou` casa o CNPJ do FORNECEDOR contra `clientes_onepay`,
-- mas `clientes_onepay` só contém CONSTRUTORAS — que são os sacados, não os
-- fornecedores. O predicado é quase sempre falso, e a tela vinha vazia.
--
-- O recorte que de fato separa oportunidade de ruído é o CNAE do SACADO: uma
-- construtora (divisão 41, 42 ou 43) que recebe nota e não está na plataforma é
-- um lead; um posto de gasolina que recebeu uma nota é ruído. Sem esse filtro a
-- lista vira "todo CNPJ que já apareceu como destinatário".
--
-- ONDE O CNAE MORA: em `mercado_universo` — inclusive para os sacados que nunca
-- estiveram no recorte de construção do dump, porque o lookup cadastral (§3.1) os
-- insere lá. O sync já enfileira todo sacado desconhecido com motivo `sacado_nf`.
--
-- CONSEQUÊNCIA ASSUMIDA: sacado com CNAE ainda desconhecido NÃO aparece. É a
-- troca — menos ruído, e uma janela entre a nota chegar e o lookup responder. A
-- tela mostra quantos estão pendentes, para que a ausência não seja silenciosa.
--
-- `fornecedor_ja_antecipou` não sumiu: virou a coluna
-- `notas_de_quem_ja_antecipou`, um sinal de qualidade dentro da lista em vez de
-- um portão na entrada dela.
-- =============================================================================

-- notas_funil ganha o CNAE do SACADO (append; as views dependentes seguem válidas).
create or replace view notas_funil with (security_invoker = true) as
  select
    nf.access_key, nf.nf_id_externo, nf.tipo as tipo_nf, nf.direction, nf.numero, nf.serie,
    nf.valor, nf.emitida_em, nf.vencimento, nf.vencimento_origem, nf.status_sync, nf.parcelas,
    nf.faixa, nf.faixa_regra_versao, nf.faixa_motivo, nf.faixa_alterada_em,
    nf.estagio_funil, nf.estagio_alterado_em, nf.perda_motivo,
    nf.receita_esperada, nf.taxa_usada, nf.sincronizada_em,
    (nf.vencimento - current_date)::int as dias_para_vencimento,
    nf.fornecedor_cnpj, nf.fornecedor_nome,
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
    nf.sacado_cnpj, nf.sacado_nome,
    coalesce(nf.sacado_cadastrado, false) as sacado_cadastrado,
    nf.sacado_empresa_id, nf.contato_sacado,
    coalesce(se.uf, su.uf) as sacado_uf,
    nf.credit_status as sacado_credito_status,
    nf.credit_role as sacado_credito_role,
    nf.credit_limite as sacado_limite,
    nf.credit_disponivel as sacado_limite_disponivel,
    (coalesce(nf.credit_disponivel, 0) >= nf.valor) as sacado_limite_cobre_nota,
    nf.contato_fornecedor,
    coalesce(su.cnae_principal, se.cnae_principal) as sacado_cnae_principal,
    coalesce(su.cnae_grupos, cnae_grupos_de(se.cnae_principal, null)) as sacado_cnae_grupos,
    (coalesce(su.cnae_grupos, cnae_grupos_de(se.cnae_principal, null)) && array['41','42','43'])
      as sacado_construcao,
    coalesce(su.razao_social, se.razao_social) as sacado_razao_social,
    coalesce(su.municipio, se.municipio) as sacado_municipio
  from notas_fiscais nf
    left join empresas fe on fe.id = nf.fornecedor_empresa_id
    left join empresas se on se.id = nf.sacado_empresa_id
    left join mercado_universo fu on fu.cnpj = nf.fornecedor_cnpj
    left join mercado_universo su on su.cnpj = nf.sacado_cnpj
    left join protestos_atual fpa on fpa.cnpj = nf.fornecedor_cnpj
    left join clientes_onepay fco on fco.cnpj = nf.fornecedor_cnpj
    left join supressao fsup
      on fsup.escopo = 'empresa' and fsup.valor = nf.fornecedor_cnpj
     and (fsup.expira_em is null or fsup.expira_em >= current_date);

comment on column notas_funil.sacado_construcao is
  'CNAE do sacado na divisão 41/42/43. Vem de mercado_universo (inclusive dos que entraram pelo lookup cadastral) ou de empresas. NULL quando ainda não sabemos o CNAE — e null NÃO é false: a fila de lookup ainda vai responder.';

-- A regra refeita. DROP + CREATE porque a lista de colunas muda.
drop view antecipacao_sacados_a_prospectar;

create view antecipacao_sacados_a_prospectar with (security_invoker = true) as
  select
    f.sacado_cnpj,
    -- A razão social do cadastro ganha do nome que veio na NF: o da nota é o que o
    -- emitente digitou, e vem abreviado com frequência.
    max(coalesce(f.sacado_razao_social, f.sacado_nome)) as sacado_nome,
    (array_agg(f.sacado_empresa_id) filter (where f.sacado_empresa_id is not null))[1]
      as sacado_empresa_id,
    max(f.sacado_uf) as sacado_uf,
    max(f.sacado_municipio) as sacado_municipio,
    max(f.sacado_cnae_principal) as sacado_cnae_principal,
    count(*)::int as notas,
    sum(f.valor) as valor_agregado,
    count(distinct f.fornecedor_cnpj)::int as fornecedores,
    -- O antigo PORTÃO virou SINAL: quantas destas notas vêm de fornecedor que já
    -- antecipou. Zero não desqualifica o lead; alto o torna mais quente.
    count(*) filter (where f.fornecedor_ja_antecipou)::int as notas_de_quem_ja_antecipou,
    max(f.emitida_em) as ultima_nota_em,
    min(f.emitida_em) as primeira_nota_em
  from notas_funil f
  where not f.sacado_cadastrado
    and f.sacado_construcao
  group by f.sacado_cnpj;

grant select on antecipacao_sacados_a_prospectar to authenticated;

comment on view antecipacao_sacados_a_prospectar is
  'Construtoras (CNAE 41/42/43) que recebem NFs e NÃO estão na plataforma, ranqueadas por valor agregado. O recorte por CNAE é o que separa oportunidade de ruído: sem ele a lista vira todo CNPJ que já recebeu uma nota. Sacado com CNAE desconhecido NÃO aparece — a fila de lookup cadastral o resolve, e a tela mostra quantos estão pendentes.';
