-- 0123 — Protestos consultados ANTES da análise proprietária (04j, ajuste).
--
-- ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
-- Protesto entra na análise por uma via indireta e fácil de esquecer: ele é fator do
-- scorecard (04d), o scorecard vira faixa, e a faixa é o TETO 5. Uma análise rodada sobre
-- um CNPJ que nunca teve protesto consultado NÃO sai "sem protesto" — sai com o fator
-- inavaliável, o que derruba a completude e pode empurrar o score para
-- `dados_insuficientes`, apagando o teto inteiro.
--
-- Ou seja: analisar antes de consultar produzia um limite pior por ausência de dado, e a
-- ausência não aparecia em lugar nenhum como causa.
--
-- ─── A MATRIZ É AUTOMÁTICA; AS SPEs SÃO PERGUNTADAS ─────────────────────────
-- Consulta de protesto é PAGA e por CNPJ. A matriz é uma só e sempre importa, então entra
-- sozinha (sujeita à janela de recência). As SPEs de um grupo podem ser dezenas, e quais
-- delas importam é julgamento — o mesmo corte por ano de criação que a ficha da empresa já
-- oferece. Automatizar essa escolha seria automatizar a fatura.

alter table public.analises_proprietarias
  add column if not exists protestos_opcoes jsonb,
  add column if not exists protestos_resultado jsonb;

comment on column public.analises_proprietarias.protestos_opcoes is
  'O que foi PEDIDO: { incluir_spes, ano_min, somente_afiancadas }.';

comment on column public.analises_proprietarias.protestos_resultado is
  'O que ACONTECEU: { consultados, custo, pulou_matriz_por_recencia, erro }. Separado do '
  'pedido de propósito — "pedi SPEs desde 2020" e "consultei 7 CNPJs por R$ 21,00" são '
  'perguntas diferentes, e a segunda é a que vira linha na fatura. Falha aqui NÃO derruba '
  'a análise: protesto é enriquecimento, e perder uma extração porque uma API de terceiro '
  'caiu seria trocar um problema por dois.';

-- ─── §2 Parâmetros v2: a janela de recência ─────────────────────────────────
-- Versão nova, nunca update: a v1 continua existindo e as análises feitas com ela
-- continuam reproduzíveis. A v2 é a v1 mais a chave `protestos`.

insert into public.analise_parametros (versao, definicao, nome, ativa)
select
  2,
  definicao || jsonb_build_object('protestos', jsonb_build_object(
    -- 90 dias: reconsultar uma matriz vista ontem é dinheiro no lixo; usar uma consulta
    -- de dois anos atrás é decidir crédito com informação velha.
    'recencia_dias', 90,
    'incluir_spes_padrao', false,
    'spes_anos_atras_padrao', 5
  )),
  'Protestos automáticos antes da análise',
  false
from public.analise_parametros where versao = 1
on conflict (versao) do nothing;

-- Em duas etapas: o índice parcial único recusa duas ativas ao mesmo tempo.
update public.analise_parametros set ativa = false where ativa and versao <> 2;
update public.analise_parametros set ativa = true where versao = 2;

-- ─── §3 O RPC passa a receber as opções de protesto ─────────────────────────

create or replace function public.app_rodar_analise_propria(p jsonb)
returns public.analises_proprietarias
language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_esteira public.analises_credito;
  v_linha public.analises_proprietarias;
  v_versao int;
  v_tipo text := coalesce(nullif(p ->> 'tipo', ''), 'inicial');
  v_gatilho text := coalesce(nullif(p ->> 'gatilho', ''), 'manual');
  v_aberta uuid;
  v_protestos jsonb := coalesce(p -> 'protestos', jsonb_build_object(
    'incluir_spes', false, 'ano_min', null, 'somente_afiancadas', false));
begin
  if not public.app_tem_modulo('credito') then
    raise exception 'Somente o perfil Crédito roda análise proprietária.' using errcode = '42501';
  end if;

  select * into v_esteira from public.analises_credito where id = (p ->> 'analise_credito_id')::uuid;
  if v_esteira.id is null then
    raise exception 'Análise da esteira não encontrada. Os documentos ficam nela.' using errcode = '23503';
  end if;

  select versao into v_versao from public.analise_parametros where ativa;
  if v_versao is null then
    raise exception 'Não há versão ativa de parâmetros de análise.' using errcode = '23502';
  end if;

  select id into v_aberta
  from public.analises_proprietarias
  where analise_credito_id = v_esteira.id and status in ('processando', 'aguardando_revisao')
  limit 1;
  if v_aberta is not null then
    raise exception 'Já existe uma análise em andamento para este sacado.' using errcode = '23505';
  end if;

  insert into public.analises_proprietarias (
    analise_credito_id, empresa_id, cnpj, tipo, gatilho, status, etapa, parametros_versao,
    criada_por, protestos_opcoes
  ) values (
    v_esteira.id, v_esteira.empresa_id, v_esteira.cnpj, v_tipo, v_gatilho,
    -- Nasce em `protestos`, e não em `extracao`: a consulta vem ANTES, para o score que
    -- alimenta o teto 5 já estar recalculado quando o cálculo rodar.
    'processando', 'protestos', v_versao, v_ator, v_protestos
  )
  returning * into v_linha;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_esteira.empresa_id, 'analise_propria.iniciada',
          jsonb_build_object('analise_propria_id', v_linha.id, 'cnpj', v_esteira.cnpj,
                             'tipo', v_tipo, 'gatilho', v_gatilho, 'protestos', v_protestos),
          v_ator);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'analise_propria.rodar', 'analises_proprietarias', v_linha.id::text,
          jsonb_build_object('analise_credito_id', v_esteira.id, 'tipo', v_tipo,
                             'protestos', v_protestos));

  return v_linha;
end;
$$;

revoke execute on function public.app_rodar_analise_propria(jsonb) from public, anon;
grant execute on function public.app_rodar_analise_propria(jsonb) to authenticated;
