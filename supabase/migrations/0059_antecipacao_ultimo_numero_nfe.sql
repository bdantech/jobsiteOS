-- 0059 — `fornecedor_ultimo_numero_nf` só conta NFe.
--
-- A versão de 0058 tirava o máximo sobre TODAS as notas do fornecedor, e isso
-- estava errado por um motivo que só aparece contra dado real: a NFS-e do padrão
-- nacional NÃO numera em sequência. O `nNFSe` é um identificador composto de 13
-- posições, e nesta base ele chega a 2.600.000.010.873 — treze ordens de grandeza
-- acima do maior `nNF` de NFe observado, que é 23.231.144.
--
-- O efeito prático seria pior do que um número feio na tela. A variável existe
-- para ser proxy de PORTE do fornecedor ("está na nota 180 mil, é operação grande,
-- provavelmente tem caixa e não antecipa"), então qualquer fornecedor que emitisse
-- uma única NFS-e passaria a parecer o maior emissor da base — e uma regra de faixa
-- do tipo "último número < 50.000" descartaria exatamente os fornecedores certos.
-- Ruído que se disfarça de sinal é pior do que ausência de sinal.
--
-- Agora: só `tipo = 'NFe'`, com o teto de 9 dígitos do schema. Fornecedor que só
-- emite serviço fica NULO, que é a resposta honesta — o número dele não mede
-- tamanho nenhum, e nulo é filtrável.

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
  fnf.ultimo_numero_nf as fornecedor_ultimo_numero_nf

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
