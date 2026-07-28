-- =============================================================================
-- 0057 — Antecipação: o lookup cadastral marcava "resolvido" sem gravar nada
--
-- `mercado_universo.cnaes_todos` e `.cnae_grupos` são GENERATED ALWAYS
-- (migration 0011). O job de lookup escrevia nas duas, e o Postgres rejeitava a
-- linha inteira com 428C9 — em 100% dos casos. O erro só ia para o log, e a fila
-- era marcada `resolvido_api` de qualquer forma.
--
-- Resultado observado em produção: 267 CNPJs (253 fornecedores + 14 sacados)
-- marcados como resolvidos, ZERO em mercado_universo. E, por estarem marcados,
-- nunca seriam re-tentados: uma falha de escrita virou invisibilidade permanente.
-- Os 14 sacados são R$ 1,53 mi em notas que não apareciam em "a prospectar".
--
-- O código foi corrigido em duas frentes (jobs/antecipacao/lookup-cadastral.ts):
--   1. grava `cnae_principal` + `cnaes_secundarios`; as derivadas saem sozinhas;
--   2. `gravarNoUniverso` devolve se GRAVOU, e a fila só é marcada resolvida
--      quando a linha de fato entrou. Falha vira `erro`, que é re-tentável.
--
-- Aqui: repõe na fila o que ficou órfão, e conserta um segundo problema que só
-- apareceu quando o primeiro foi investigado.
-- =============================================================================

-- ─── 1. Repõe na fila os falsos resolvidos ───────────────────────────────────
update cnpj_lookup_fila f
   set status = 'pendente',
       tentativas = 0,
       ultimo_erro = 'Reposto na fila: marcado resolvido em 2026-07, mas a gravação falhava (colunas geradas).',
       resolvido_em = null
 where f.status = 'resolvido_api'
   and not exists (select 1 from mercado_universo mu where mu.cnpj = f.cnpj);

-- ─── 2. "Não sabemos o CNAE" deixa de se passar por "não é construção" ───────
-- `cnae_grupos_de(null, null)` devolve '{}', não NULL. Então um sacado sem
-- cadastro nenhum chegava à view com `sacado_cnae_grupos = '{}'` — que é
-- indistinguível, para quem lê, de "conhecemos o CNAE e ele não é do recorte".
--
-- O FILTRO se comportava certo por acidente ('{}' não casa o overlap). O que era
-- inexprimível é a distinção que a TELA precisa: dizer "aguardando enriquecimento"
-- em vez de "fora do recorte". `nullif(..., '{}')` faz `sacado_cnae_grupos is null`
-- significar exatamente o que um leitor supõe.
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
    nullif(coalesce(su.cnae_grupos, cnae_grupos_de(se.cnae_principal, null)), '{}')
      as sacado_cnae_grupos,
    coalesce(
      nullif(coalesce(su.cnae_grupos, cnae_grupos_de(se.cnae_principal, null)), '{}')
        && array['41','42','43'],
      false
    ) as sacado_construcao,
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
