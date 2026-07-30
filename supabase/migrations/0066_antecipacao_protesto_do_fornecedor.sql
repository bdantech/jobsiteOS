-- 0066 — Antecipação enxerga o protesto dos CNPJs que aparecem nas suas notas.
--
-- Mesmo bug LATENTE que a 0060 corrigiu para `mercado_universo`, agora em protestos —
-- e encontrado pelo mesmo caminho: expor um dado novo na tela obrigou a perguntar
-- quem consegue lê-lo.
--
-- `notas_funil` é `security_invoker` e a policy de `protestos_consultas` era
-- `app_tem_modulo('radar')`. Para o perfil Comercial (que tem só `antecipacao`) o
-- join com `protestos_atual` devolvia zero linhas, e a view faz
-- `coalesce(fpa.tem_protesto, false)`. O resultado não era "não sei": era
-- **`fornecedor_tem_protesto = false`** — um fornecedor com protesto aparecendo como
-- limpo, sem erro e sem aviso. A pior forma de errar, de novo.
--
-- Isso passou a doer de verdade agora que o Comercial pode COMPRAR a consulta do
-- funil: pagaria R$ 0,36 (SP) ou R$ 3,50 (nacional) e a tela continuaria dizendo a
-- mesma coisa que dizia antes.
--
-- A classificação nunca esteve errada — o worker roda com service role e ignora RLS.
-- O que estava errado era só o que a PESSOA via, que é o que decide a ligação.
--
-- O recorte é idêntico ao da 0060, de propósito: o cadastro e o protesto do mesmo
-- CNPJ têm de ser visíveis pelas mesmas pessoas, ou a ficha do fornecedor fica meio
-- preenchida. Uma policy só com `or`, porque `or` curto-circuita por linha e o
-- usuário de Radar não pode pagar o `exists`.

alter policy protestos_select on public.protestos_consultas
using (
  app_tem_modulo('radar')
  or (
    app_tem_modulo('antecipacao')
    and exists (
      select 1
      from public.notas_fiscais nf
      where nf.fornecedor_cnpj = protestos_consultas.cnpj
         or nf.sacado_cnpj = protestos_consultas.cnpj
    )
  )
);

comment on policy protestos_select on public.protestos_consultas is
  'Radar lê todos os protestos. Antecipação lê apenas os de CNPJs que aparecem em '
  'notas que a própria pessoa pode ler — o mínimo para a ficha do fornecedor e para '
  'o botão de consulta sob demanda mostrarem a verdade. Mesmo recorte da 0060.';

-- ─── `consultado_em` no funil ───────────────────────────────────────────────
-- Sem esta coluna, "sem protesto" e "nunca consultado" são a MESMA tela: os dois
-- chegam como `tem_protesto = false` e `valor = null`. A diferença é justamente a
-- que decide se vale gastar a consulta — e é o que impede pagar duas vezes pelo
-- mesmo CNPJ por não saber que já foi.

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

  fu.capital_social as fornecedor_capital_social,
  fu.situacao_cadastral as fornecedor_situacao_cadastral,
  fpa.valor_total as fornecedor_protesto_valor,
  fnf.ultimo_numero_nf as fornecedor_ultimo_numero_nf,

  nf.natureza_operacao,
  coalesce(nf.operavel_manual, nf.operavel) as operavel,
  nf.nao_operavel_motivo,

  su.camada as sacado_camada,

  -- ─── Nova (0066) ──────────────────────────────────────────────────────────
  -- NULL = nunca consultamos. É diferente de "consultado e limpo", e a tela precisa
  -- separar os dois para não vender uma ausência de dado como boa notícia.
  fpa.consultado_em as fornecedor_protesto_em

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

  left join lateral (
    select max(n2.numero::bigint) as ultimo_numero_nf
    from public.notas_fiscais n2
    where n2.fornecedor_cnpj = nf.fornecedor_cnpj
      and n2.tipo = 'NFe'
      and n2.numero ~ '^[0-9]{1,9}$'
  ) fnf on true;

alter view public.notas_funil set (security_invoker = on);

comment on column public.notas_funil.fornecedor_protesto_em is
  'Quando o protesto deste CNPJ foi consultado pela última vez. NULL = nunca — que '
  'NÃO é a mesma coisa que "sem protesto".';
