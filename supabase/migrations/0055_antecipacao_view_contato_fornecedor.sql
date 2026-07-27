-- =============================================================================
-- 0055 — Antecipação: `contato_fornecedor` chega à view do funil
--
-- CREATE OR REPLACE VIEW só permite APPEND, então a definição de 0046 é repetida
-- por inteiro com a coluna nova no fim. A outbox lê o fallback de contato daqui.
-- =============================================================================

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
    nf.contato_fornecedor
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
