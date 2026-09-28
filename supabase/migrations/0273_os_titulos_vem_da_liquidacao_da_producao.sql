-- ============================================================================
-- 0273 — Os títulos vêm da liquidação da produção
--
-- ── A MUDANÇA ───────────────────────────────────────────────────────────────
-- A produção respondeu à requisição de 26/09 com `GET /api/v1/anticipation-settlements`
-- (docs/requisicao-titulos-plataforma-producao.md): um título por antecipação, com a
-- LIQUIDAÇÃO de verdade (`settlement.status`, `paidAt` = data do pagamento pelo sacado,
-- `source`), a matriz resolvida por eles (`contractor.headquartersTaxId`, 100%
-- preenchido), o valor pago ao cedente e o limite vigente.
--
-- Até aqui `titulos` era projetada de `antecipacoes` (0269c) e herdava dois defeitos:
--   • o pago continuava `BILLET_SWAPPED` — todo vencido parecia em aberto (a 0270 só
--     estimava, por grupo, quanto disso já tinha sido pago);
--   • a migração da plataforma (12/09) renumerou as operações: as antigas ficaram
--     congeladas com o id velho, e as anteriores a 20/07 nunca chegaram (as 15 vencidas
--     da Morro Verde, por exemplo).
-- O endpoint devolve o histórico inteiro (13,8 mil títulos, desde 2022), com o id novo e
-- `migrated`. O worker (`cobranca/atualizar-titulos`) normaliza (core,
-- `titulo-producao.ts`) e entrega em lotes a `app__cobranca_ingerir_titulos`.
--
-- ── O QUE SAI ───────────────────────────────────────────────────────────────
--   • a projeção a partir de `antecipacoes`: `app__cobranca_projetar_titulos` mantém o
--     nome (o worker antigo ainda a chama até o deploy) e passa a fazer SÓ o pós-sync —
--     quitação das cobranças, cobranças sem título ativo, SPE nova no bloqueio;
--   • as 1.3 mil linhas projetadas: nada as referencia (nenhuma cobrança, prazo ou
--     sinistro existe ainda), e o id delas (o da antecipação) não é o id do título;
--   • a FK para `antecipacoes`: o título migrado aponta para o id NOVO da antecipação,
--     que o nosso sync de antecipações não tem. O elo continua como número.
--
-- ── TRÊS NOMES QUE ENGANAM (ver titulo-producao.ts) ─────────────────────────
--   `grossValue` aqui é o BOLETO (nota − retenção): é o que vai em `valor_face`, e é o
--   que o sacado deve. A nota vai em `valor_nota`, a retenção em `retencao`.
-- ============================================================================

-- ─── A tabela ───────────────────────────────────────────────────────────────

alter table public.titulos drop constraint if exists titulos_antecipacao_id_externo_fkey;
-- "Um título = uma antecipação" (produção, 28/09) — mas uma unicidade que derruba o lote
-- inteiro no primeiro caso que a fuja é caro demais para garantir aqui.
alter table public.titulos drop constraint if exists titulos_antecipacao_id_externo_key;
create index if not exists titulos_antecipacao_idx on public.titulos (antecipacao_id_externo);

alter table public.titulos add column migrado boolean not null default false;
alter table public.titulos add column devedor_terceiro boolean not null default false;
alter table public.titulos add column valor_nota numeric(14, 2);
alter table public.titulos add column retencao numeric(14, 2);
alter table public.titulos add column desembolsado_em timestamptz;
alter table public.titulos add column liquidacao_fonte text;
alter table public.titulos add column liquidacao_pagamentos jsonb not null default '[]'::jsonb;
alter table public.titulos add column limite_documento text;
alter table public.titulos add column limite_atualizado_em timestamptz;
alter table public.titulos add column limite_expira_em date;
alter table public.titulos add column atualizado_producao_em timestamptz;

create index if not exists titulos_atualizado_producao_idx on public.titulos (atualizado_producao_em desc);

comment on table public.titulos is
  'Títulos cedidos, de GET /api/v1/anticipation-settlements (0273). Escrita só pelo worker, '
  'via app__cobranca_ingerir_titulos. valor_face = boleto (nota − retenção).';
comment on column public.titulos.liquidacao_fonte is
  'settlement.source: STARK_WEBHOOK | CNAB_RETURN | MANUAL | LEGACY.';

-- As linhas projetadas saem. Guardado: se alguém já tiver usado uma, ela fica.
delete from public.titulos t
where not exists (select 1 from public.cobranca_titulos ct where ct.titulo_id = t.id)
  and not exists (select 1 from public.apolice_prazos ap where ap.titulo_id = t.id)
  and not exists (select 1 from public.sinistro_titulos st where st.titulo_id = t.id);

-- ─── A ingestão ─────────────────────────────────────────────────────────────

/*
 * Um lote (até 200) já normalizado pelo core. A matriz é a da produção; na falta dela, a
 * raiz do CNPJ. A empresa do sacado é a do CNPJ da matriz e, sem cadastro dela, a holding
 * (a mesma regra da 0269c). `vencimento` só é escrito no insert: é o original, e a
 * produção também o trata como imutável.
 */
create or replace function public.app__cobranca_ingerir_titulos(p jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  with src as (
    select * from jsonb_to_recordset(p) as x(
      externo_id text, antecipacao_id_externo int, migrado boolean, numero text,
      sacado_cnpj text, sacado_nome text, sacado_matriz_cnpj text, devedor_terceiro boolean,
      cedente_cnpj text, cedente_nome text, cedente_matriz_cnpj text,
      valor_face numeric, valor_nota numeric, retencao numeric, valor_cedido numeric,
      desembolsado_em timestamptz, vencimento date, vencimento_prorrogado date,
      status text, status_producao text, pago_em date, valor_pago numeric,
      liquidacao_fonte text, liquidacao_pagamentos jsonb,
      limite_credito_vigente numeric, limite_documento text,
      limite_atualizado_em timestamptz, limite_expira_em date, atualizado_producao_em timestamptz)
  ),
  r as (
    select s.*,
           coalesce(s.sacado_matriz_cnpj, public.app__matriz_do_cnpj(s.sacado_cnpj)) as matriz,
           coalesce(s.cedente_matriz_cnpj, public.app__matriz_do_cnpj(s.cedente_cnpj)) as ced_matriz
    from src s
  ),
  up as (
    insert into public.titulos as t (
      externo_id, antecipacao_id_externo, migrado, numero,
      sacado_cnpj, sacado_nome, sacado_matriz_cnpj, sacado_empresa_id, devedor_terceiro,
      cedente_cnpj, cedente_nome, cedente_matriz_cnpj, cedente_empresa_id,
      valor_face, valor_nota, retencao, valor_cedido, desembolsado_em,
      vencimento, vencimento_prorrogado, status, status_producao,
      pago_em, pago_em_origem, valor_pago, liquidacao_fonte, liquidacao_pagamentos,
      limite_credito_vigente, limite_documento, limite_atualizado_em, limite_expira_em,
      atualizado_producao_em, sincronizado_em)
    select r.externo_id, r.antecipacao_id_externo, coalesce(r.migrado, false), r.numero,
           r.sacado_cnpj, r.sacado_nome, r.matriz,
           coalesce((select e.id from public.empresas e where e.cnpj = r.matriz),
                    public.app_holding_do_sacado(r.sacado_cnpj)),
           coalesce(r.devedor_terceiro, false),
           r.cedente_cnpj, r.cedente_nome, r.ced_matriz,
           coalesce((select e.id from public.empresas e where e.cnpj = r.cedente_cnpj),
                    (select e.id from public.empresas e where e.cnpj = r.ced_matriz)),
           r.valor_face, r.valor_nota, r.retencao, r.valor_cedido, r.desembolsado_em,
           r.vencimento, r.vencimento_prorrogado, r.status, r.status_producao,
           r.pago_em, case when r.pago_em is not null then 'producao' end, r.valor_pago,
           r.liquidacao_fonte, coalesce(r.liquidacao_pagamentos, '[]'::jsonb),
           r.limite_credito_vigente, r.limite_documento, r.limite_atualizado_em, r.limite_expira_em,
           r.atualizado_producao_em, now()
    from r
    on conflict (externo_id) do update set
      antecipacao_id_externo = excluded.antecipacao_id_externo,
      migrado = excluded.migrado,
      numero = excluded.numero,
      sacado_cnpj = excluded.sacado_cnpj,
      sacado_nome = excluded.sacado_nome,
      sacado_matriz_cnpj = excluded.sacado_matriz_cnpj,
      sacado_empresa_id = excluded.sacado_empresa_id,
      devedor_terceiro = excluded.devedor_terceiro,
      cedente_cnpj = excluded.cedente_cnpj,
      cedente_nome = excluded.cedente_nome,
      cedente_matriz_cnpj = excluded.cedente_matriz_cnpj,
      cedente_empresa_id = excluded.cedente_empresa_id,
      valor_face = excluded.valor_face,
      valor_nota = excluded.valor_nota,
      retencao = excluded.retencao,
      valor_cedido = excluded.valor_cedido,
      desembolsado_em = excluded.desembolsado_em,
      -- `vencimento` fica de fora: é o original (cl. 16900.20)
      vencimento_prorrogado = excluded.vencimento_prorrogado,
      status = excluded.status,
      status_producao = excluded.status_producao,
      pago_em = excluded.pago_em,
      pago_em_origem = excluded.pago_em_origem,
      valor_pago = excluded.valor_pago,
      liquidacao_fonte = excluded.liquidacao_fonte,
      liquidacao_pagamentos = excluded.liquidacao_pagamentos,
      limite_credito_vigente = excluded.limite_credito_vigente,
      limite_documento = excluded.limite_documento,
      limite_atualizado_em = excluded.limite_atualizado_em,
      limite_expira_em = excluded.limite_expira_em,
      atualizado_producao_em = excluded.atualizado_producao_em,
      sincronizado_em = now()
    returning 1
  )
  select count(*) into v_n from up;
  return v_n;
end;
$$;

revoke all on function public.app__cobranca_ingerir_titulos(jsonb) from public, anon, authenticated;
grant execute on function public.app__cobranca_ingerir_titulos(jsonb) to service_role;

-- ─── O pós-sync (o nome antigo, o trabalho novo) ────────────────────────────

create or replace function public.app__cobranca_projetar_titulos()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quitados int;
  v_cobrancas_quitadas int;
  v_bloqueios_novos int;
begin
  -- Quitação vinda da produção: agora é `settlement.status = PAID`, com a data do
  -- pagamento pelo sacado. Parcial NÃO quita (§11: quitação parcial não regulariza).
  with q as (
    update public.cobranca_titulos ct set
      situacao = 'quitado',
      quitado_em = coalesce(t.pago_em, current_date),
      quitado_origem = 'producao',
      valor_recebido = coalesce(t.valor_pago, ct.valor_face_snapshot)
    from public.titulos t
    where t.id = ct.titulo_id
      and t.status = 'pago'
      and ct.situacao in ('em_cobranca', 'acordado', 'protestado', 'sinistrado')
    returning ct.cobranca_id, ct.titulo_id, ct.valor_face_snapshot, ct.quitado_em
  ),
  ev as (
    insert into public.empresa_eventos (empresa_id, tipo, payload)
    select c.sacado_empresa_id, 'cobranca.titulo_quitado',
           jsonb_build_object(
             'titulo', 'Título quitado em cobrança',
             'resumo', coalesce(t.numero, t.externo_id) || ' — R$ ' ||
                       to_char(q.valor_face_snapshot, 'FM999G999G999G990D00') || ', pago em ' ||
                       to_char(q.quitado_em, 'DD/MM/YYYY') ||
                       coalesce(' (' || t.liquidacao_fonte || ')', '') || '.',
             'url', '/cobranca/cobrancas/' || c.id,
             'cobranca_id', c.id, 'codigo', c.codigo, 'titulo_id', t.id,
             'destinatarios', case when c.responsavel_id is null then '[]'::jsonb
                                   else jsonb_build_array(c.responsavel_id) end,
             'chave', 'cobranca.titulo_quitado:' || t.id)
    from q
    join public.cobrancas c on c.id = q.cobranca_id
    join public.titulos t on t.id = q.titulo_id
    returning 1
  )
  select count(*) into v_quitados from ev;

  with done as (
    update public.cobrancas c set estagio = 'quitada', encerrada_em = coalesce(c.encerrada_em, now()),
                                  motivo_encerramento = coalesce(c.motivo_encerramento, 'Todos os títulos quitados.')
    where c.estagio in ('notificada', 'em_negociacao', 'acordo_firmado', 'acordo_em_cumprimento', 'judicializada')
      and not exists (
        select 1 from public.cobranca_titulos ct
        where ct.cobranca_id = c.id and ct.situacao not in ('quitado', 'retirado'))
      and exists (select 1 from public.cobranca_titulos ct where ct.cobranca_id = c.id and ct.situacao = 'quitado')
    returning 1
  )
  select count(*) into v_cobrancas_quitadas from done;

  with novos as (
    insert into public.cobranca_bloqueios_cnpj (cnpj, sacado_matriz_cnpj, cobranca_id)
    select distinct on (t.sacado_cnpj) t.sacado_cnpj, b.sacado_matriz_cnpj, b.cobranca_id
    from public.titulos t
    join (select distinct on (sacado_matriz_cnpj) sacado_matriz_cnpj, cobranca_id
          from public.cobranca_bloqueios_cnpj order by sacado_matriz_cnpj, desde) b
      on b.sacado_matriz_cnpj = t.sacado_matriz_cnpj
    on conflict (cnpj) do nothing
    returning 1
  )
  select count(*) into v_bloqueios_novos from novos;

  return jsonb_build_object(
    'quitados', v_quitados, 'cobrancas_quitadas', v_cobrancas_quitadas, 'bloqueios_novos', v_bloqueios_novos);
end;
$$;

revoke all on function public.app__cobranca_projetar_titulos() from public, anon, authenticated;
grant execute on function public.app__cobranca_projetar_titulos() to service_role;

-- ─── Em aberto = aberto ou parcial, com o saldo ─────────────────────────────

drop view if exists public.cobranca_titulos_abertos;
create view public.cobranca_titulos_abertos
with (security_invoker = true) as
select
  t.*,
  -- Parcial deve o que falta; aberto deve o boleto inteiro.
  greatest(0, t.valor_face - coalesce(t.valor_pago, 0)) as saldo_em_aberto,
  greatest(0, current_date - t.vencimento) as dias_atraso,
  ct.cobranca_id as cobranca_ativa_id,
  c.codigo as cobranca_ativa_codigo,
  (t.sacado_cnpj = t.sacado_matriz_cnpj) as sacado_e_matriz
from public.titulos t
left join public.cobranca_titulos ct
  on ct.titulo_id = t.id and ct.situacao in ('em_cobranca', 'acordado', 'protestado', 'sinistrado')
left join public.cobrancas c on c.id = ct.cobranca_id
where t.status in ('aberto', 'parcial');

grant select on public.cobranca_titulos_abertos to authenticated;

-- ─── Criar cobrança aceita o parcial, pelo saldo ────────────────────────────

create or replace function public.app_cobranca_criar(p jsonb)
returns public.cobrancas
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_ids uuid[];
  v_grupos int;
  v_matriz text;
  v_empresa uuid;
  v_calc jsonb := public.app__cobranca_config('calculo');
  v_cfg jsonb := public.app__cobranca_config('cobranca');
  v_min int;
  v_c public.cobrancas;
  v_bad text;
begin
  perform public.app_cobranca_exige_modulo();

  select array_agg(distinct x::uuid) into v_ids from jsonb_array_elements_text(p -> 'titulo_ids') x;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'Selecione ao menos um título.' using errcode = '22023';
  end if;

  if (select count(*) from public.titulos where id = any (v_ids)) <> array_length(v_ids, 1) then
    raise exception 'Título não encontrado.' using errcode = 'P0002';
  end if;

  select count(distinct sacado_matriz_cnpj), min(sacado_matriz_cnpj)
    into v_grupos, v_matriz
  from public.titulos where id = any (v_ids);
  if v_grupos > 1 then
    raise exception 'A seleção tem títulos de grupos diferentes. Uma cobrança é sempre de um único sacado (matriz e SPEs).'
      using errcode = '22023';
  end if;

  select coalesce(t.numero, t.externo_id) into v_bad
  from public.titulos t where t.id = any (v_ids) and t.status not in ('aberto', 'parcial') limit 1;
  if v_bad is not null then
    raise exception 'O título % já foi pago na produção.', v_bad using errcode = '22023';
  end if;

  v_min := coalesce((v_cfg ->> 'dias_inicio_cobranca')::int, 15);
  select coalesce(t.numero, t.externo_id) into v_bad
  from public.titulos t where t.id = any (v_ids) and current_date - t.vencimento < v_min limit 1;
  if v_bad is not null then
    raise exception 'O título % ainda não tem % dias de atraso. Até lá, a cobrança é da plataforma de produção.', v_bad, v_min
      using errcode = '22023';
  end if;

  select coalesce(c.codigo, c.id::text) into v_bad
  from public.cobranca_titulos ct join public.cobrancas c on c.id = ct.cobranca_id
  where ct.titulo_id = any (v_ids) and ct.situacao in ('em_cobranca', 'acordado', 'protestado', 'sinistrado')
  limit 1;
  if v_bad is not null then
    raise exception 'Há título já em cobrança ativa (%).', v_bad using errcode = '23505';
  end if;

  select sacado_empresa_id into v_empresa
  from public.titulos where id = any (v_ids) and sacado_empresa_id is not null
  order by (sacado_cnpj = sacado_matriz_cnpj) desc limit 1;

  insert into public.cobrancas (
    codigo, sacado_matriz_cnpj, sacado_empresa_id, escopo_notificacao, notificar_matriz_cedente,
    responsavel_id, juros_mora_mes, multa_pct, honorarios_pct, indice_correcao, juros_pro_rata,
    data_base, observacoes, criada_por)
  values (
    public.app__cobranca_codigo('COB'), v_matriz, v_empresa,
    coalesce(nullif(p ->> 'escopo_notificacao', ''), 'sacado'),
    coalesce((p ->> 'notificar_matriz_cedente')::boolean, true),
    coalesce(nullif(p ->> 'responsavel_id', '')::uuid, v_ator),
    coalesce((p ->> 'juros_mora_mes')::numeric, (v_calc ->> 'juros_mora_mes')::numeric, 1),
    coalesce((p ->> 'multa_pct')::numeric, (v_calc ->> 'multa_pct')::numeric, 2),
    coalesce((p ->> 'honorarios_pct')::numeric, (v_calc ->> 'honorarios_pct')::numeric, 10),
    coalesce(nullif(p ->> 'indice_correcao', ''), v_calc ->> 'indice', 'igpm'),
    coalesce((p ->> 'juros_pro_rata')::boolean, (v_calc ->> 'juros_pro_rata')::boolean, true),
    coalesce(nullif(p ->> 'data_base', '')::date, current_date),
    nullif(btrim(p ->> 'observacoes'), ''),
    v_ator)
  returning * into v_c;

  -- O parcial entra pelo SALDO: é isso que se cobra, e é isso que vai na carta.
  insert into public.cobranca_titulos (
    cobranca_id, titulo_id, valor_face_snapshot, valor_cedido_snapshot, vencimento_snapshot,
    dias_atraso_snapshot, sacado_cnpj_snapshot, cedente_cnpj_snapshot)
  select v_c.id, t.id,
         case when t.status = 'parcial' then greatest(0, t.valor_face - coalesce(t.valor_pago, 0)) else t.valor_face end,
         t.valor_cedido, t.vencimento,
         greatest(0, current_date - t.vencimento), t.sacado_cnpj, t.cedente_cnpj
  from public.titulos t where t.id = any (v_ids);

  update public.apolice_prazos set cobranca_id = v_c.id where titulo_id = any (v_ids) and status = 'ativo';

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_c.sacado_empresa_id, 'cobranca.criada', jsonb_build_object(
    'titulo', 'Cobrança ' || v_c.codigo || ' criada',
    'resumo', array_length(v_ids, 1) || ' título(s) selecionado(s) para cobrança extrajudicial.',
    'url', '/cobranca/cobrancas/' || v_c.id,
    'cobranca_id', v_c.id, 'codigo', v_c.codigo), v_ator);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'cobranca.criada', 'cobrancas', v_c.id::text,
          jsonb_build_object('titulos', to_jsonb(v_ids), 'escopo', v_c.escopo_notificacao));

  return v_c;
end;
$$;

-- ─── Processo: o id novo da antecipação não está em `antecipacoes` ──────────

create or replace function public.app__cobranca_vincular_processo(p_cobranca_id uuid, p_cnj text, p_ator uuid)
returns public.cobrancas
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.cobrancas;
begin
  select * into v_c from public.cobrancas where id = p_cobranca_id for update;
  if v_c.id is null then
    raise exception 'Cobrança não encontrada.' using errcode = 'P0002';
  end if;
  if v_c.estagio in ('rascunho', 'cancelada') then
    raise exception 'Só uma cobrança já notificada vira processo.' using errcode = '22023';
  end if;
  if v_c.processo_cnj is not null and v_c.processo_cnj <> p_cnj then
    raise exception 'A cobrança já está vinculada ao processo %.', v_c.processo_cnj using errcode = '23505';
  end if;

  update public.processos set vinculo_cobranca_id = v_c.id where numero_cnj = p_cnj;

  -- `processo_operacoes.antecipacao_id_externo` tem FK para `antecipacoes`: o título
  -- migrado aponta para um id que não está lá, e então vai sem ele (a descrição identifica).
  insert into public.processo_operacoes (numero_cnj, antecipacao_id_externo, access_key, valor_original, vencimento, descricao, criado_por)
  select p_cnj,
         (select a.id_externo from public.antecipacoes a where a.id_externo = t.antecipacao_id_externo),
         (select nf.access_key from public.notas_fiscais nf where nf.access_key = t.nf_chave_acesso),
         ct.valor_face_snapshot, ct.vencimento_snapshot,
         'Título ' || coalesce(t.numero, t.externo_id) || ' — cobrança ' || v_c.codigo, p_ator
  from public.cobranca_titulos ct join public.titulos t on t.id = ct.titulo_id
  where ct.cobranca_id = v_c.id and ct.situacao not in ('quitado', 'retirado')
    and not exists (select 1 from public.processo_operacoes po
                    where po.numero_cnj = p_cnj
                      and po.descricao = 'Título ' || coalesce(t.numero, t.externo_id) || ' — cobrança ' || v_c.codigo);

  update public.cobrancas set
    processo_cnj = p_cnj,
    convertida_em_processo_em = coalesce(convertida_em_processo_em, now()),
    estagio = 'judicializada'
  where id = v_c.id
  returning * into v_c;

  perform public.app__cobranca_talvez_bloquear(v_c.id, p_ator);

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_c.sacado_empresa_id, 'cobranca.convertida_em_processo', jsonb_build_object(
    'titulo', 'Cobrança ' || v_c.codigo || ' convertida em processo',
    'resumo', 'Processo ' || p_cnj || '. Os títulos da cobrança passam a ser as operações cobradas do processo.',
    'url', '/cobranca/cobrancas/' || v_c.id,
    'cobranca_id', v_c.id, 'codigo', v_c.codigo, 'numero_cnj', p_cnj), p_ator);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (p_ator, 'cobranca.convertida_em_processo', 'cobrancas', v_c.id::text, jsonb_build_object('numero_cnj', p_cnj));

  return v_c;
end;
$$;

revoke all on function public.app__cobranca_vincular_processo(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.app__cobranca_vincular_processo(uuid, text, uuid) to service_role;

-- ─── Reconciliação: vira conferência, pelo saldo ────────────────────────────
/*
 * Com a liquidação vindo da produção, a conta da 0270 deixa de ser uma estimativa do
 * pago e passa a ser uma CONFERÊNCIA: o que temos em aberto contra o limite consumido.
 * Ela continua útil do mesmo jeito — `em_dia` agora aponta título que a produção ainda
 * não baixou —, e a tela e o relógio não mudam.
 */
create or replace function public.app_cobranca_reconciliacao(p_matrizes text[] default null)
returns table (
  sacado_matriz_cnpj text,
  aberto numeric,
  vencido numeric,
  a_vencer numeric,
  qtd_vencidos int,
  consumido numeric,
  consumido_em timestamptz,
  vencido_estimado numeric,
  situacao text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    perform public.app_cobranca_exige_modulo();
  end if;

  return query
  with grupos as (
    select t.sacado_matriz_cnpj,
           sum(greatest(0, t.valor_face - coalesce(t.valor_pago, 0))) as aberto,
           coalesce(sum(greatest(0, t.valor_face - coalesce(t.valor_pago, 0))) filter (where t.vencimento < current_date), 0) as vencido,
           coalesce(sum(greatest(0, t.valor_face - coalesce(t.valor_pago, 0))) filter (where t.vencimento >= current_date), 0) as a_vencer,
           (count(*) filter (where t.vencimento < current_date))::int as qtd_vencidos
    from public.titulos t
    where t.status in ('aberto', 'parcial')
      and (p_matrizes is null or t.sacado_matriz_cnpj = any (p_matrizes))
    group by t.sacado_matriz_cnpj
  ),
  plataforma as (
    select g.*,
           coalesce(co.consumed_limit, ap.consumed_limit) as consumido,
           case when co.consumed_limit is not null then co.atualizado_em end as consumido_em
    from grupos g
    left join public.clientes_onepay co on co.cnpj = g.sacado_matriz_cnpj
    left join lateral (
      select a.consumed_limit from public.analises_plataforma_atual a
      where a.cnpj = g.sacado_matriz_cnpj and a.consumed_limit is not null
      limit 1
    ) ap on true
  )
  select p.sacado_matriz_cnpj, p.aberto, p.vencido, p.a_vencer, p.qtd_vencidos,
         p.consumido, p.consumido_em,
         case when p.consumido is null then null
              else greatest(0, least(p.vencido, p.consumido - p.a_vencer)) end as vencido_estimado,
         case
           when p.vencido = 0 then 'sem_vencidos'
           when p.consumido is null then 'sem_dado'
           when greatest(0, least(p.vencido, p.consumido - p.a_vencer)) <= greatest(1000, 0.02 * p.vencido) then 'em_dia'
           when greatest(0, least(p.vencido, p.consumido - p.a_vencer)) >= p.vencido - greatest(1000, 0.02 * p.vencido) then 'confirma'
           else 'parcial'
         end as situacao
  from plataforma p;
end;
$$;

revoke all on function public.app_cobranca_reconciliacao(text[]) from public, anon;
grant execute on function public.app_cobranca_reconciliacao(text[]) to authenticated, service_role;
