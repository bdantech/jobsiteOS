-- ============================================================================
-- 0269d — Cobrança: o ciclo da cobrança em RPCs
--
-- Toda escrita de `authenticated` passa por aqui. Cada RPC começa pela guarda do
-- módulo, escreve a linha + o evento (empresa_eventos) + o audit_log na MESMA
-- transação — três inserts do supabase-js seriam três transações, e uma queda
-- entre eles deixaria uma notificação enviada sem rastro no dossiê.
--
-- ── O AGRUPAMENTO É CALCULADO NO CORE E CONFERIDO AQUI ──────────────────────
-- `packages/core/src/cobranca/agrupamento.ts` decide quem recebe qual
-- notificação (§4) e é ele que tem os testes. Este lado não recalcula a regra: ele
-- confere as INVARIANTES de cada linha que chega (a matriz recebe todos; a
-- filial só os dela; cedente só com o escopo certo), porque a RPC é chamável
-- direto pelo PostgREST com qualquer payload, e uma carta errada vai para o
-- dossiê de sinistro.
-- ============================================================================

-- ─── Utilitários ────────────────────────────────────────────────────────────

create or replace function public.app__cobranca_codigo(p_prefixo text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ano int := extract(year from (now() at time zone 'America/Sao_Paulo'))::int;
  v_n int;
begin
  insert into public.cobranca_sequencias (prefixo, ano, ultimo)
  values (p_prefixo, v_ano, 1)
  on conflict (prefixo, ano) do update set ultimo = public.cobranca_sequencias.ultimo + 1
  returning ultimo into v_n;
  return p_prefixo || '-' || v_ano || '-' || lpad(v_n::text, 4, '0');
end;
$$;

create or replace function public.app__cobranca_config(p_chave text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select valor from public.cobranca_config where chave = p_chave), '{}'::jsonb);
$$;

revoke all on function public.app__cobranca_codigo(text) from public, anon, authenticated;
revoke all on function public.app__cobranca_config(text) from public, anon, authenticated;
grant execute on function public.app__cobranca_codigo(text) to service_role;
grant execute on function public.app__cobranca_config(text) to service_role;

-- ─── Bloqueio do grupo (§11) ────────────────────────────────────────────────

create or replace function public.app__cobranca_bloquear_grupo(p_cobranca_id uuid, p_ator uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.cobrancas;
  v_motivo text;
  v_novos int;
begin
  select * into v_c from public.cobrancas where id = p_cobranca_id;
  v_motivo := 'Em cobrança extrajudicial (' || coalesce(v_c.codigo, v_c.id::text) || ').';

  insert into public.cobranca_bloqueios_cnpj (cnpj, sacado_matriz_cnpj, cobranca_id)
  select g, v_c.sacado_matriz_cnpj, v_c.id
  from public.app__cobranca_cnpjs_do_grupo(v_c.sacado_matriz_cnpj) g
  where g ~ '^[0-9]{14}$'
  on conflict (cnpj) do nothing;
  get diagnostics v_novos = row_count;

  update public.empresas e set
    bloqueio_cobranca = true,
    bloqueio_cobranca_motivo = v_motivo,
    bloqueio_cobranca_em = now(),
    bloqueio_cobranca_cobranca_id = v_c.id
  where e.id in (select public.app__cobranca_empresas_do_grupo(v_c.sacado_matriz_cnpj))
    and not e.bloqueio_cobranca;

  -- Idempotente: a segunda cobrança do mesmo grupo não reanuncia o bloqueio.
  if v_novos > 0 then
    insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
    values (v_c.sacado_empresa_id, 'cobranca.sacado_bloqueado', jsonb_build_object(
      'titulo', 'Sacado bloqueado por cobrança',
      'resumo', 'O grupo entrou em cobrança extrajudicial: novas análises, operações e campanhas ficam suspensas até a regularização.',
      'url', '/cobranca/cobrancas/' || v_c.id,
      'cobranca_id', v_c.id, 'codigo', v_c.codigo, 'cnpjs_bloqueados', v_novos,
      'chave', 'cobranca.sacado_bloqueado:' || v_c.sacado_matriz_cnpj), p_ator);
  end if;
end;
$$;

/*
 * `estagio_que_bloqueia` (§13, default `notificada`) é um ponto numa ORDEM, não um
 * valor exato: uma cobrança configurada para bloquear em `em_negociacao` que pula
 * direto para `judicializada` também bloqueia. Chamado depois de toda mudança de
 * estágio que avança.
 */
create or replace function public.app__cobranca_talvez_bloquear(p_cobranca_id uuid, p_ator uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_estagio text;
  v_gatilho text := coalesce(public.app__cobranca_config('cobranca') ->> 'estagio_que_bloqueia', 'notificada');
  v_ordem constant text[] := array['rascunho', 'notificada', 'em_negociacao', 'acordo_firmado',
                                   'acordo_em_cumprimento', 'judicializada'];
begin
  select estagio into v_estagio from public.cobrancas where id = p_cobranca_id;
  if array_position(v_ordem, v_estagio) is not null
     and array_position(v_ordem, v_estagio) >= coalesce(array_position(v_ordem, v_gatilho), 2) then
    perform public.app__cobranca_bloquear_grupo(p_cobranca_id, p_ator);
  end if;
end;
$$;

revoke all on function public.app__cobranca_talvez_bloquear(uuid, uuid) from public, anon, authenticated;
grant execute on function public.app__cobranca_talvez_bloquear(uuid, uuid) to service_role;

revoke all on function public.app__cobranca_bloquear_grupo(uuid, uuid) from public, anon, authenticated;
grant execute on function public.app__cobranca_bloquear_grupo(uuid, uuid) to service_role;

-- A primeira saída de uma notificação é o que move a cobrança para `notificada`.
create or replace function public.app__cobranca_marcar_enviada(p_notificacao_id uuid, p_ator uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n public.cobranca_notificacoes;
  v_c public.cobrancas;
begin
  update public.cobranca_notificacoes set
    status = case when status in ('rascunho', 'pronta') then 'enviada' else status end,
    enviada_em = coalesce(enviada_em, now())
  where id = p_notificacao_id
  returning * into v_n;

  select * into v_c from public.cobrancas where id = v_n.cobranca_id for update;

  if v_c.estagio = 'rascunho' then
    update public.cobrancas set estagio = 'notificada', notificada_em = now() where id = v_c.id
    returning * into v_c;
  end if;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (coalesce(v_n.destinatario_empresa_id, v_c.sacado_empresa_id), 'cobranca.notificacao_enviada', jsonb_build_object(
    'titulo', case when v_n.rodada > 1 then 'Reiteração enviada' else 'Notificação extrajudicial enviada' end,
    'resumo', v_n.destinatario_razao_social || ' — ' || v_n.qtd_titulos || ' título(s), R$ ' ||
              to_char(v_n.valor_total, 'FM999G999G999G990D00') || '.',
    'url', '/cobranca/cobrancas/' || v_c.id,
    'cobranca_id', v_c.id, 'codigo', v_c.codigo, 'notificacao_id', v_n.id, 'rodada', v_n.rodada,
    'papel', v_n.papel), p_ator);

  perform public.app__cobranca_talvez_bloquear(v_c.id, p_ator);
end;
$$;

revoke all on function public.app__cobranca_marcar_enviada(uuid, uuid) from public, anon, authenticated;
grant execute on function public.app__cobranca_marcar_enviada(uuid, uuid) to service_role;

-- ─── §1 Criar a cobrança ────────────────────────────────────────────────────

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
  from public.titulos t where t.id = any (v_ids) and t.status <> 'aberto' limit 1;
  if v_bad is not null then
    raise exception 'O título % não está em aberto na produção.', v_bad using errcode = '22023';
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

  insert into public.cobranca_titulos (
    cobranca_id, titulo_id, valor_face_snapshot, valor_cedido_snapshot, vencimento_snapshot,
    dias_atraso_snapshot, sacado_cnpj_snapshot, cedente_cnpj_snapshot)
  select v_c.id, t.id, t.valor_face, t.valor_cedido, t.vencimento,
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

-- ─── Parâmetros, responsável, observações ───────────────────────────────────

create or replace function public.app_cobranca_atualizar(p jsonb)
returns public.cobrancas
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_c public.cobrancas;
begin
  perform public.app_cobranca_exige_modulo();

  select * into v_c from public.cobrancas where id = (p ->> 'id')::uuid for update;
  if v_c.id is null then
    raise exception 'Cobrança não encontrada.' using errcode = 'P0002';
  end if;

  if v_c.estagio <> 'rascunho' and (p ? 'escopo_notificacao' or p ? 'notificar_matriz_cedente') then
    raise exception 'O escopo só muda antes do primeiro envio.' using errcode = '22023';
  end if;

  update public.cobrancas set
    responsavel_id = case when p ? 'responsavel_id' then nullif(p ->> 'responsavel_id', '')::uuid else responsavel_id end,
    juros_mora_mes = case when p ? 'juros_mora_mes' then (p ->> 'juros_mora_mes')::numeric else juros_mora_mes end,
    multa_pct = case when p ? 'multa_pct' then (p ->> 'multa_pct')::numeric else multa_pct end,
    honorarios_pct = case when p ? 'honorarios_pct' then (p ->> 'honorarios_pct')::numeric else honorarios_pct end,
    indice_correcao = case when p ? 'indice_correcao' then p ->> 'indice_correcao' else indice_correcao end,
    juros_pro_rata = case when p ? 'juros_pro_rata' then (p ->> 'juros_pro_rata')::boolean else juros_pro_rata end,
    data_base = case when p ? 'data_base' then (p ->> 'data_base')::date else data_base end,
    escopo_notificacao = case when p ? 'escopo_notificacao' then p ->> 'escopo_notificacao' else escopo_notificacao end,
    notificar_matriz_cedente = case when p ? 'notificar_matriz_cedente' then (p ->> 'notificar_matriz_cedente')::boolean else notificar_matriz_cedente end,
    observacoes = case when p ? 'observacoes' then nullif(btrim(p ->> 'observacoes'), '') else observacoes end,
    valor_atualizado = case when p ? 'valor_atualizado' then (p ->> 'valor_atualizado')::numeric else valor_atualizado end,
    valor_atualizado_em = case when p ? 'valor_atualizado' then now() else valor_atualizado_em end
  where id = v_c.id
  returning * into v_c;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'cobranca.atualizada', 'cobrancas', v_c.id::text, p);

  return v_c;
end;
$$;

-- ─── §4/§5 Notificações de uma rodada ───────────────────────────────────────

create or replace function public.app_cobranca_salvar_notificacoes(p jsonb)
returns setof public.cobranca_notificacoes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_c public.cobrancas;
  v_rodada int := coalesce((p ->> 'rodada')::int, 1);
  v_max int;
  v_max_enviada boolean;
  v_n jsonb;
  v_ids uuid[];
  v_ativos uuid[];
  v_papel text;
  v_dest text;
  v_row public.cobranca_notificacoes;
  v_total numeric;
begin
  perform public.app_cobranca_exige_modulo();

  select * into v_c from public.cobrancas where id = (p ->> 'cobranca_id')::uuid for update;
  if v_c.id is null then
    raise exception 'Cobrança não encontrada.' using errcode = 'P0002';
  end if;
  if v_c.estagio in ('quitada', 'encerrada_perda', 'cancelada') then
    raise exception 'A cobrança está encerrada.' using errcode = '22023';
  end if;

  select coalesce(max(rodada), 0) into v_max
  from public.cobranca_notificacoes where cobranca_id = v_c.id;
  v_max_enviada := exists (
    select 1 from public.cobranca_notificacoes
    where cobranca_id = v_c.id and rodada = v_max and status not in ('rascunho', 'pronta'));

  -- A rodada em rascunho pode ser refeita; uma rodada já enviada é imutável, e o
  -- que se escreve depois dela é a próxima (§5: nunca sobrescreve).
  if not ((v_max = 0 and v_rodada = 1)
          or (v_rodada = v_max and not v_max_enviada)
          or (v_rodada = v_max + 1 and v_max_enviada)) then
    raise exception 'Rodada inválida: a última é % (%).', v_max,
      case when v_max_enviada then 'já enviada — gere a próxima' else 'ainda em rascunho — refaça-a' end
      using errcode = '22023';
  end if;
  if v_rodada = 1 and v_c.estagio <> 'rascunho' then
    raise exception 'A notificação inicial já saiu. Use "Nova rodada".' using errcode = '22023';
  end if;

  delete from public.cobranca_notificacoes
  where cobranca_id = v_c.id and rodada = v_rodada and status in ('rascunho', 'pronta');

  select array_agg(id) into v_ativos from public.cobranca_titulos
  where cobranca_id = v_c.id and situacao not in ('quitado', 'retirado');

  for v_n in select * from jsonb_array_elements(p -> 'notificacoes') loop
    v_papel := v_n ->> 'papel';
    v_dest := v_n ->> 'destinatario_cnpj';
    select array_agg(distinct x::uuid) into v_ids from jsonb_array_elements_text(v_n -> 'cobranca_titulo_ids') x;

    if coalesce(array_length(v_ids, 1), 0) = 0 or not (v_ids <@ v_ativos) then
      raise exception 'Notificação para % tem título fora da cobrança.', v_dest using errcode = '22023';
    end if;

    if v_papel = 'sacado_matriz' then
      if v_dest <> v_c.sacado_matriz_cnpj or not (v_ativos <@ v_ids) then
        raise exception 'A notificação da matriz leva TODOS os títulos do grupo.' using errcode = '22023';
      end if;
    elsif v_papel = 'sacado_filial' then
      if v_dest = v_c.sacado_matriz_cnpj or exists (
        select 1 from public.cobranca_titulos ct where ct.id = any (v_ids) and ct.sacado_cnpj_snapshot <> v_dest
      ) then
        raise exception 'A notificação da SPE/filial % leva só os títulos dela.', v_dest using errcode = '22023';
      end if;
    elsif v_papel in ('cedente_matriz', 'cedente_filial') then
      if v_c.escopo_notificacao <> 'sacado_e_cedente' then
        raise exception 'O escopo desta cobrança não notifica cedentes.' using errcode = '22023';
      end if;
      if exists (
        select 1 from public.cobranca_titulos ct join public.titulos t on t.id = ct.titulo_id
        where ct.id = any (v_ids)
          and case when v_papel = 'cedente_filial' then ct.cedente_cnpj_snapshot else t.cedente_matriz_cnpj end <> v_dest
      ) then
        raise exception 'A notificação do cedente % leva só os títulos dele.', v_dest using errcode = '22023';
      end if;
    else
      raise exception 'Papel de notificação inválido: %.', v_papel using errcode = '22023';
    end if;

    select sum(valor_face_snapshot) into v_total from public.cobranca_titulos where id = any (v_ids);

    insert into public.cobranca_notificacoes (
      cobranca_id, papel, destinatario_cnpj, destinatario_empresa_id, destinatario_razao_social,
      destinatario_endereco, modelo_id, rodada, valor_total, valor_total_atualizado, memoria_calculo,
      qtd_titulos, prazo_pagamento_dias, prazo_expira_em)
    values (
      v_c.id, v_papel, v_dest,
      coalesce(nullif(v_n ->> 'destinatario_empresa_id', '')::uuid,
               (select e.id from public.empresas e where e.cnpj = v_dest)),
      coalesce(nullif(btrim(v_n ->> 'destinatario_razao_social'), ''), v_dest),
      v_n -> 'destinatario_endereco',
      nullif(v_n ->> 'modelo_id', '')::uuid,
      v_rodada, v_total,
      nullif(v_n ->> 'valor_total_atualizado', '')::numeric,
      v_n -> 'memoria_calculo',
      array_length(v_ids, 1),
      coalesce((v_n ->> 'prazo_pagamento_dias')::int, 5),
      nullif(v_n ->> 'prazo_expira_em', '')::date)
    returning * into v_row;

    insert into public.cobranca_notificacao_titulos (notificacao_id, cobranca_titulo_id)
    select v_row.id, unnest(v_ids);

    return next v_row;
  end loop;

  if p ? 'valor_atualizado' then
    update public.cobrancas set valor_atualizado = (p ->> 'valor_atualizado')::numeric, valor_atualizado_em = now()
    where id = v_c.id;
  end if;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_c.sacado_empresa_id,
          case when v_rodada > 1 then 'cobranca.reiteracao' else 'cobranca.notificacao_gerada' end,
          jsonb_build_object(
            'titulo', case when v_rodada > 1 then 'Rodada ' || v_rodada || ' de reiteração gerada'
                           else 'Minutas de notificação geradas' end,
            'resumo', jsonb_array_length(p -> 'notificacoes') || ' notificação(ões) em rascunho.',
            'url', '/cobranca/cobrancas/' || v_c.id,
            'cobranca_id', v_c.id, 'codigo', v_c.codigo, 'rodada', v_rodada), v_ator);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'cobranca.notificacoes_salvas', 'cobrancas', v_c.id::text,
          jsonb_build_object('rodada', v_rodada, 'qtd', jsonb_array_length(p -> 'notificacoes')));
end;
$$;

-- Endereço e razão social editáveis ANTES do envio. Editar uma notificação pronta
-- descarta o PDF: o documento é regerado com o endereço novo.
create or replace function public.app_cobranca_editar_notificacao(p jsonb)
returns public.cobranca_notificacoes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_n public.cobranca_notificacoes;
begin
  perform public.app_cobranca_exige_modulo();

  select * into v_n from public.cobranca_notificacoes where id = (p ->> 'id')::uuid for update;
  if v_n.id is null then
    raise exception 'Notificação não encontrada.' using errcode = 'P0002';
  end if;
  if v_n.status not in ('rascunho', 'pronta') then
    raise exception 'O PDF enviado é imutável. Para mudar, gere uma nova rodada.' using errcode = '22023';
  end if;

  update public.cobranca_notificacoes set
    destinatario_endereco = case when p ? 'destinatario_endereco' then p -> 'destinatario_endereco' else destinatario_endereco end,
    destinatario_razao_social = case when p ? 'destinatario_razao_social'
      then coalesce(nullif(btrim(p ->> 'destinatario_razao_social'), ''), destinatario_razao_social) else destinatario_razao_social end,
    modelo_id = case when p ? 'modelo_id' then nullif(p ->> 'modelo_id', '')::uuid else modelo_id end,
    prazo_pagamento_dias = case when p ? 'prazo_pagamento_dias' then (p ->> 'prazo_pagamento_dias')::int else prazo_pagamento_dias end,
    prazo_expira_em = case when p ? 'prazo_expira_em' then (p ->> 'prazo_expira_em')::date else prazo_expira_em end,
    status = 'rascunho',
    documento_path = null,
    documento_hash = null
  where id = v_n.id
  returning * into v_n;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'cobranca.notificacao_editada', 'cobranca_notificacoes', v_n.id::text, p);

  return v_n;
end;
$$;

-- ─── §6.4 O aviso da apólice ────────────────────────────────────────────────

create or replace function public.app_cobranca_aceitar_aviso_apolice(p jsonb)
returns public.cobrancas
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_c public.cobrancas;
begin
  perform public.app_cobranca_exige_modulo();

  if coalesce((p ->> 'aceite')::boolean, false) is not true then
    raise exception 'É preciso aceitar o aviso de efeito na apólice.' using errcode = '22023';
  end if;

  update public.cobrancas set aceite_apolice_por = v_ator, aceite_apolice_em = now()
  where id = (p ->> 'cobranca_id')::uuid and aceite_apolice_em is null
  returning * into v_c;

  if v_c.id is null then
    select * into v_c from public.cobrancas where id = (p ->> 'cobranca_id')::uuid;
    if v_c.id is null then
      raise exception 'Cobrança não encontrada.' using errcode = 'P0002';
    end if;
    return v_c;
  end if;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_c.sacado_empresa_id, 'cobranca.aviso_apolice_aceito', jsonb_build_object(
    'titulo', 'Aviso de efeito na apólice aceito',
    'resumo', 'Colocar valores deste sacado em cobrança interrompe a cobertura de novos recebíveis (cl. 17700.20 b).',
    'url', '/cobranca/cobrancas/' || v_c.id,
    'cobranca_id', v_c.id, 'codigo', v_c.codigo), v_ator);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'cobranca.aviso_apolice_aceito', 'cobrancas', v_c.id::text,
          jsonb_build_object('texto', p ->> 'texto'));

  return v_c;
end;
$$;

-- ─── §4 Envio por e-mail e WhatsApp (fila do 05A) ───────────────────────────

create or replace function public.app_cobranca_enviar_notificacao(p jsonb)
returns setof public.cobranca_notificacao_entregas
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_n public.cobranca_notificacoes;
  v_c public.cobrancas;
  v_e jsonb;
  v_contato public.contatos;
  v_canal text;
  v_destino text;
  v_outbox uuid;
  v_row public.cobranca_notificacao_entregas;
  v_nome_arquivo text;
begin
  perform public.app_cobranca_exige_modulo();

  select * into v_n from public.cobranca_notificacoes where id = (p ->> 'notificacao_id')::uuid for update;
  if v_n.id is null then
    raise exception 'Notificação não encontrada.' using errcode = 'P0002';
  end if;
  if v_n.documento_path is null or v_n.status = 'rascunho' then
    raise exception 'Gere o PDF da notificação antes de enviar.' using errcode = '22023';
  end if;

  select * into v_c from public.cobrancas where id = v_n.cobranca_id;
  if v_c.aceite_apolice_em is null then
    raise exception 'Aceite o aviso de efeito na apólice antes do primeiro envio.' using errcode = '22023';
  end if;
  if v_c.estagio in ('quitada', 'encerrada_perda', 'cancelada') then
    raise exception 'A cobrança está encerrada.' using errcode = '22023';
  end if;

  if exists (select 1 from public.supressao s
             where s.escopo = 'empresa' and s.valor = v_n.destinatario_cnpj
               and (s.expira_em is null or s.expira_em >= current_date)) then
    raise exception 'O destinatário está na lista de supressão. Use correio com AR ou cartório.' using errcode = '22023';
  end if;

  v_nome_arquivo := 'notificacao-' || v_c.codigo || '-' || v_n.destinatario_cnpj || '-r' || v_n.rodada || '.pdf';

  for v_e in select * from jsonb_array_elements(p -> 'envios') loop
    v_canal := v_e ->> 'canal';
    if v_canal not in ('email', 'whatsapp') then
      raise exception 'Canal % não sai pelo sistema: registre a entrega manual.', v_canal using errcode = '22023';
    end if;

    select * into v_contato from public.contatos where id = (v_e ->> 'contato_id')::uuid;
    if v_contato.id is null then
      raise exception 'Contato não encontrado.' using errcode = 'P0002';
    end if;
    if v_n.destinatario_empresa_id is not null and v_contato.empresa_id <> v_n.destinatario_empresa_id then
      raise exception 'O contato % não é da empresa notificada.', v_contato.nome using errcode = '22023';
    end if;

    v_destino := case when v_canal = 'email' then lower(btrim(v_contato.email))
                      else coalesce(v_contato.whatsapp, v_contato.telefone) end;
    if nullif(v_destino, '') is null then
      raise exception 'O contato % não tem %.', v_contato.nome,
        case when v_canal = 'email' then 'e-mail' else 'WhatsApp' end using errcode = '22023';
    end if;
    if v_canal = 'email' and exists (
      select 1 from public.supressao s where s.escopo = 'email' and s.valor = v_destino
        and (s.expira_em is null or s.expira_em >= current_date)) then
      raise exception 'O e-mail % está na lista de supressão.', v_destino using errcode = '22023';
    end if;

    insert into public.mensagens_outbox (
      canal, destinatario, destinatario_contato_id, destinatario_ponto_focal, empresa_id,
      assunto, corpo, status, origem, criada_por, anexos, whatsapp_conta_id)
    values (
      v_canal, v_destino, v_contato.id, coalesce(v_contato.ponto_focal, false),
      v_n.destinatario_empresa_id,
      case when v_canal = 'email' then
        coalesce(nullif(btrim(p ->> 'assunto'), ''),
                 'Notificação extrajudicial — ' || v_c.codigo || ' — ' || v_n.destinatario_razao_social) end,
      coalesce(nullif(btrim(p ->> 'mensagem'), ''),
               'Prezados, segue em anexo notificação extrajudicial referente aos títulos em aberto (' ||
               v_c.codigo || '). Permanecemos à disposição.'),
      'aprovada', 'cobranca', v_ator,
      jsonb_build_array(jsonb_build_object(
        'nome', v_nome_arquivo, 'bucket', 'cobrancas', 'caminho', v_n.documento_path,
        'mime', 'application/pdf', 'sha256', v_n.documento_hash)),
      nullif(v_e ->> 'whatsapp_conta_id', '')::uuid)
    returning id into v_outbox;

    insert into public.cobranca_notificacao_entregas (
      notificacao_id, canal, destino, contato_id, outbox_id, status, criado_por)
    values (v_n.id, v_canal, v_destino, v_contato.id, v_outbox, 'pendente', v_ator)
    returning * into v_row;

    return next v_row;
  end loop;

  perform public.app__cobranca_marcar_enviada(v_n.id, v_ator);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'cobranca.notificacao_enviada', 'cobranca_notificacoes', v_n.id::text, p);
end;
$$;

-- ─── §4 Entrega manual: correio com AR, cartório de TD, entrega pessoal ─────
/*
 * O sistema gera o PDF pronto para impressão/protocolo; a pessoa devolve o código
 * de rastreio e o comprovante. Serve também para confirmar uma entrega já
 * registrada (AR voltou assinado, AR devolvido). É a prova que o item (g) do
 * dossiê exige — o sinistro bloqueia o envio enquanto ela faltar.
 */
create or replace function public.app_cobranca_registrar_entrega(p jsonb)
returns public.cobranca_notificacao_entregas
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_n public.cobranca_notificacoes;
  v_row public.cobranca_notificacao_entregas;
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_status text := coalesce(nullif(p ->> 'status', ''), 'enviado');
  v_comprovante text := nullif(btrim(p ->> 'comprovante_path'), '');
  v_c public.cobrancas;
begin
  perform public.app_cobranca_exige_modulo();

  if v_id is not null then
    select * into v_row from public.cobranca_notificacao_entregas where id = v_id for update;
    if v_row.id is null then
      raise exception 'Entrega não encontrada.' using errcode = 'P0002';
    end if;
    select * into v_n from public.cobranca_notificacoes where id = v_row.notificacao_id;
  else
    select * into v_n from public.cobranca_notificacoes where id = (p ->> 'notificacao_id')::uuid for update;
    if v_n.id is null then
      raise exception 'Notificação não encontrada.' using errcode = 'P0002';
    end if;
  end if;

  if v_comprovante is not null and v_comprovante !~ ('^' || v_n.cobranca_id::text || '/') then
    raise exception 'Comprovante fora da pasta desta cobrança.' using errcode = '42501';
  end if;

  select * into v_c from public.cobrancas where id = v_n.cobranca_id;

  if v_id is null then
    if coalesce(p ->> 'canal', '') not in ('correio_ar', 'cartorio_td', 'entrega_pessoal') then
      raise exception 'Canal manual inválido.' using errcode = '22023';
    end if;
    if v_n.documento_path is null then
      raise exception 'Gere o PDF da notificação antes de registrar a entrega.' using errcode = '22023';
    end if;
    if v_c.aceite_apolice_em is null then
      raise exception 'Aceite o aviso de efeito na apólice antes do primeiro envio.' using errcode = '22023';
    end if;

    insert into public.cobranca_notificacao_entregas (
      notificacao_id, canal, destino, codigo_rastreio, comprovante_path, status,
      enviado_em, confirmado_em, observacao, criado_por)
    values (
      v_n.id, p ->> 'canal', nullif(btrim(p ->> 'destino'), ''), nullif(btrim(p ->> 'codigo_rastreio'), ''),
      v_comprovante, v_status,
      coalesce(nullif(p ->> 'enviado_em', '')::timestamptz, now()),
      case when v_status in ('entregue', 'recusado', 'devolvido') then coalesce(nullif(p ->> 'confirmado_em', '')::timestamptz, now()) end,
      nullif(btrim(p ->> 'observacao'), ''), v_ator)
    returning * into v_row;

    perform public.app__cobranca_marcar_enviada(v_n.id, v_ator);
  else
    update public.cobranca_notificacao_entregas set
      status = v_status,
      codigo_rastreio = coalesce(nullif(btrim(p ->> 'codigo_rastreio'), ''), codigo_rastreio),
      comprovante_path = coalesce(v_comprovante, comprovante_path),
      confirmado_em = case when v_status in ('entregue', 'recusado', 'devolvido')
                           then coalesce(nullif(p ->> 'confirmado_em', '')::timestamptz, confirmado_em, now()) else confirmado_em end,
      observacao = coalesce(nullif(btrim(p ->> 'observacao'), ''), observacao)
    where id = v_row.id
    returning * into v_row;
  end if;

  if v_row.status = 'entregue' then
    update public.cobranca_notificacoes set status = 'entregue' where id = v_n.id and status = 'enviada';
    insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
    values (coalesce(v_n.destinatario_empresa_id, v_c.sacado_empresa_id), 'cobranca.notificacao_entregue', jsonb_build_object(
      'titulo', 'Notificação entregue',
      'resumo', v_n.destinatario_razao_social || ' — ' || replace(v_row.canal, '_', ' ') ||
                coalesce(' (' || v_row.codigo_rastreio || ')', '') || '.',
      'url', '/cobranca/cobrancas/' || v_c.id,
      'cobranca_id', v_c.id, 'codigo', v_c.codigo, 'notificacao_id', v_n.id,
      'destinatarios', case when v_c.responsavel_id is null then '[]'::jsonb else jsonb_build_array(v_c.responsavel_id) end),
      v_ator);
  elsif v_row.status in ('devolvido', 'recusado') then
    insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
    values (coalesce(v_n.destinatario_empresa_id, v_c.sacado_empresa_id), 'cobranca.notificacao_devolvida', jsonb_build_object(
      'titulo', 'Notificação devolvida',
      'resumo', v_n.destinatario_razao_social || ' — ' || replace(v_row.canal, '_', ' ') ||
                '. Confira o endereço e reenvie.',
      'url', '/cobranca/cobrancas/' || v_c.id,
      'cobranca_id', v_c.id, 'codigo', v_c.codigo, 'notificacao_id', v_n.id,
      'destinatarios', case when v_c.responsavel_id is null then '[]'::jsonb else jsonb_build_array(v_c.responsavel_id) end),
      v_ator);
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'cobranca.entrega_registrada', 'cobranca_notificacao_entregas', v_row.id::text, p);

  return v_row;
end;
$$;

-- ─── §12 Estágio ────────────────────────────────────────────────────────────

create or replace function public.app_cobranca_mover_estagio(p jsonb)
returns public.cobrancas
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_c public.cobrancas;
  v_de text;
  v_para text := p ->> 'estagio';
  v_motivo text := nullif(btrim(p ->> 'motivo'), '');
begin
  perform public.app_cobranca_exige_modulo();

  select * into v_c from public.cobrancas where id = (p ->> 'cobranca_id')::uuid for update;
  if v_c.id is null then
    raise exception 'Cobrança não encontrada.' using errcode = 'P0002';
  end if;
  v_de := v_c.estagio;

  /*
   * O que NÃO se move por aqui, e por quê:
   *   notificada       é o envio que move (a notificação é o ato, não o card)
   *   acordo_firmado   é o upload do acordo assinado que move
   *   judicializada    é a conversão em processo que move
   * Um arrasto de card que pulasse esses atos produziria um dossiê sem a prova.
   */
  if v_para in ('notificada', 'acordo_firmado', 'judicializada', 'rascunho') then
    raise exception 'Esse estágio é consequência de um ato (envio, acordo assinado ou processo), não de um movimento.'
      using errcode = '22023';
  end if;
  if v_de in ('quitada', 'encerrada_perda', 'cancelada') then
    raise exception 'A cobrança está encerrada.' using errcode = '22023';
  end if;
  if v_para = 'em_negociacao' and v_de = 'rascunho' then
    raise exception 'Envie a notificação antes de negociar.' using errcode = '22023';
  end if;
  if v_para = 'acordo_em_cumprimento' and v_de <> 'acordo_firmado' then
    raise exception 'Só um acordo firmado entra em cumprimento.' using errcode = '22023';
  end if;
  if v_para = 'quitada' and exists (
    select 1 from public.cobranca_titulos where cobranca_id = v_c.id and situacao not in ('quitado', 'retirado')) then
    raise exception 'Há títulos sem quitação. Registre a quitação de cada um antes.' using errcode = '22023';
  end if;
  if v_para = 'cancelada' and v_de <> 'rascunho' then
    raise exception 'Depois do primeiro envio a cobrança não se cancela: encerre-a com motivo.' using errcode = '22023';
  end if;
  if v_para = 'encerrada_perda' and v_motivo is null then
    raise exception 'Informe o motivo do encerramento.' using errcode = '22023';
  end if;

  update public.cobrancas set
    estagio = v_para,
    encerrada_em = case when v_para in ('quitada', 'encerrada_perda', 'cancelada') then now() else encerrada_em end,
    motivo_encerramento = case when v_para in ('quitada', 'encerrada_perda', 'cancelada') then coalesce(v_motivo, motivo_encerramento) else motivo_encerramento end
  where id = v_c.id
  returning * into v_c;

  perform public.app__cobranca_talvez_bloquear(v_c.id, v_ator);

  -- Cancelar solta os títulos: eles podem entrar em outra cobrança.
  if v_para = 'cancelada' then
    update public.cobranca_titulos set situacao = 'retirado' where cobranca_id = v_c.id and situacao = 'em_cobranca';
    update public.apolice_prazos set cobranca_id = null where cobranca_id = v_c.id;
  end if;

  if v_para in ('quitada', 'encerrada_perda', 'cancelada') then
    insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
    values (v_c.sacado_empresa_id, 'cobranca.encerrada', jsonb_build_object(
      'titulo', 'Cobrança ' || v_c.codigo || ' encerrada',
      'resumo', case v_para when 'quitada' then 'Quitada.' when 'cancelada' then 'Cancelada antes do envio.'
                            else 'Encerrada com perda: ' || coalesce(v_motivo, '') end,
      'url', '/cobranca/cobrancas/' || v_c.id,
      'cobranca_id', v_c.id, 'codigo', v_c.codigo, 'estagio', v_para), v_ator);
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'cobranca.estagio_alterado', 'cobrancas', v_c.id::text,
          jsonb_build_object('de', v_de, 'para', v_para, 'motivo', v_motivo));

  return v_c;
end;
$$;

-- ─── Títulos dentro da cobrança ─────────────────────────────────────────────

create or replace function public.app_cobranca_quitar_titulo(p jsonb)
returns public.cobranca_titulos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_ct public.cobranca_titulos;
  v_c public.cobrancas;
  v_t public.titulos;
  v_valor numeric := nullif(p ->> 'valor_recebido', '')::numeric;
begin
  perform public.app_cobranca_exige_modulo();

  select * into v_ct from public.cobranca_titulos where id = (p ->> 'id')::uuid for update;
  if v_ct.id is null then
    raise exception 'Título não encontrado nesta cobrança.' using errcode = 'P0002';
  end if;
  if v_ct.situacao in ('quitado', 'retirado') then
    raise exception 'O título já está %.', v_ct.situacao using errcode = '22023';
  end if;
  if v_valor is not null and v_valor <= 0 then
    raise exception 'Valor recebido inválido.' using errcode = '22023';
  end if;

  select * into v_c from public.cobrancas where id = v_ct.cobranca_id;
  select * into v_t from public.titulos where id = v_ct.titulo_id;

  update public.cobranca_titulos set
    situacao = 'quitado',
    quitado_em = coalesce(nullif(p ->> 'quitado_em', '')::date, current_date),
    quitado_origem = 'manual',
    valor_recebido = coalesce(v_valor, valor_face_snapshot)
  where id = v_ct.id
  returning * into v_ct;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_c.sacado_empresa_id, 'cobranca.titulo_quitado', jsonb_build_object(
    'titulo', 'Título quitado em cobrança',
    'resumo', coalesce(v_t.numero, v_t.externo_id) || ' — R$ ' ||
              to_char(v_ct.valor_recebido, 'FM999G999G999G990D00') || ' recebidos em ' ||
              to_char(v_ct.quitado_em, 'DD/MM/YYYY') || ' (registro manual).',
    'url', '/cobranca/cobrancas/' || v_c.id,
    'cobranca_id', v_c.id, 'codigo', v_c.codigo, 'titulo_id', v_t.id,
    'destinatarios', case when v_c.responsavel_id is null then '[]'::jsonb else jsonb_build_array(v_c.responsavel_id) end,
    'chave', 'cobranca.titulo_quitado:' || v_t.id), v_ator);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'cobranca.titulo_quitado', 'cobranca_titulos', v_ct.id::text, p);

  return v_ct;
end;
$$;

create or replace function public.app_cobranca_retirar_titulo(p jsonb)
returns public.cobranca_titulos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_ct public.cobranca_titulos;
  v_c public.cobrancas;
begin
  perform public.app_cobranca_exige_modulo();

  select * into v_ct from public.cobranca_titulos where id = (p ->> 'id')::uuid for update;
  if v_ct.id is null then
    raise exception 'Título não encontrado nesta cobrança.' using errcode = 'P0002';
  end if;
  select * into v_c from public.cobrancas where id = v_ct.cobranca_id;
  if v_c.estagio <> 'rascunho' then
    raise exception 'Depois do envio, um título só sai da cobrança por quitação.' using errcode = '22023';
  end if;
  if (select count(*) from public.cobranca_titulos where cobranca_id = v_c.id and situacao <> 'retirado') <= 1 then
    raise exception 'A cobrança ficaria sem títulos. Cancele-a.' using errcode = '22023';
  end if;

  update public.cobranca_titulos set situacao = 'retirado' where id = v_ct.id returning * into v_ct;
  -- as minutas em rascunho apontavam para ele; refazer é regerar
  delete from public.cobranca_notificacoes where cobranca_id = v_c.id and status in ('rascunho', 'pronta');

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'cobranca.titulo_retirado', 'cobranca_titulos', v_ct.id::text, p);

  return v_ct;
end;
$$;

create or replace function public.app_cobranca_registrar_interacao(p jsonb)
returns public.cobranca_interacoes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_row public.cobranca_interacoes;
  v_c public.cobrancas;
begin
  perform public.app_cobranca_exige_modulo();

  select * into v_c from public.cobrancas where id = (p ->> 'cobranca_id')::uuid;
  if v_c.id is null then
    raise exception 'Cobrança não encontrada.' using errcode = 'P0002';
  end if;

  insert into public.cobranca_interacoes (cobranca_id, tipo, resumo, usuario_id, ocorrida_em)
  values (v_c.id, p ->> 'tipo', btrim(p ->> 'resumo'), v_ator,
          coalesce(nullif(p ->> 'ocorrida_em', '')::timestamptz, now()))
  returning * into v_row;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_c.sacado_empresa_id, 'cobranca.contato_registrado', jsonb_build_object(
    'titulo', 'Contato de cobrança registrado',
    'resumo', left(v_row.resumo, 280),
    'url', '/cobranca/cobrancas/' || v_c.id,
    'cobranca_id', v_c.id, 'codigo', v_c.codigo, 'tipo_contato', v_row.tipo), v_ator);

  return v_row;
end;
$$;

-- ─── §11 Regularização (gestor) ─────────────────────────────────────────────

create or replace function public.app_cobranca_regularizar_sacado(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_matriz text := p ->> 'sacado_matriz_cnpj';
  v_pendentes int;
  v_protestos int;
  v_restaurar boolean := coalesce((public.app__cobranca_config('regularizacao') ->> 'restaurar_limite_automaticamente')::boolean, false);
  v_pago_em date;
  v_volta date;
  v_empresa uuid;
  v_prazos int;
begin
  perform public.app_cobranca_exige_gestor();

  if not exists (select 1 from public.cobranca_bloqueios_cnpj where sacado_matriz_cnpj = v_matriz)
     and not exists (select 1 from public.empresas where cnpj = v_matriz and bloqueio_cobranca) then
    raise exception 'Este sacado não está bloqueado.' using errcode = '22023';
  end if;

  -- Quitação parcial não regulariza (§11).
  select count(*) into v_pendentes
  from public.cobranca_titulos ct join public.cobrancas c on c.id = ct.cobranca_id
  where c.sacado_matriz_cnpj = v_matriz
    and c.estagio not in ('cancelada')
    and ct.situacao not in ('quitado', 'retirado');
  if v_pendentes > 0 then
    raise exception 'Ainda há % título(s) sem quitação nas cobranças deste grupo.', v_pendentes using errcode = '22023';
  end if;

  -- Protesto não retirado depois de pago vira dano moral contra nós (§8, §11 item 3).
  select count(*) into v_protestos
  from public.protesto_titulos pt
  join public.protesto_remessas r on r.id = pt.remessa_id and r.tipo = 'apresentacao'
  join public.cobrancas c on c.id = r.cobranca_id
  where c.sacado_matriz_cnpj = v_matriz
    and pt.situacao in ('enviado', 'apontado', 'protestado')
    and pt.instrucao_cancelamento_em is null
    and nullif(btrim(pt.instrucao_nao_aplicavel_motivo), '') is null;
  if v_protestos > 0 then
    raise exception 'Há % protesto(s) sem instrução de cancelamento. Envie a retirada (ou marque como não aplicável) antes de regularizar.', v_protestos
      using errcode = '22023';
  end if;

  select max(ct.quitado_em) into v_pago_em
  from public.cobranca_titulos ct join public.cobrancas c on c.id = ct.cobranca_id
  where c.sacado_matriz_cnpj = v_matriz and ct.situacao = 'quitado';
  v_pago_em := coalesce(v_pago_em, current_date);

  -- §6.3 item 2: dentro de 30 dias após D+60, a cobertura volta com efeito retroativo.
  with fechados as (
    update public.apolice_prazos ap set
      status = 'encerrado_pagamento',
      pago_em = coalesce(ap.pago_em, v_pago_em),
      restabelecimento_retroativo = coalesce(ap.pago_em, v_pago_em) <= ap.data_parada_cobertura + 30,
      cobertura_volta_em = case when coalesce(ap.pago_em, v_pago_em) <= ap.data_parada_cobertura + 30
                                then ap.vencimento_original else coalesce(ap.pago_em, v_pago_em) end,
      calculado_em = now()
    from public.titulos t
    where t.id = ap.titulo_id and t.sacado_matriz_cnpj = v_matriz and ap.status = 'ativo'
    returning ap.restabelecimento_retroativo, ap.cobertura_volta_em
  )
  select count(*), max(cobertura_volta_em) into v_prazos, v_volta from fechados;

  delete from public.cobranca_bloqueios_cnpj where sacado_matriz_cnpj = v_matriz;

  update public.empresas e set
    bloqueio_cobranca = false,
    bloqueio_cobranca_motivo = null,
    bloqueio_cobranca_em = null,
    bloqueio_cobranca_cobranca_id = null,
    credito_revisao_pos_inadimplencia = not v_restaurar,
    credito_revisao_desde = case when v_restaurar then null else now() end
  where e.id in (select public.app__cobranca_empresas_do_grupo(v_matriz))
     or e.bloqueio_cobranca_cobranca_id in (select id from public.cobrancas where sacado_matriz_cnpj = v_matriz);

  select id into v_empresa from public.empresas where cnpj = v_matriz;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_empresa, 'cobranca.sacado_regularizado', jsonb_build_object(
    'titulo', 'Sacado regularizado',
    'resumo', 'Bloqueio de cobrança removido. Último pagamento em ' || to_char(v_pago_em, 'DD/MM/YYYY') ||
              case when v_restaurar then '.' else '. O limite fica em revisão pós-inadimplência na esteira de crédito.' end,
    'url', '/cobranca',
    'sacado_matriz_cnpj', v_matriz, 'pago_em', v_pago_em, 'cobertura_volta_em', v_volta,
    'revisao_pos_inadimplencia', not v_restaurar), v_ator);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'cobranca.sacado_regularizado', 'empresas', coalesce(v_empresa::text, v_matriz),
          jsonb_build_object('sacado_matriz_cnpj', v_matriz, 'pago_em', v_pago_em, 'prazos_encerrados', v_prazos));

  return jsonb_build_object(
    'sacado_matriz_cnpj', v_matriz, 'pago_em', v_pago_em, 'prazos_encerrados', v_prazos,
    'cobertura_volta_em', v_volta, 'revisao_pos_inadimplencia', not v_restaurar);
end;
$$;

-- ─── §10 Conversão em processo ──────────────────────────────────────────────

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

  -- Os títulos da cobrança viram as operações cobradas do processo, sem duplicar
  -- o que já estiver lá pela mesma antecipação.
  insert into public.processo_operacoes (numero_cnj, antecipacao_id_externo, access_key, valor_original, vencimento, descricao, criado_por)
  select p_cnj, t.antecipacao_id_externo,
         (select nf.access_key from public.notas_fiscais nf where nf.access_key = t.nf_chave_acesso),
         ct.valor_face_snapshot, ct.vencimento_snapshot,
         'Título ' || coalesce(t.numero, t.externo_id) || ' — cobrança ' || v_c.codigo, p_ator
  from public.cobranca_titulos ct join public.titulos t on t.id = ct.titulo_id
  where ct.cobranca_id = v_c.id and ct.situacao not in ('quitado', 'retirado')
    and not exists (select 1 from public.processo_operacoes po
                    where po.numero_cnj = p_cnj and po.antecipacao_id_externo = t.antecipacao_id_externo);

  -- A cobrança NÃO fecha ao virar processo: o prazo da apólice continua correndo.
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

create or replace function public.app_cobranca_vincular_processo(p jsonb)
returns public.cobrancas
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cnj text := btrim(p ->> 'numero_cnj');
begin
  perform public.app_cobranca_exige_modulo();
  if not exists (select 1 from public.processos where numero_cnj = v_cnj) then
    raise exception 'Processo % não encontrado no Jurídico.', v_cnj using errcode = 'P0002';
  end if;
  return public.app__cobranca_vincular_processo((p ->> 'cobranca_id')::uuid, v_cnj, auth.uid());
end;
$$;

/*
 * "Criar processo" (§10). O Jurídico nasce importado do Escavador e não tinha como
 * criar um processo à mão (0143). Aqui entra só a capa mínima que é NOSSA — partes,
 * valor da causa — e o worker do Jurídico completa o resto na próxima
 * sincronização pelo CNJ: `persistirProcesso` não toca `vinculo_cobranca_id`.
 */
create or replace function public.app_cobranca_criar_processo(p jsonb)
returns public.cobrancas
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_cnj text := btrim(p ->> 'numero_cnj');
  v_c public.cobrancas;
  v_nosso text;
begin
  perform public.app_cobranca_exige_modulo();

  if v_cnj !~ '^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$' then
    raise exception 'Número CNJ inválido (use 0000000-00.0000.0.00.0000).' using errcode = '22023';
  end if;
  if exists (select 1 from public.processos where numero_cnj = v_cnj) then
    raise exception 'O processo % já existe no Jurídico: use "Vincular".', v_cnj using errcode = '23505';
  end if;

  select * into v_c from public.cobrancas where id = (p ->> 'cobranca_id')::uuid;
  if v_c.id is null then
    raise exception 'Cobrança não encontrada.' using errcode = 'P0002';
  end if;

  select x ->> 'cnpj' into v_nosso
  from public.juridico_config jc, jsonb_array_elements(jc.valor) x
  where jc.chave = 'nossos_cnpjs' and coalesce((x ->> 'ativo')::boolean, true)
  limit 1;

  insert into public.processos (
    numero_cnj, empresa_devedora_id, cnpj_devedor, nosso_cnpj, polo_nosso,
    valor_causa, comarca, uf, situacao_interna, observacoes, data_distribuicao)
  values (
    v_cnj, v_c.sacado_empresa_id, v_c.sacado_matriz_cnpj,
    coalesce(nullif(p ->> 'nosso_cnpj', ''), v_nosso), 'ativo',
    coalesce(nullif(p ->> 'valor_causa', '')::numeric, v_c.valor_atualizado),
    nullif(btrim(p ->> 'comarca'), ''), nullif(upper(btrim(p ->> 'uf')), ''),
    'em_andamento',
    'Criado a partir da cobrança ' || v_c.codigo || '.' || coalesce(' ' || nullif(btrim(p ->> 'observacoes'), ''), ''),
    nullif(p ->> 'data_distribuicao', '')::date);

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_c.sacado_empresa_id, 'processo.importado', jsonb_build_object(
    'titulo', 'Processo ' || v_cnj || ' cadastrado pela Cobrança',
    'resumo', 'Capa mínima; a sincronização com o tribunal completa o resto.',
    'url', '/juridico/' || v_cnj, 'numero_cnj', v_cnj), v_ator);

  return public.app__cobranca_vincular_processo(v_c.id, v_cnj, v_ator);
end;
$$;

-- ─── §5 Modelos (gestor) ────────────────────────────────────────────────────

create or replace function public.app__cobranca_placeholders_validos(p_tipo text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'destinatario.razao_social', 'destinatario.cnpj', 'destinatario.endereco',
    'credor.razao_social', 'credor.cnpj', 'tabela_titulos', 'valor_total_face',
    'valor_total_atualizado', 'data_base', 'prazo_dias', 'prazo_data', 'dados_pagamento',
    'cobranca.codigo', 'data_hoje', 'memoria_calculo', 'rodada']
  || case when p_tipo like 'confissao_divida_%' then array[
    'tabela_parcelas', 'valor_confessado', 'avalistas', 'bem_garantia', 'foro', 'testemunhas']
  else array[]::text[] end;
$$;

create or replace function public.app_cobranca_salvar_modelo(p jsonb)
returns public.cobranca_modelos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_ant public.cobranca_modelos;
  v_row public.cobranca_modelos;
  v_tipo text;
  v_corpo text := p ->> 'corpo_markdown';
  v_desconhecidos text[];
begin
  perform public.app_cobranca_exige_gestor();

  if nullif(p ->> 'id', '') is not null then
    select * into v_ant from public.cobranca_modelos where id = (p ->> 'id')::uuid;
    if v_ant.id is null then
      raise exception 'Modelo não encontrado.' using errcode = 'P0002';
    end if;
  end if;
  v_tipo := coalesce(v_ant.tipo, p ->> 'tipo');

  if length(btrim(coalesce(v_corpo, ''))) < 20 then
    raise exception 'O corpo do modelo está vazio.' using errcode = '22023';
  end if;

  -- Placeholder desconhecido é ERRO, não string vazia (§5): uma notificação com
  -- "{{valr_total}}" impressa é uma carta que ninguém pode assinar.
  select array_agg(distinct m[1]) into v_desconhecidos
  from regexp_matches(v_corpo, '\{\{\s*([^}\s]+)\s*\}\}', 'g') m
  where m[1] <> all (public.app__cobranca_placeholders_validos(v_tipo));
  if v_desconhecidos is not null then
    raise exception 'Placeholder desconhecido: %.', array_to_string(v_desconhecidos, ', ') using errcode = '22023';
  end if;

  if v_ant.id is not null then
    update public.cobranca_modelos set ativo = false where familia_id = v_ant.familia_id and ativo;
    insert into public.cobranca_modelos (familia_id, tipo, nome, versao, ativo, corpo_markdown, criado_por)
    values (v_ant.familia_id, v_ant.tipo, coalesce(nullif(btrim(p ->> 'nome'), ''), v_ant.nome),
            (select max(versao) + 1 from public.cobranca_modelos where familia_id = v_ant.familia_id),
            true, v_corpo, v_ator)
    returning * into v_row;
  else
    insert into public.cobranca_modelos (tipo, nome, corpo_markdown, criado_por)
    values (v_tipo, btrim(p ->> 'nome'), v_corpo, v_ator)
    returning * into v_row;
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'cobranca.modelo_salvo', 'cobranca_modelos', v_row.id::text,
          jsonb_build_object('familia_id', v_row.familia_id, 'versao', v_row.versao, 'tipo', v_row.tipo));

  return v_row;
end;
$$;

create or replace function public.app_cobranca_arquivar_modelo(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.app_cobranca_exige_gestor();
  update public.cobranca_modelos set ativo = false where familia_id = (p ->> 'familia_id')::uuid;
  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (auth.uid(), 'cobranca.modelo_arquivado', 'cobranca_modelos', p ->> 'familia_id', p);
end;
$$;

-- ─── §13 Settings, apólices e insolvência ───────────────────────────────────

create or replace function public.app_cobranca_definir_config(p jsonb)
returns public.cobranca_config
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_chave text := p ->> 'chave';
  v_valor jsonb := p -> 'valor';
  v_row public.cobranca_config;
begin
  perform public.app_cobranca_exige_gestor();

  if v_chave not in ('cobranca', 'calculo', 'apolice', 'protesto', 'regularizacao', 'credor') then
    raise exception 'Chave de configuração desconhecida: %.', v_chave using errcode = '22023';
  end if;
  if jsonb_typeof(v_valor) <> 'object' then
    raise exception 'Valor de configuração inválido.' using errcode = '22023';
  end if;

  -- §13: retirar protesto ao quitar não se desliga sem justificativa.
  if v_chave = 'protesto' and coalesce((v_valor ->> 'retirar_protesto_ao_quitar')::boolean, true) = false
     and length(btrim(coalesce(v_valor ->> 'justificativa_nao_retirar', ''))) < 10 then
    raise exception 'Desligar a retirada de protesto após a quitação exige justificativa.' using errcode = '22023';
  end if;

  insert into public.cobranca_config (chave, valor, atualizado_por, atualizado_em)
  values (v_chave, v_valor, v_ator, now())
  on conflict (chave) do update set valor = excluded.valor, atualizado_por = v_ator, atualizado_em = now()
  returning * into v_row;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'cobranca.config_alterada', 'cobranca_config', v_chave, v_valor);

  return v_row;
end;
$$;

create or replace function public.app_cobranca_salvar_apolice(p jsonb)
returns public.apolices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_row public.apolices;
begin
  perform public.app_cobranca_exige_gestor();

  if v_id is null then
    insert into public.apolices (
      seguradora, numero, segurado_cnpj, vigencia_inicio, vigencia_fim, percentagem_segurada,
      periodo_espera_dias, prazo_maximo_credito_dias, periodo_max_prorrogacao_dias,
      prazo_notificacao_apos_prorrogacao_dias, prazo_envio_sinistro_meses,
      prazo_documentos_complementares_dias, franquia, responsabilidade_maxima, ativa)
    values (
      coalesce(nullif(btrim(p ->> 'seguradora'), ''), 'Atradius Crédito y Caución'),
      btrim(p ->> 'numero'), p ->> 'segurado_cnpj', (p ->> 'vigencia_inicio')::date, (p ->> 'vigencia_fim')::date,
      (p ->> 'percentagem_segurada')::numeric, (p ->> 'periodo_espera_dias')::int,
      (p ->> 'prazo_maximo_credito_dias')::int, (p ->> 'periodo_max_prorrogacao_dias')::int,
      (p ->> 'prazo_notificacao_apos_prorrogacao_dias')::int, (p ->> 'prazo_envio_sinistro_meses')::int,
      (p ->> 'prazo_documentos_complementares_dias')::int, (p ->> 'franquia')::numeric,
      nullif(p ->> 'responsabilidade_maxima', '')::numeric, coalesce((p ->> 'ativa')::boolean, true))
    returning * into v_row;
  else
    update public.apolices set
      seguradora = coalesce(nullif(btrim(p ->> 'seguradora'), ''), seguradora),
      numero = btrim(p ->> 'numero'),
      segurado_cnpj = p ->> 'segurado_cnpj',
      vigencia_inicio = (p ->> 'vigencia_inicio')::date,
      vigencia_fim = (p ->> 'vigencia_fim')::date,
      percentagem_segurada = (p ->> 'percentagem_segurada')::numeric,
      periodo_espera_dias = (p ->> 'periodo_espera_dias')::int,
      prazo_maximo_credito_dias = (p ->> 'prazo_maximo_credito_dias')::int,
      periodo_max_prorrogacao_dias = (p ->> 'periodo_max_prorrogacao_dias')::int,
      prazo_notificacao_apos_prorrogacao_dias = (p ->> 'prazo_notificacao_apos_prorrogacao_dias')::int,
      prazo_envio_sinistro_meses = (p ->> 'prazo_envio_sinistro_meses')::int,
      prazo_documentos_complementares_dias = (p ->> 'prazo_documentos_complementares_dias')::int,
      franquia = (p ->> 'franquia')::numeric,
      responsabilidade_maxima = nullif(p ->> 'responsabilidade_maxima', '')::numeric,
      ativa = coalesce((p ->> 'ativa')::boolean, ativa),
      atualizado_em = now()
    where id = v_id
    returning * into v_row;
    if v_row.id is null then
      raise exception 'Apólice não encontrada.' using errcode = 'P0002';
    end if;
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'cobranca.apolice_salva', 'apolices', v_row.id::text, p);

  return v_row;
end;
$$;

create or replace function public.app_cobranca_registrar_insolvencia(p jsonb)
returns public.cobranca_insolvencias
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_row public.cobranca_insolvencias;
  v_empresa uuid;
begin
  perform public.app_cobranca_exige_modulo();

  insert into public.cobranca_insolvencias (sacado_matriz_cnpj, tipo, data_decisao, fonte, numero_cnj, confirmada, observacao, criado_por)
  values (p ->> 'sacado_matriz_cnpj', p ->> 'tipo', (p ->> 'data_decisao')::date, 'manual',
          nullif(btrim(p ->> 'numero_cnj'), ''), true, nullif(btrim(p ->> 'observacao'), ''), v_ator)
  on conflict (sacado_matriz_cnpj) do update set
    tipo = excluded.tipo, data_decisao = excluded.data_decisao, fonte = 'manual',
    numero_cnj = coalesce(excluded.numero_cnj, public.cobranca_insolvencias.numero_cnj),
    confirmada = true, observacao = excluded.observacao, criado_por = v_ator
  returning * into v_row;

  select id into v_empresa from public.empresas where cnpj = v_row.sacado_matriz_cnpj;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_empresa, 'apolice.insolvencia_registrada', jsonb_build_object(
    'titulo', 'Insolvência registrada — o relógio da apólice muda',
    'resumo', 'Data da decisão ' || to_char(v_row.data_decisao, 'DD/MM/YYYY') ||
              '. O prazo de envio do sinistro passa a ser de 6 meses a partir dela (cl. 00300.00).',
    'url', '/cobranca', 'sacado_matriz_cnpj', v_row.sacado_matriz_cnpj), v_ator);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'cobranca.insolvencia_registrada', 'cobranca_insolvencias', v_row.id::text, p);

  return v_row;
end;
$$;

-- ─── §12 Painel (números consolidados só para gestor) ───────────────────────

create or replace function public.app_cobranca_painel()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_gestor boolean;
  v_out jsonb;
begin
  perform public.app_cobranca_exige_modulo();
  v_gestor := public.app_cobranca_gestor();

  -- Consolidado é da gestão (§12). O operador vê o relógio e a própria fila.
  if not v_gestor then
    return jsonb_build_object('gestor', false);
  end if;

  select jsonb_build_object(
    'gestor', true,
    'aging', (
      select coalesce(jsonb_agg(jsonb_build_object('faixa', faixa, 'valor', valor, 'qtd', qtd) order by ordem), '[]'::jsonb)
      from (
        select case when d <= 30 then '15–30' when d <= 60 then '31–60' when d <= 90 then '61–90'
                    when d <= 180 then '91–180' else '180+' end as faixa,
               case when d <= 30 then 1 when d <= 60 then 2 when d <= 90 then 3 when d <= 180 then 4 else 5 end as ordem,
               sum(v) as valor, count(*) as qtd
        from (select current_date - ct.vencimento_snapshot as d, ct.valor_face_snapshot as v
              from public.cobranca_titulos ct join public.cobrancas c on c.id = ct.cobranca_id
              where ct.situacao in ('em_cobranca', 'acordado', 'protestado', 'sinistrado')
                and c.estagio not in ('cancelada', 'quitada', 'encerrada_perda')) x
        group by 1, 2
      ) a),
    'em_cobranca', (
      select coalesce(sum(ct.valor_face_snapshot), 0)
      from public.cobranca_titulos ct join public.cobrancas c on c.id = ct.cobranca_id
      where ct.situacao in ('em_cobranca', 'acordado', 'protestado', 'sinistrado')
        and c.estagio not in ('cancelada', 'quitada', 'encerrada_perda')),
    'recuperado_mes', (
      select coalesce(sum(valor_recebido), 0) from public.cobranca_titulos
      where situacao = 'quitado' and quitado_em >= date_trunc('month', current_date)),
    'recuperado_12m', (
      select coalesce(sum(valor_recebido), 0) from public.cobranca_titulos
      where situacao = 'quitado' and quitado_em >= current_date - interval '12 months'),
    'taxa_recuperacao', (
      select case when sum(valor_face_snapshot) filter (where situacao <> 'retirado') > 0
                  then round(sum(coalesce(valor_recebido, 0)) filter (where situacao = 'quitado')
                             / sum(valor_face_snapshot) filter (where situacao <> 'retirado'), 4) end
      from public.cobranca_titulos ct
      where exists (select 1 from public.cobrancas c where c.id = ct.cobranca_id
                    and c.criada_em >= now() - interval '12 months' and c.estagio <> 'cancelada')),
    'sinistros', (
      select coalesce(jsonb_agg(jsonb_build_object('estagio', estagio, 'qtd', qtd, 'indenizacao_estimada', ind,
                                                   'proximo_prazo', prox) ), '[]'::jsonb)
      from (select estagio, count(*) qtd, sum(indenizacao_estimada) ind, min(data_limite_envio) prox
            from public.sinistros group by estagio) s),
    'protestos', (
      select coalesce(jsonb_agg(jsonb_build_object('situacao', situacao, 'qtd', qtd, 'custas', custas)), '[]'::jsonb)
      from (select situacao, count(*) qtd, sum(custas) custas from public.protesto_titulos group by situacao) p),
    'custos', (
      select jsonb_build_object(
        'aprovados', coalesce(sum(valor) filter (where aprovado_pela_seguradora), 0),
        'nao_aprovados', coalesce(sum(valor) filter (where not aprovado_pela_seguradora), 0))
      from public.sinistro_custos)
  ) into v_out;

  return v_out;
end;
$$;

-- ─── Grants ─────────────────────────────────────────────────────────────────

do $$
declare
  f text;
begin
  foreach f in array array[
    'app_cobranca_criar(jsonb)', 'app_cobranca_atualizar(jsonb)', 'app_cobranca_salvar_notificacoes(jsonb)',
    'app_cobranca_editar_notificacao(jsonb)', 'app_cobranca_aceitar_aviso_apolice(jsonb)',
    'app_cobranca_enviar_notificacao(jsonb)', 'app_cobranca_registrar_entrega(jsonb)',
    'app_cobranca_mover_estagio(jsonb)', 'app_cobranca_quitar_titulo(jsonb)', 'app_cobranca_retirar_titulo(jsonb)',
    'app_cobranca_registrar_interacao(jsonb)', 'app_cobranca_regularizar_sacado(jsonb)',
    'app_cobranca_vincular_processo(jsonb)', 'app_cobranca_criar_processo(jsonb)',
    'app_cobranca_salvar_modelo(jsonb)', 'app_cobranca_arquivar_modelo(jsonb)', 'app_cobranca_definir_config(jsonb)',
    'app_cobranca_salvar_apolice(jsonb)', 'app_cobranca_registrar_insolvencia(jsonb)', 'app_cobranca_painel()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

revoke all on function public.app__cobranca_placeholders_validos(text) from public, anon;
grant execute on function public.app__cobranca_placeholders_validos(text) to authenticated, service_role;
