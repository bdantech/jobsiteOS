-- 0058 — Dados cadastrais do fornecedor como variáveis de faixa, e promoção
-- de fornecedor a partir do funil.
--
-- Três variáveis novas em `notas_funil`, todas sobre joins que a view JÁ FAZIA:
--
--   fornecedor_capital_social      ← mercado_universo (o lookup cadastral)
--   fornecedor_situacao_cadastral  ← mercado_universo
--   fornecedor_protesto_valor      ← protestos_atual (o booleano já existia)
--   fornecedor_ultimo_numero_nf    ← agregado sobre notas_fiscais
--
-- O último merece explicação. O `nNF` é SEQUENCIAL por emitente: o maior número
-- que já vimos de um fornecedor é uma estimativa de quantas notas ele emitiu no
-- total — inclusive as que nunca passam por nós. É o proxy de porte que o
-- capital social não dá.
--
-- ATENÇÃO: a versão abaixo mistura NFe e NFS-e e está ERRADA. Corrigida em 0059,
-- que é onde a explicação do erro está registrada.
--
-- `create or replace` em vez de drop/create: as três views de agregação
-- (antecipacao_fornecedores, _sacados, _sacados_a_prospectar) dependem desta, e
-- um drop cascade as levaria junto. Por isso as colunas novas entram NO FIM.

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

  -- LATERAL e não subquery agrupada: a leitura dominante do funil é PAGINADA
  -- (50 cards por coluna do Kanban), e ali um agregado sobre a tabela inteira
  -- seria pago a cada scroll. Assim são 50 index scans em
  -- notas_fiscais_fornecedor_faixa_idx, cujo prefixo é fornecedor_cnpj.
  left join lateral (
    select max(
      case
        when n2.numero ~ '^[0-9]{1,15}$' then n2.numero::bigint
      end
    ) as ultimo_numero_nf
    from public.notas_fiscais n2
    where n2.fornecedor_cnpj = nf.fornecedor_cnpj
  ) fnf on true;

alter view public.notas_funil set (security_invoker = on);

comment on view public.notas_funil is
  'A superfície única do funil de antecipação: uma linha por NF, com fornecedor, '
  'sacado, crédito e cadastro já resolvidos. É contra ela que o catálogo de faixas '
  'compila. security_invoker: quem decide as linhas são as policies de notas_fiscais.';

-- ─── Promoção de fornecedor ─────────────────────────────────────────────────
--
-- `app_promover_empresa` nasceu no Mercado, onde todo mundo que se promove é
-- construtora. No funil de antecipação quem se promove é FORNECEDOR, e gravar
-- 'construtora' num fabricante de esquadria envenena a base para sempre — a
-- pirâmide comercial, os segmentos e o TAM leem essa coluna.
--
-- `tipo` e `origem` passam a ser opcionais no payload, com o default de antes.
-- Nenhum chamador existente muda.
create or replace function public.app_promover_empresa(p jsonb)
returns public.empresas
language plpgsql
set search_path to ''
as $function$
declare
  v_universo public.mercado_universo;
  v_empresa public.empresas;
  v_ator uuid := auth.uid();
  v_tipo text := coalesce(p ->> 'tipo', 'construtora');
  v_origem text := coalesce(p ->> 'origem', 'mercado');
begin
  if v_tipo not in ('construtora', 'fornecedor') then
    raise exception 'Tipo inválido: %.', v_tipo using errcode = 'check_violation';
  end if;

  select * into v_universo from public.mercado_universo where cnpj = p ->> 'cnpj';

  if v_universo.cnpj is null then
    raise exception 'CNPJ não encontrado no universo.' using errcode = 'no_data_found';
  end if;

  if v_universo.empresa_id is not null then
    select * into v_empresa from public.empresas where id = v_universo.empresa_id;
    if v_empresa.id is not null then
      return v_empresa;
    end if;
  end if;

  select * into v_empresa from public.empresas where cnpj = v_universo.cnpj;

  if v_empresa.id is null then
    insert into public.empresas (
      cnpj, razao_social, nome_fantasia, tipo, estagio,
      uf, municipio, cnae_principal, porte,
      camada, grupo_id, is_spe, grafo_sefaz, origem
    )
    values (
      v_universo.cnpj,
      v_universo.razao_social,
      v_universo.nome_fantasia,
      v_tipo,
      'mercado',
      v_universo.uf,
      v_universo.municipio,
      v_universo.cnae_principal,
      v_universo.porte_rfb,
      v_universo.camada,
      v_universo.grupo_id,
      v_universo.is_spe,
      v_universo.grafo_sefaz,
      v_origem
    )
    returning * into v_empresa;
  else
    update public.empresas set
      camada      = coalesce(camada, v_universo.camada),
      grupo_id    = coalesce(grupo_id, v_universo.grupo_id),
      is_spe      = is_spe or v_universo.is_spe,
      grafo_sefaz = grafo_sefaz or v_universo.grafo_sefaz,
      origem      = coalesce(origem, v_origem)
    where id = v_empresa.id
    returning * into v_empresa;

    if v_empresa.id is null then
      raise exception 'Sem permissão para alterar esta empresa.' using errcode = '42501';
    end if;
  end if;

  update public.mercado_universo
  set empresa_id = v_empresa.id
  where cnpj = v_universo.cnpj;

  if not found then
    raise exception 'Não foi possível vincular a empresa ao universo.' using errcode = '42501';
  end if;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (
    v_empresa.id,
    'empresa.promovida',
    jsonb_build_object(
      'resumo', coalesce(v_empresa.razao_social, v_empresa.cnpj)
                || ' foi promovida do universo (camada ' || coalesce(v_universo.camada, '—') || ').',
      'camada', v_universo.camada,
      'origem', v_origem
    ),
    v_ator
  );

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'empresa.promovida', 'empresas', v_empresa.id::text, p);

  return v_empresa;
end;
$function$;
