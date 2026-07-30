-- 0065 — A camada (TAM/SAM/SOM) do sacado chega até "sacados a prospectar".
--
-- A lista responde "quem recebe nota e não está na plataforma", ordenada por valor.
-- O que ela não dizia é se aquele CNPJ já é alvo de Mercado. São perguntas que se
-- respondem juntas: uma construtora em SOM tem sinal de compra hoje e a abordagem é
-- outra; uma em `universo` recebe nota mas não passou em nenhuma regra, e vale
-- entender por quê antes de gastar uma ligação.
--
-- Na base atual, dos 279 sacados a prospectar: 149 `universo`, 81 SAM, 38 TAM,
-- 11 SOM. Nenhum fora de `mercado_universo` — o recorte por CNAE já garante isso,
-- porque é de lá que o CNAE vem.
--
-- RLS: nada muda. `notas_funil` é `security_invoker` e a policy de 0060 já libera,
-- para quem tem `antecipacao`, as linhas de `mercado_universo` cujo CNPJ aparece
-- numa nota que a pessoa pode ler. A camada é mais uma coluna DESSAS MESMAS linhas
-- — o recorte de 0060 é por linha, e ele continua valendo inteiro.

-- ─── notas_funil ────────────────────────────────────────────────────────────
-- Recriada por inteiro: `create or replace view` não deixa inserir coluna no meio,
-- então `sacado_camada` entra no FIM e todas as anteriores mantêm nome e posição.

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
  fu.capital_social as fornecedor_capital_social,
  fu.situacao_cadastral as fornecedor_situacao_cadastral,
  fpa.valor_total as fornecedor_protesto_valor,
  fnf.ultimo_numero_nf as fornecedor_ultimo_numero_nf,

  -- ─── Novas (0061) ─────────────────────────────────────────────────────────
  nf.natureza_operacao,
  coalesce(nf.operavel_manual, nf.operavel) as operavel,
  nf.nao_operavel_motivo,

  -- ─── Nova (0065) ──────────────────────────────────────────────────────────
  -- Só de `mercado_universo`, e sem coalesce com `empresas`: camada é decisão das
  -- regras de Mercado, não atributo do cadastro. NULL quer dizer "este CNPJ não
  -- está no universo", que é diferente de `universo` — este passou pelas regras e
  -- não subiu em nenhuma.
  su.camada as sacado_camada

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
  left join lateral (
    select max(n2.numero::bigint) as ultimo_numero_nf
    from public.notas_fiscais n2
    where n2.fornecedor_cnpj = nf.fornecedor_cnpj
      and n2.tipo = 'NFe'
      and n2.numero ~ '^[0-9]{1,9}$'
  ) fnf on true;

alter view public.notas_funil set (security_invoker = on);

comment on column public.notas_funil.sacado_camada is
  'Camada de Mercado do sacado (universo/tam/sam/som), de mercado_universo. NULL = '
  'CNPJ fora do universo; "universo" = está no universo e não subiu em nenhuma regra.';

-- ─── antecipacao_sacados_a_prospectar ───────────────────────────────────────
-- `max()` sobre um texto de quatro valores é seguro aqui porque o agrupamento é por
-- CNPJ e a camada é propriedade do CNPJ, não da nota: todas as linhas do grupo
-- carregam o mesmo valor.

create or replace view public.antecipacao_sacados_a_prospectar as
  select
    f.sacado_cnpj,
    max(coalesce(f.sacado_razao_social, f.sacado_nome)) as sacado_nome,
    (array_agg(f.sacado_empresa_id) filter (where f.sacado_empresa_id is not null))[1]
      as sacado_empresa_id,
    max(f.sacado_uf) as sacado_uf,
    max(f.sacado_municipio) as sacado_municipio,
    max(f.sacado_cnae_principal) as sacado_cnae_principal,
    count(*)::int as notas,
    sum(f.valor) as valor_agregado,
    count(distinct f.fornecedor_cnpj)::int as fornecedores,
    count(*) filter (where f.fornecedor_ja_antecipou)::int as notas_de_quem_ja_antecipou,
    max(f.emitida_em) as ultima_nota_em,
    min(f.emitida_em) as primeira_nota_em,

    -- No fim da lista, mesma razão de sempre: `create or replace` não insere no meio.
    max(f.sacado_camada) as sacado_camada
  from public.notas_funil f
  where not f.sacado_cadastrado
    and f.sacado_construcao
  group by f.sacado_cnpj;

alter view public.antecipacao_sacados_a_prospectar set (security_invoker = on);

comment on column public.antecipacao_sacados_a_prospectar.sacado_camada is
  'Camada de Mercado da construtora. Responde "este lead já é alvo de Mercado?" sem '
  'sair da tela — SOM tem sinal de compra hoje, universo recebe nota e não passou '
  'em nenhuma regra.';
