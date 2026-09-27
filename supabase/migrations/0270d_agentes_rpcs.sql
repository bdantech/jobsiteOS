-- ============================================================================
-- 0270d — Agentes: RPCs
--
-- Dois grupos, pela mesma regra do resto da casa:
--   app__*   internas, só service_role — o worker do ciclo de agentes;
--   app_*    da tela, com `app_agentes_exige_modulo()`/`_gestor()` na primeira linha.
--
-- ── O ORÇAMENTO É ATÔMICO OU NÃO É ORÇAMENTO (§8) ───────────────────────────
-- Antes de toda ferramenta paga, o custo estimado é RESERVADO numa transação que confere
-- ao mesmo tempo o teto global do mês, o teto do mandato e o teto diário do agente. Depois
-- da chamada, o custo real é CONSUMIDO e a diferença estornada; se a chamada falhou, a
-- reserva inteira é estornada. Sem isso, dois agentes simultâneos gastam o mesmo saldo.
--
-- A trava é a linha do MÊS em `agentes_orcamento` (`for update`), sempre antes da linha
-- do mandato — a mesma ordem em reservar e consumir, para as duas nunca se esperarem em
-- círculo.
-- ============================================================================

-- ─── Código do mandato ──────────────────────────────────────────────────────

create or replace function public.app__agentes_proximo_codigo()
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_ano int := extract(year from (now() at time zone 'America/Sao_Paulo'))::int;
  v_n int;
begin
  insert into public.mandato_sequencias as s (ano, ultimo) values (v_ano, 1)
  on conflict (ano) do update set ultimo = s.ultimo + 1
  returning ultimo into v_n;
  return 'MDT-' || v_ano || '-' || lpad(v_n::text, 5, '0');
end $$;

-- ─── Orçamento ──────────────────────────────────────────────────────────────

create or replace function public.app__agentes_mes_atual()
returns date language sql stable set search_path = '' as $$
  select date_trunc('month', now() at time zone 'America/Sao_Paulo')::date;
$$;

/*
 * A linha do mês, criada com o teto padrão da config quando ainda não existe. Travada:
 * quem chama está dentro de uma transação de reserva ou consumo.
 */
create or replace function public.app__agentes_orcamento_do_mes(p_mes date)
returns public.agentes_orcamento language plpgsql security definer set search_path = '' as $$
declare
  v_teto int;
  v_linha public.agentes_orcamento;
begin
  select coalesce((valor ->> 'teto_mensal_centavos')::int, 0) into v_teto
    from public.agentes_config where chave = 'orcamento';
  insert into public.agentes_orcamento (mes, teto_centavos)
  values (p_mes, coalesce(v_teto, 0))
  on conflict (mes) do nothing;
  select * into v_linha from public.agentes_orcamento where mes = p_mes for update;
  return v_linha;
end $$;

create or replace function public.app__agentes_reservar(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_valor int := coalesce((p ->> 'valor_centavos')::int, 0);
  v_mandato uuid := (p ->> 'mandato_id')::uuid;
  v_ferramenta text := nullif(p ->> 'ferramenta', '');
  v_mes date := public.app__agentes_mes_atual();
  v_orc public.agentes_orcamento;
  v_m public.mandatos;
  v_abertas_mandato int;
  v_limite_dia int;
  v_gasto_dia int;
  v_id uuid;
begin
  if v_valor < 0 then
    raise exception 'Valor de reserva negativo.' using errcode = '22023';
  end if;

  v_orc := public.app__agentes_orcamento_do_mes(v_mes);
  if v_orc.consumido_centavos + v_orc.reservado_centavos + v_valor > v_orc.teto_centavos then
    return jsonb_build_object('ok', false, 'motivo', 'orcamento_global',
      'saldo_centavos', greatest(0, v_orc.teto_centavos - v_orc.consumido_centavos - v_orc.reservado_centavos));
  end if;

  select * into v_m from public.mandatos where id = v_mandato for update;
  if v_m.id is null then
    raise exception 'Mandato não encontrado.' using errcode = 'no_data_found';
  end if;
  select coalesce(sum(valor_centavos), 0) into v_abertas_mandato
    from public.agentes_orcamento_movimentos
   where mandato_id = v_mandato and tipo = 'reserva' and not liquidada;
  if v_m.gasto_centavos + v_abertas_mandato + v_valor > v_m.orcamento_centavos then
    return jsonb_build_object('ok', false, 'motivo', 'orcamento_mandato',
      'saldo_centavos', greatest(0, v_m.orcamento_centavos - v_m.gasto_centavos - v_abertas_mandato));
  end if;

  select coalesce((limites ->> 'gasto_diario_centavos')::int, 0) into v_limite_dia
    from public.vendedores where id = v_m.agente_id;
  if coalesce(v_limite_dia, 0) > 0 then
    select coalesce(sum(case when tipo = 'consumo' then valor_centavos
                             when tipo = 'reserva' and not liquidada then valor_centavos
                             else 0 end), 0)
      into v_gasto_dia
      from public.agentes_orcamento_movimentos
     where agente_id = v_m.agente_id
       and (criado_em at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date;
    if v_gasto_dia + v_valor > v_limite_dia then
      return jsonb_build_object('ok', false, 'motivo', 'teto_diario_agente',
        'saldo_centavos', greatest(0, v_limite_dia - v_gasto_dia));
    end if;
  end if;

  insert into public.agentes_orcamento_movimentos (mes, mandato_id, agente_id, ferramenta, tipo, valor_centavos)
  values (v_mes, v_mandato, v_m.agente_id, v_ferramenta, 'reserva', v_valor)
  returning id into v_id;

  update public.agentes_orcamento
     set reservado_centavos = reservado_centavos + v_valor, atualizado_em = now()
   where mes = v_mes;

  return jsonb_build_object('ok', true, 'reserva_id', v_id);
end $$;

create or replace function public.app__agentes_consumir(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_reserva uuid := (p ->> 'reserva_id')::uuid;
  v_real int := greatest(0, coalesce((p ->> 'valor_real_centavos')::int, 0));
  v_acao uuid := nullif(p ->> 'acao_id', '')::uuid;
  v_r public.agentes_orcamento_movimentos;
begin
  select * into v_r from public.agentes_orcamento_movimentos
   where id = v_reserva and tipo = 'reserva' for update;
  if v_r.id is null then
    raise exception 'Reserva não encontrada.' using errcode = 'no_data_found';
  end if;
  if v_r.liquidada then
    return jsonb_build_object('ok', true, 'ja_liquidada', true);
  end if;

  perform public.app__agentes_orcamento_do_mes(v_r.mes);

  update public.agentes_orcamento_movimentos set liquidada = true, acao_id = coalesce(acao_id, v_acao)
   where id = v_r.id;
  insert into public.agentes_orcamento_movimentos
    (mes, mandato_id, acao_id, agente_id, reserva_id, ferramenta, tipo, valor_centavos, liquidada)
  values (v_r.mes, v_r.mandato_id, v_acao, v_r.agente_id, v_r.id, v_r.ferramenta, 'consumo', v_real, true);
  -- Custo real ACIMA do estimado é aceito (a chamada já aconteceu) — e aparece no
  -- consumo, não some. Abaixo, a diferença volta como estorno explícito.
  if v_real < v_r.valor_centavos then
    insert into public.agentes_orcamento_movimentos
      (mes, mandato_id, acao_id, agente_id, reserva_id, ferramenta, tipo, valor_centavos, liquidada)
    values (v_r.mes, v_r.mandato_id, v_acao, v_r.agente_id, v_r.id, v_r.ferramenta, 'estorno',
            v_r.valor_centavos - v_real, true);
  end if;

  update public.agentes_orcamento set
    reservado_centavos = greatest(0, reservado_centavos - v_r.valor_centavos),
    consumido_centavos = consumido_centavos + v_real,
    atualizado_em = now()
   where mes = v_r.mes;

  if v_r.mandato_id is not null then
    update public.mandatos set gasto_centavos = gasto_centavos + v_real where id = v_r.mandato_id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.app__agentes_estornar(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_reserva uuid := (p ->> 'reserva_id')::uuid;
  v_r public.agentes_orcamento_movimentos;
begin
  select * into v_r from public.agentes_orcamento_movimentos
   where id = v_reserva and tipo = 'reserva' for update;
  if v_r.id is null or v_r.liquidada then
    return jsonb_build_object('ok', true);
  end if;
  perform public.app__agentes_orcamento_do_mes(v_r.mes);
  update public.agentes_orcamento_movimentos set liquidada = true where id = v_r.id;
  insert into public.agentes_orcamento_movimentos
    (mes, mandato_id, agente_id, reserva_id, ferramenta, tipo, valor_centavos, liquidada)
  values (v_r.mes, v_r.mandato_id, v_r.agente_id, v_r.id, v_r.ferramenta, 'estorno', v_r.valor_centavos, true);
  update public.agentes_orcamento
     set reservado_centavos = greatest(0, reservado_centavos - v_r.valor_centavos), atualizado_em = now()
   where mes = v_r.mes;
  return jsonb_build_object('ok', true);
end $$;

/*
 * O que não passa por reserva: os TOKENS do modelo (§8, "tokens contam no orçamento").
 * Eles só são conhecidos depois da chamada, e o ciclo não chama o modelo quando o saldo já
 * acabou (tranca). O consumo direto é gravado mesmo que estoure — a chamada aconteceu —, e
 * a próxima tranca de orçamento vê o estouro e pausa.
 */
create or replace function public.app__agentes_consumo_direto(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_valor int := greatest(0, coalesce((p ->> 'valor_centavos')::int, 0));
  v_mandato uuid := nullif(p ->> 'mandato_id', '')::uuid;
  v_agente uuid := nullif(p ->> 'agente_id', '')::uuid;
  v_mes date := public.app__agentes_mes_atual();
  v_orc public.agentes_orcamento;
begin
  if v_valor = 0 then
    return jsonb_build_object('ok', true);
  end if;
  v_orc := public.app__agentes_orcamento_do_mes(v_mes);
  insert into public.agentes_orcamento_movimentos
    (mes, mandato_id, acao_id, agente_id, ferramenta, tipo, valor_centavos, liquidada)
  values (v_mes, v_mandato, nullif(p ->> 'acao_id', '')::uuid, v_agente,
          coalesce(nullif(p ->> 'ferramenta', ''), 'modelo'), 'consumo', v_valor, true);
  update public.agentes_orcamento
     set consumido_centavos = consumido_centavos + v_valor, atualizado_em = now()
   where mes = v_mes;
  if v_mandato is not null then
    update public.mandatos set gasto_centavos = gasto_centavos + v_valor where id = v_mandato;
  end if;
  return jsonb_build_object('ok', true,
    'esgotado', v_orc.consumido_centavos + v_valor >= v_orc.teto_centavos);
end $$;

/*
 * Os limiares (50/80/95/100) que o consumo acabou de cruzar e que ainda não foram
 * avisados. Devolve e marca de uma vez, na trava da linha: dois ciclos simultâneos não
 * mandam o mesmo alerta duas vezes.
 */
create or replace function public.app__agentes_alertas_orcamento()
returns int[] language plpgsql security definer set search_path = '' as $$
declare
  v_mes date := public.app__agentes_mes_atual();
  v_orc public.agentes_orcamento;
  v_limiares int[];
  v_pct numeric;
  v_novos int[] := '{}';
  v_l int;
begin
  v_orc := public.app__agentes_orcamento_do_mes(v_mes);
  if v_orc.teto_centavos <= 0 then
    return v_novos;
  end if;
  select coalesce(array(select jsonb_array_elements_text(valor -> 'alertas_pct')::int), array[50, 80, 95])
    into v_limiares from public.agentes_config where chave = 'orcamento';
  v_limiares := coalesce(v_limiares, array[50, 80, 95]) || array[100];
  v_pct := v_orc.consumido_centavos * 100.0 / v_orc.teto_centavos;
  foreach v_l in array v_limiares loop
    if v_pct >= v_l and not (v_l = any (v_orc.alertas_enviados)) then
      v_novos := v_novos || v_l;
    end if;
  end loop;
  if cardinality(v_novos) > 0 then
    update public.agentes_orcamento set alertas_enviados = alertas_enviados || v_novos where mes = v_mes;
  end if;
  return v_novos;
end $$;

-- ─── Criar mandato (núcleo) ─────────────────────────────────────────────────

create or replace function public.app__agentes_criar_mandato(p jsonb)
returns public.mandatos language plpgsql security definer set search_path = '' as $$
declare
  v_tipo text := p ->> 'tipo';
  v_empresa uuid := (p ->> 'empresa_id')::uuid;
  v_agente uuid := (p ->> 'agente_id')::uuid;
  v_a public.vendedores;
  v_e public.empresas;
  v_ativos int;
  v_cota int;
  v_m public.mandatos;
begin
  select * into v_a from public.vendedores where id = v_agente;
  if v_a.id is null or not v_a.is_ia then
    raise exception 'Mandato só pode ser delegado a um vendedor de IA.' using errcode = '22023';
  end if;
  if not v_a.ativo then
    raise exception 'O agente % está inativo.', v_a.nome using errcode = '22023';
  end if;

  select * into v_e from public.empresas where id = v_empresa;
  if v_e.id is null then
    raise exception 'Empresa não encontrada.' using errcode = 'no_data_found';
  end if;
  if coalesce(v_e.bloqueio_cobranca, false)
     or (v_e.cnpj is not null and public.app_cobranca_sacado_bloqueado(v_e.cnpj)) then
    raise exception 'A empresa está em cobrança: contato comercial suspenso (Prompt 07).'
      using errcode = '42501', detail = 'em_cobranca';
  end if;
  if exists (select 1 from public.supressao s
              where s.escopo = 'empresa' and s.valor = v_e.cnpj
                and (s.expira_em is null or s.expira_em >= current_date)) then
    raise exception 'A empresa está suprimida.' using errcode = '42501', detail = 'suprimido';
  end if;

  if exists (select 1 from public.mandatos m
              where m.empresa_id = v_empresa and m.tipo = v_tipo
                and m.estado in ('aberto', 'em_andamento', 'aguardando_externo', 'pausado')) then
    raise exception 'Já existe um mandato ativo deste tipo para esta empresa.'
      using errcode = '23505', detail = 'mandato_ativo';
  end if;

  select count(*) into v_ativos from public.mandatos
   where agente_id = v_agente and estado in ('aberto', 'em_andamento', 'aguardando_externo');
  v_cota := coalesce((v_a.limites ->> 'mandatos_ativos')::int, 25);
  if v_ativos >= v_cota then
    raise exception 'O agente % já tem % mandatos ativos (cota %).', v_a.nome, v_ativos, v_cota
      using errcode = '54000', detail = 'cota_mandatos';
  end if;

  insert into public.mandatos (
    codigo, tipo, objetivo, empresa_id, nota_access_key, agente_id, playbook_id,
    prioridade, orcamento_centavos, max_acoes, expira_em, proxima_acao_em,
    origem, regra_id, proposta_id, criado_por
  ) values (
    public.app__agentes_proximo_codigo(), v_tipo, p ->> 'objetivo', v_empresa,
    nullif(p ->> 'nota_access_key', ''), v_agente, nullif(p ->> 'playbook_id', '')::uuid,
    coalesce((p ->> 'prioridade')::int, 50),
    (p ->> 'orcamento_centavos')::int, (p ->> 'max_acoes')::int,
    now() + make_interval(days => (p ->> 'prazo_dias')::int), now(),
    coalesce(p ->> 'origem', 'manual'), nullif(p ->> 'regra_id', '')::uuid,
    nullif(p ->> 'proposta_id', '')::uuid, nullif(p ->> 'criado_por', '')::uuid
  )
  returning * into v_m;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_empresa, 'mandato.criado',
    jsonb_build_object('mandato_id', v_m.id, 'codigo', v_m.codigo, 'tipo', v_m.tipo,
      'agente_id', v_agente, 'origem', v_m.origem,
      'resumo', v_a.nome || ' recebeu o mandato ' || v_m.codigo || ': ' || v_m.objetivo,
      'url', '/agentes/mandatos?m=' || v_m.id),
    nullif(p ->> 'criado_por', '')::uuid);

  return v_m;
end $$;

-- ─── Tela: delegar ao agente (§2.3 manual) ──────────────────────────────────

create or replace function public.app_agentes_criar_mandato(p jsonb)
returns public.mandatos language plpgsql security definer set search_path = '' as $$
declare
  v_m public.mandatos;
begin
  perform public.app_agentes_exige_gestor();
  v_m := public.app__agentes_criar_mandato(
    p || jsonb_build_object('origem', 'manual', 'criado_por', auth.uid()));
  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (auth.uid(), 'agentes.mandato_criado', 'mandatos', v_m.id::text, p);
  return v_m;
end $$;

-- ─── Tela: as ações humanas sobre um mandato (§11.2) ────────────────────────
--
--   pausar / retomar   gestor ou o closer do agente
--   assumir            gestor ou o closer — move para `escalado` e passa a conversa a uma
--                      pessoa, mantendo o histórico (é a saída quando a conversa merece
--                      alguém)
--   encerrar           gestor
--   reatribuir         gestor — troca o agente; o histórico e o plano ficam
--   ajustar_orcamento  gestor — orçamento, máximo de ações e prazo

create or replace function public.app_agentes_mandato_acao(p jsonb)
returns public.mandatos language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_id uuid := (p ->> 'mandato_id')::uuid;
  v_acao text := p ->> 'acao';
  v_m public.mandatos;
  v_gestor boolean := public.app_agentes_gestor();
  v_novo_agente public.vendedores;
  v_evento text;
begin
  perform public.app_agentes_exige_modulo();
  select * into v_m from public.mandatos where id = v_id for update;
  if v_m.id is null then
    raise exception 'Mandato não encontrado.' using errcode = 'no_data_found';
  end if;
  if not v_gestor and not (v_m.agente_id = any (public.app_agentes_visiveis())) then
    raise exception 'Você não acompanha este agente.' using errcode = '42501';
  end if;
  if v_acao in ('encerrar', 'reatribuir', 'ajustar_orcamento') and not v_gestor then
    raise exception 'Somente a gestão comercial pode fazer isso.' using errcode = '42501';
  end if;
  if v_m.estado in ('concluido', 'encerrado_sem_sucesso', 'escalado') and v_acao <> 'ajustar_orcamento' then
    raise exception 'Este mandato já terminou.' using errcode = '22023';
  end if;

  case v_acao
    when 'pausar' then
      update public.mandatos set estado = 'pausado', pausado_motivo = 'manual' where id = v_id returning * into v_m;
      v_evento := 'mandato.pausado';
    when 'retomar' then
      if v_m.estado <> 'pausado' then
        raise exception 'O mandato não está pausado.' using errcode = '22023';
      end if;
      update public.mandatos set estado = 'em_andamento', pausado_motivo = null, proxima_acao_em = now()
       where id = v_id returning * into v_m;
      v_evento := 'mandato.iniciado';
    when 'assumir' then
      update public.mandatos set estado = 'escalado', motivo_encerramento = 'assumido_manualmente',
             assumido_por = v_ator, encerrado_em = now(), proxima_acao_em = null
       where id = v_id returning * into v_m;
      -- As conversas do mandato viram de uma pessoa: o agente de conversa não volta a
      -- decidir nelas sozinho.
      update public.conversas c set modo_agente = 'sugestao', status = 'aguardando_humano'
        from public.mandato_conversas mc
       where mc.mandato_id = v_id and mc.conversa_id = c.id and c.status <> 'encerrada';
      v_evento := 'mandato.escalado';
    when 'encerrar' then
      update public.mandatos set estado = 'encerrado_sem_sucesso',
             motivo_encerramento = 'encerrado_manualmente',
             resultado = coalesce(nullif(p ->> 'resultado', ''), resultado),
             encerrado_em = now(), proxima_acao_em = null
       where id = v_id returning * into v_m;
      v_evento := 'mandato.encerrado';
    when 'reatribuir' then
      select * into v_novo_agente from public.vendedores where id = (p ->> 'agente_id')::uuid;
      if v_novo_agente.id is null or not v_novo_agente.is_ia or not v_novo_agente.ativo then
        raise exception 'Reatribuir exige outro vendedor de IA ativo.' using errcode = '22023';
      end if;
      -- As ações antigas continuam com o agente que as executou: o histórico é de quem agiu.
      update public.mandatos set agente_id = v_novo_agente.id, proxima_acao_em = now()
       where id = v_id returning * into v_m;
      v_evento := 'mandato.acao_executada';
    when 'ajustar_orcamento' then
      update public.mandatos set
        orcamento_centavos = coalesce((p ->> 'orcamento_centavos')::int, orcamento_centavos),
        max_acoes = coalesce((p ->> 'max_acoes')::int, max_acoes),
        expira_em = coalesce((p ->> 'expira_em')::timestamptz, expira_em),
        -- Pausado por orçamento volta a andar se o novo orçamento cobre o gasto.
        estado = case when estado = 'pausado' and pausado_motivo = 'orcamento_esgotado'
                        and coalesce((p ->> 'orcamento_centavos')::int, orcamento_centavos) > gasto_centavos
                      then 'em_andamento' else estado end,
        pausado_motivo = case when estado = 'pausado' and pausado_motivo = 'orcamento_esgotado'
                        and coalesce((p ->> 'orcamento_centavos')::int, orcamento_centavos) > gasto_centavos
                      then null else pausado_motivo end
       where id = v_id returning * into v_m;
      v_evento := 'mandato.acao_executada';
    else
      raise exception 'Ação desconhecida: %.', v_acao using errcode = '22023';
  end case;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_m.empresa_id, v_evento,
    jsonb_build_object('mandato_id', v_m.id, 'codigo', v_m.codigo, 'acao_humana', v_acao,
      'agente_id', v_m.agente_id,
      'resumo', 'Mandato ' || v_m.codigo || ': ' || v_acao || ' por uma pessoa.',
      'url', '/agentes/mandatos?m=' || v_m.id),
    v_ator);
  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'agentes.mandato_' || v_acao, 'mandatos', v_m.id::text, p);
  return v_m;
end $$;

-- ─── Propostas de mandato (§2.3 por escalonamento) ──────────────────────────

create or replace function public.app_agentes_decidir_proposta(p jsonb)
returns public.mandato_propostas language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_pr public.mandato_propostas;
  v_orig public.mandatos;
  v_m public.mandatos;
  v_aprovar boolean := coalesce((p ->> 'aprovar')::boolean, false);
begin
  perform public.app_agentes_exige_gestor();
  select * into v_pr from public.mandato_propostas where id = (p ->> 'id')::uuid for update;
  if v_pr.id is null then
    raise exception 'Proposta não encontrada.' using errcode = 'no_data_found';
  end if;
  if v_pr.estado <> 'pendente' then
    raise exception 'Esta proposta já foi decidida.' using errcode = '22023';
  end if;

  if v_aprovar then
    select * into v_orig from public.mandatos where id = v_pr.mandato_origem_id;
    v_m := public.app__agentes_criar_mandato(jsonb_build_object(
      'tipo', v_pr.tipo, 'objetivo', v_pr.objetivo, 'empresa_id', v_pr.empresa_id,
      'agente_id', coalesce(nullif(p ->> 'agente_id', '')::uuid, v_pr.agente_id),
      'orcamento_centavos', coalesce((p ->> 'orcamento_centavos')::int, v_orig.orcamento_centavos),
      'max_acoes', coalesce((p ->> 'max_acoes')::int, v_orig.max_acoes),
      'prazo_dias', coalesce((p ->> 'prazo_dias')::int, 14),
      'prioridade', v_orig.prioridade,
      'origem', 'escalonamento', 'proposta_id', v_pr.id, 'criado_por', v_ator));
    update public.mandato_propostas set estado = 'aprovada', decidido_por = v_ator, decidido_em = now(),
           mandato_criado_id = v_m.id
     where id = v_pr.id returning * into v_pr;
  else
    update public.mandato_propostas set estado = 'recusada', decidido_por = v_ator, decidido_em = now(),
           motivo_recusa = nullif(p ->> 'motivo', '')
     where id = v_pr.id returning * into v_pr;
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, case when v_aprovar then 'agentes.proposta_aprovada' else 'agentes.proposta_recusada' end,
          'mandato_propostas', v_pr.id::text, p);
  return v_pr;
end $$;

-- ─── Regras (§2.3) ──────────────────────────────────────────────────────────
--
-- Salvar NUNCA liga: a regra nasce e volta desligada a cada edição do filtro, porque o
-- filtro novo tem uma prévia de impacto nova que ninguém viu ainda.

create or replace function public.app_agentes_salvar_regra(p jsonb)
returns public.mandato_regras language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_r public.mandato_regras;
begin
  perform public.app_agentes_exige_gestor();
  if not exists (select 1 from public.vendedores where id = (p ->> 'agente_id')::uuid and is_ia) then
    raise exception 'A regra precisa de um agente de IA.' using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.mandato_regras (nome, tipo_mandato, agente_id, playbook_id, filtro, objetivo_template,
      orcamento_centavos, max_acoes, prazo_dias, teto_mandatos_ativos, prioridade, ativa, criada_por)
    values (p ->> 'nome', p ->> 'tipo_mandato', (p ->> 'agente_id')::uuid, nullif(p ->> 'playbook_id', '')::uuid,
      p -> 'filtro', p ->> 'objetivo_template', (p ->> 'orcamento_centavos')::int, (p ->> 'max_acoes')::int,
      (p ->> 'prazo_dias')::int, nullif(p ->> 'teto_mandatos_ativos', '')::int,
      coalesce((p ->> 'prioridade')::int, 50), false, v_ator)
    returning * into v_r;
  else
    update public.mandato_regras set
      nome = p ->> 'nome', tipo_mandato = p ->> 'tipo_mandato', agente_id = (p ->> 'agente_id')::uuid,
      playbook_id = nullif(p ->> 'playbook_id', '')::uuid, filtro = p -> 'filtro',
      objetivo_template = p ->> 'objetivo_template', orcamento_centavos = (p ->> 'orcamento_centavos')::int,
      max_acoes = (p ->> 'max_acoes')::int, prazo_dias = (p ->> 'prazo_dias')::int,
      teto_mandatos_ativos = nullif(p ->> 'teto_mandatos_ativos', '')::int,
      prioridade = coalesce((p ->> 'prioridade')::int, prioridade),
      ativa = case when filtro is distinct from p -> 'filtro' then false else ativa end,
      ultima_previa = case when filtro is distinct from p -> 'filtro' then null else ultima_previa end
    where id = v_id returning * into v_r;
  end if;
  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'agentes.regra_salva', 'mandato_regras', v_r.id::text, p);
  return v_r;
end $$;

create or replace function public.app_agentes_ligar_regra(p jsonb)
returns public.mandato_regras language plpgsql security definer set search_path = '' as $$
declare
  v_r public.mandato_regras;
  v_ativa boolean := coalesce((p ->> 'ativa')::boolean, false);
begin
  perform public.app_agentes_exige_gestor();
  select * into v_r from public.mandato_regras where id = (p ->> 'id')::uuid for update;
  if v_r.id is null then
    raise exception 'Regra não encontrada.' using errcode = 'no_data_found';
  end if;
  -- §2.3: ligar exige ter visto a prévia de impacto do filtro ATUAL.
  if v_ativa and v_r.ultima_previa is null then
    raise exception 'Veja a prévia de impacto antes de ligar a regra.' using errcode = '22023';
  end if;
  update public.mandato_regras set ativa = v_ativa where id = v_r.id returning * into v_r;
  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (auth.uid(), case when v_ativa then 'agentes.regra_ligada' else 'agentes.regra_desligada' end,
          'mandato_regras', v_r.id::text, p);
  return v_r;
end $$;

/* A prévia calculada (na tela, pelo motor de filtros sob RLS) é gravada aqui. */
create or replace function public.app_agentes_registrar_previa(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.app_agentes_exige_gestor();
  update public.mandato_regras set ultima_previa = p -> 'previa' || jsonb_build_object('em', now())
   where id = (p ->> 'id')::uuid;
end $$;

-- ─── Personas (§3, §11.3) ───────────────────────────────────────────────────
--
-- As travas da §15.3 moram aqui: agente AUTÔNOMO sem linha de WhatsApp própria, ativa e do
-- tipo `ia` é RECUSADO com mensagem clara — em vez de falhar no envio, horas depois, com
-- um erro que ninguém vê. E uma linha só pode ser de um agente ativo.

create or replace function public.app_agentes_salvar_persona(p jsonb)
returns public.vendedores language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_conta uuid := nullif(p ->> 'whatsapp_conta_id', '')::uuid;
  v_autonomo boolean := coalesce((p ->> 'autonomo')::boolean, false);
  v_ativo boolean := coalesce((p ->> 'ativo')::boolean, true);
  v_tipo text := coalesce(nullif(p ->> 'tipo', ''), 'sdr');
  v_c public.whatsapp_contas;
  v_v public.vendedores;
  v_disj jsonb;
begin
  perform public.app_agentes_exige_gestor();
  if v_tipo not in ('sdr', 'originador') then
    raise exception 'Agente de IA é SDR (reuniões) ou originador (NFs).' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p ->> 'nome', '')), '') is null then
    raise exception 'Dê um nome ao agente.' using errcode = '22023';
  end if;

  if v_conta is not null then
    select * into v_c from public.whatsapp_contas where id = v_conta;
    if v_c.id is null then
      raise exception 'Conta de WhatsApp não encontrada.' using errcode = 'no_data_found';
    end if;
    if v_c.tipo <> 'ia' then
      raise exception 'A linha do agente precisa ser uma conta do tipo IA (a "%" é %).', v_c.apelido, v_c.tipo
        using errcode = '22023', detail = 'linha_nao_ia';
    end if;
    if exists (select 1 from public.vendedores o
                where o.whatsapp_conta_id = v_conta and o.is_ia and o.ativo
                  and o.id is distinct from v_id) then
      raise exception 'Esta linha já é de outro agente ativo.' using errcode = '23505', detail = 'linha_em_uso';
    end if;
  end if;

  if v_autonomo and v_ativo and (v_conta is null or not v_c.ativo) then
    raise exception 'Um agente autônomo precisa de uma linha de WhatsApp própria e ativa. Cadastre uma conta do tipo IA em Comunicação › Contas de WhatsApp e escolha-a aqui.'
      using errcode = '22023', detail = 'sem_linha';
  end if;

  if v_id is null then
    insert into public.vendedores (nome, tipo, usuario_id, is_ia, whatsapp_conta_id, email_remetente,
      email_caixa_id, voz_conta_id, persona, closer_id, closer_substituto_id, escopo, limites,
      modo_rodagem, autonomo, ativo)
    values (btrim(p ->> 'nome'), v_tipo, null, true, v_conta, nullif(p ->> 'email_remetente', ''),
      nullif(p ->> 'email_caixa_id', '')::uuid, nullif(p ->> 'voz_conta_id', ''), p -> 'persona',
      nullif(p ->> 'closer_id', '')::uuid, nullif(p ->> 'closer_substituto_id', '')::uuid,
      p -> 'escopo', p -> 'limites', coalesce(nullif(p ->> 'modo_rodagem', ''), 'piloto'),
      v_autonomo, v_ativo)
    returning * into v_v;

    select valor into v_disj from public.agentes_config where chave = 'disjuntor';
    insert into public.agentes_disjuntor (agente_id, janela_acoes, limiar_supressao, limiar_sem_interesse,
      limiar_escalacao, limiar_falha_tecnica)
    values (v_v.id, coalesce((v_disj ->> 'janela_acoes')::int, 20),
      coalesce((v_disj ->> 'limiar_supressao')::numeric, 0.10),
      coalesce((v_disj ->> 'limiar_sem_interesse')::numeric, 0.60),
      coalesce((v_disj ->> 'limiar_escalacao')::numeric, 0.30),
      coalesce((v_disj ->> 'limiar_falha_tecnica')::numeric, 0.25))
    on conflict (agente_id) do nothing;
  else
    select * into v_v from public.vendedores where id = v_id for update;
    if v_v.id is null or not v_v.is_ia then
      raise exception 'Agente não encontrado.' using errcode = 'no_data_found';
    end if;
    update public.vendedores set
      nome = btrim(p ->> 'nome'), tipo = v_tipo, whatsapp_conta_id = v_conta,
      email_remetente = nullif(p ->> 'email_remetente', ''),
      email_caixa_id = nullif(p ->> 'email_caixa_id', '')::uuid,
      voz_conta_id = nullif(p ->> 'voz_conta_id', ''), persona = p -> 'persona',
      closer_id = nullif(p ->> 'closer_id', '')::uuid,
      closer_substituto_id = nullif(p ->> 'closer_substituto_id', '')::uuid,
      escopo = p -> 'escopo', limites = p -> 'limites',
      modo_rodagem = coalesce(nullif(p ->> 'modo_rodagem', ''), modo_rodagem),
      autonomo = v_autonomo, ativo = v_ativo
    where id = v_id returning * into v_v;
    insert into public.agentes_disjuntor (agente_id) values (v_id) on conflict (agente_id) do nothing;
  end if;

  if v_v.closer_id is not null and not exists (
    select 1 from public.vendedores c where c.id = v_v.closer_id and not c.is_ia and c.tipo = 'vendedor') then
    raise exception 'O closer designado precisa ser um vendedor (closer) humano.' using errcode = '22023';
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'agentes.persona_salva', 'vendedores', v_v.id::text, p);
  return v_v;
end $$;

create or replace function public.app_agentes_pausar_agente(p jsonb)
returns public.vendedores language plpgsql security definer set search_path = '' as $$
declare
  v_v public.vendedores;
  v_pausar boolean := coalesce((p ->> 'pausar')::boolean, true);
begin
  perform public.app_agentes_exige_gestor();
  update public.vendedores set
    pausado_em = case when v_pausar then now() else null end,
    pausado_motivo = case when v_pausar then coalesce(nullif(p ->> 'motivo', ''), 'manual') else null end
  where id = (p ->> 'agente_id')::uuid and is_ia
  returning * into v_v;
  if v_v.id is null then
    raise exception 'Agente não encontrado.' using errcode = 'no_data_found';
  end if;
  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (auth.uid(), case when v_pausar then 'agentes.agente_pausado' else 'agentes.agente_retomado' end,
          'vendedores', v_v.id::text, p);
  return v_v;
end $$;

-- ─── Disjuntor: reabertura só manual, com registro de quem (§9.2) ───────────

create or replace function public.app_agentes_reabrir_disjuntor(p jsonb)
returns public.agentes_disjuntor language plpgsql security definer set search_path = '' as $$
declare
  v_d public.agentes_disjuntor;
  v_agente uuid := (p ->> 'agente_id')::uuid;
begin
  perform public.app_agentes_exige_gestor();
  update public.agentes_disjuntor set
    estado = 'ok', reaberto_por = auth.uid(), reaberto_em = now(),
    -- A janela recomeça: as ações que abriram o disjuntor não podem reabri-lo no ciclo seguinte.
    janela_desde = now()
  where agente_id = v_agente
  returning * into v_d;
  if v_d.agente_id is null then
    raise exception 'Disjuntor não encontrado.' using errcode = 'no_data_found';
  end if;
  -- Os mandatos pausados pelo disjuntor voltam a andar.
  update public.mandatos set estado = 'em_andamento', pausado_motivo = null, proxima_acao_em = now()
   where agente_id = v_agente and estado = 'pausado' and pausado_motivo = 'disjuntor_aberto';

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (null, 'agente.disjuntor_reaberto',
    jsonb_build_object('agente_id', v_agente, 'titulo', 'Disjuntor do agente reaberto',
      'resumo', coalesce(nullif(p ->> 'motivo', ''), 'Reaberto manualmente.'), 'url', '/agentes'),
    auth.uid());
  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (auth.uid(), 'agentes.disjuntor_reaberto', 'agentes_disjuntor', v_agente::text, p);
  return v_d;
end $$;

create or replace function public.app_agentes_salvar_disjuntor(p jsonb)
returns public.agentes_disjuntor language plpgsql security definer set search_path = '' as $$
declare
  v_d public.agentes_disjuntor;
begin
  perform public.app_agentes_exige_gestor();
  insert into public.agentes_disjuntor (agente_id) values ((p ->> 'agente_id')::uuid)
  on conflict (agente_id) do nothing;
  update public.agentes_disjuntor set
    janela_acoes = coalesce((p ->> 'janela_acoes')::int, janela_acoes),
    limiar_supressao = coalesce((p ->> 'limiar_supressao')::numeric, limiar_supressao),
    limiar_sem_interesse = coalesce((p ->> 'limiar_sem_interesse')::numeric, limiar_sem_interesse),
    limiar_escalacao = coalesce((p ->> 'limiar_escalacao')::numeric, limiar_escalacao),
    limiar_falha_tecnica = coalesce((p ->> 'limiar_falha_tecnica')::numeric, limiar_falha_tecnica)
  where agente_id = (p ->> 'agente_id')::uuid
  returning * into v_d;
  return v_d;
end $$;

-- ─── Materiais (§5) ─────────────────────────────────────────────────────────

create or replace function public.app_agentes_salvar_material(p jsonb)
returns public.materiais language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_m public.materiais;
begin
  perform public.app_agentes_exige_gestor();
  if v_id is null then
    insert into public.materiais (nome, descricao, quando_usar, tipo, arquivo_path, url, corpo, tags, canais,
      ativo, criado_por)
    values (p ->> 'nome', p ->> 'descricao', p ->> 'quando_usar', p ->> 'tipo', nullif(p ->> 'arquivo_path', ''),
      nullif(p ->> 'url', ''), nullif(p ->> 'corpo', ''),
      coalesce(array(select jsonb_array_elements_text(p -> 'tags')), '{}'),
      coalesce(array(select jsonb_array_elements_text(p -> 'canais')), '{email,whatsapp}'),
      coalesce((p ->> 'ativo')::boolean, true), auth.uid())
    returning * into v_m;
  else
    update public.materiais set
      nome = p ->> 'nome', descricao = p ->> 'descricao', quando_usar = p ->> 'quando_usar',
      tipo = p ->> 'tipo', arquivo_path = nullif(p ->> 'arquivo_path', ''), url = nullif(p ->> 'url', ''),
      corpo = nullif(p ->> 'corpo', ''),
      tags = coalesce(array(select jsonb_array_elements_text(p -> 'tags')), tags),
      canais = coalesce(array(select jsonb_array_elements_text(p -> 'canais')), canais),
      ativo = coalesce((p ->> 'ativo')::boolean, ativo)
    where id = v_id returning * into v_m;
  end if;
  return v_m;
end $$;

-- ─── Settings (§12) ─────────────────────────────────────────────────────────
--
-- O kill switch é ÚNICO (§9.2): mudar `geral.kill_switch` espelha nos dois antigos
-- (`comunicacao_config.agente.kill_switch` e `antecipacao_config.voz.kill_switch`) durante
-- a transição — desligar em emergência não pode exigir lembrar de três lugares.

create or replace function public.app_agentes_salvar_config(p jsonb)
returns public.agentes_config language plpgsql security definer set search_path = '' as $$
declare
  v_chave text := p ->> 'chave';
  v_valor jsonb := p -> 'valor';
  v_linha public.agentes_config;
  v_kill boolean;
begin
  perform public.app_agentes_exige_gestor();
  if v_chave not in ('geral', 'janela', 'precos', 'disjuntor', 'orcamento') then
    raise exception 'Chave de configuração desconhecida: %.', v_chave using errcode = '22023';
  end if;
  if v_valor is null or jsonb_typeof(v_valor) <> 'object' then
    raise exception 'Valor inválido.' using errcode = '22023';
  end if;

  insert into public.agentes_config as c (chave, valor, atualizado_por, atualizado_em)
  values (v_chave, v_valor, auth.uid(), now())
  on conflict (chave) do update set valor = c.valor || excluded.valor,
    atualizado_por = excluded.atualizado_por, atualizado_em = now()
  returning * into v_linha;

  if v_chave = 'geral' and v_valor ? 'kill_switch' then
    v_kill := (v_valor ->> 'kill_switch')::boolean;
    update public.comunicacao_config
       set valor = jsonb_set(coalesce(valor, '{}'::jsonb), '{kill_switch}', to_jsonb(v_kill))
     where chave = 'agente';
    insert into public.antecipacao_config (chave, valor)
    values ('voz', jsonb_build_object('kill_switch', v_kill))
    on conflict (chave) do update
      set valor = jsonb_set(coalesce(public.antecipacao_config.valor, '{}'::jsonb), '{kill_switch}', to_jsonb(v_kill));
  end if;

  if v_chave = 'orcamento' and v_valor ? 'teto_mensal_centavos' then
    insert into public.agentes_orcamento (mes, teto_centavos)
    values (public.app__agentes_mes_atual(), (v_valor ->> 'teto_mensal_centavos')::int)
    on conflict (mes) do update set teto_centavos = excluded.teto_centavos, atualizado_em = now();
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (auth.uid(), 'agentes.config_salva', 'agentes_config', v_chave, v_valor);
  return v_linha;
end $$;

-- ─── Caixas de e-mail (§4.2) ────────────────────────────────────────────────

create or replace function public.app_agentes_salvar_caixa(p jsonb)
returns public.email_caixas language plpgsql security definer set search_path = '' as $$
declare
  v_c public.email_caixas;
begin
  perform public.app_agentes_exige_gestor();
  insert into public.email_caixas (endereco, provedor, ativa)
  values (lower(btrim(p ->> 'endereco')), coalesce(nullif(p ->> 'provedor', ''), 'google_workspace'),
          coalesce((p ->> 'ativa')::boolean, true))
  on conflict (endereco) do update set provedor = excluded.provedor, ativa = excluded.ativa
  returning * into v_c;
  return v_c;
end $$;

/*
 * Os tokens do OAuth da caixa, gravados no Vault pelo callback (que roda com service
 * role). Mesmo desenho de `app_salvar_gmail_conta`: o segredo novo substitui o antigo, e
 * a linha guarda só os ids.
 */
create or replace function public.app__agentes_salvar_tokens_caixa(p jsonb)
returns public.email_caixas language plpgsql security definer set search_path = '' as $$
declare
  v_c public.email_caixas;
  v_refresh uuid;
  v_access uuid;
begin
  select * into v_c from public.email_caixas where id = (p ->> 'caixa_id')::uuid for update;
  if v_c.id is null then
    raise exception 'Caixa não encontrada.' using errcode = 'no_data_found';
  end if;
  if nullif(p ->> 'refresh_token', '') is not null then
    if v_c.refresh_token_secret_id is not null then
      perform vault.update_secret(v_c.refresh_token_secret_id, p ->> 'refresh_token');
      v_refresh := v_c.refresh_token_secret_id;
    else
      v_refresh := vault.create_secret(p ->> 'refresh_token', 'caixa_refresh_' || v_c.id::text || '_' || extract(epoch from now())::bigint::text, 'Refresh token da caixa ' || v_c.endereco);
    end if;
  end if;
  if nullif(p ->> 'access_token', '') is not null then
    if v_c.access_token_secret_id is not null then
      perform vault.update_secret(v_c.access_token_secret_id, p ->> 'access_token');
      v_access := v_c.access_token_secret_id;
    else
      v_access := vault.create_secret(p ->> 'access_token', 'caixa_access_' || v_c.id::text || '_' || extract(epoch from now())::bigint::text, 'Access token da caixa ' || v_c.endereco);
    end if;
  end if;
  update public.email_caixas set
    refresh_token_secret_id = coalesce(v_refresh, refresh_token_secret_id),
    access_token_secret_id = coalesce(v_access, access_token_secret_id),
    access_token_expira_em = coalesce(nullif(p ->> 'access_token_expira_em', '')::timestamptz, access_token_expira_em),
    escopos = case when p ? 'escopos' then array(select jsonb_array_elements_text(p -> 'escopos')) else escopos end,
    conectada_em = case when nullif(p ->> 'refresh_token', '') is not null then now() else conectada_em end,
    conectada_por = coalesce(nullif(p ->> 'conectada_por', '')::uuid, conectada_por),
    ultimo_erro = null,
    ativa = true
  where id = v_c.id returning * into v_c;
  return v_c;
end $$;

-- ─── §7 A reunião marcada pela IA ───────────────────────────────────────────
--
-- Passa por `sdr_leads`, com o AGENTE como SDR, e não por um caminho paralelo:
--   • a fila de aceite do closer (0267 — "o closer aprova toda reunião à mão") vale;
--   • a regra "reunião marcada por IA não abre titularidade de SDR" (comissoes-v2) vale;
--   • a venda, o evento na agenda do closer e o convite do Google saem pelo mesmo
--     `vendedor_eventos.google_pendente_em` que a reunião de um SDR humano usa.
--
-- Lead aberto de OUTRO SDR (humano) na mesma empresa: recusa. A IA não toma lead de
-- ninguém.

create or replace function public.app__agente_agendar_reuniao(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_m public.mandatos;
  v_a public.vendedores;
  v_closer uuid := (p ->> 'closer_id')::uuid;
  v_inicio timestamptz := (p ->> 'inicio')::timestamptz;
  v_duracao int := coalesce((p ->> 'duracao_min')::int, 30);
  v_modalidade text := coalesce(nullif(p ->> 'modalidade', ''), 'meet');
  v_participantes jsonb := coalesce(p -> 'participantes', '[]'::jsonb);
  v_lead public.sdr_leads;
  v_empresa public.empresas;
  v_venda uuid;
  v_evento uuid;
begin
  select * into v_m from public.mandatos where id = (p ->> 'mandato_id')::uuid for update;
  if v_m.id is null then
    raise exception 'Mandato não encontrado.' using errcode = 'no_data_found';
  end if;
  select * into v_a from public.vendedores where id = v_m.agente_id;
  if v_closer is null or v_closer not in (coalesce(v_a.closer_id, '00000000-0000-0000-0000-000000000000'::uuid),
                                          coalesce(v_a.closer_substituto_id, '00000000-0000-0000-0000-000000000000'::uuid)) then
    raise exception 'A reunião vai para o closer designado do agente (ou o substituto).'
      using errcode = '22023', detail = 'closer_invalido';
  end if;
  if v_inicio is null or v_inicio <= now() then
    raise exception 'Horário da reunião inválido.' using errcode = '22023';
  end if;
  if v_modalidade not in ('meet', 'presencial', 'telefone', 'a_definir') then
    raise exception 'Modalidade inválida.' using errcode = '22023';
  end if;

  select * into v_empresa from public.empresas where id = v_m.empresa_id;

  select * into v_lead from public.sdr_leads
   where empresa_id = v_m.empresa_id and encerrado_em is null
   order by atualizado_em desc limit 1 for update;
  if v_lead.id is not null and v_lead.sdr_id <> v_a.id then
    raise exception 'Esta empresa já tem um lead aberto com outro SDR.'
      using errcode = '42501', detail = 'lead_de_outro_sdr';
  end if;
  if v_lead.id is null then
    insert into public.sdr_leads (empresa_id, sdr_id, origem, estagio, distribuido_em, ultimo_toque_em, atualizado_em)
    values (v_m.empresa_id, v_a.id, 'manual', 'em_conversa', now(), now(), now())
    returning * into v_lead;
  end if;

  update public.sdr_leads set estagio = 'reuniao_agendada', reuniao_em = v_inicio,
         vendedor_destino_id = v_closer, ultimo_toque_em = now(), atualizado_em = now()
   where id = v_lead.id returning * into v_lead;

  select id into v_venda from public.vendas
   where empresa_id = v_m.empresa_id and situacao <> 'perdido' and primeira_operacao_em is null
   order by criada_em desc limit 1;
  if v_venda is null then
    insert into public.vendas (empresa_id, vendedor_id, sdr_lead_id, estagio)
    values (v_m.empresa_id, v_closer, v_lead.id, 'reuniao_agendada')
    returning id into v_venda;
  else
    update public.vendas set sdr_lead_id = coalesce(sdr_lead_id, v_lead.id), atualizada_em = now()
     where id = v_venda;
  end if;

  insert into public.vendedor_eventos (
    vendedor_id, acompanhantes, empresa_id, titulo, inicio_em, duracao_min,
    sdr_lead_id, venda_id, modalidade, local, participantes, descricao, criado_por, google_pendente_em
  ) values (
    v_closer, '{}'::uuid[], v_m.empresa_id,
    'Reunião — ' || coalesce(v_empresa.razao_social, 'empresa'),
    v_inicio, v_duracao, v_lead.id, v_venda, v_modalidade, nullif(p ->> 'local', ''),
    v_participantes,
    -- §7.3: o resumo do mandato vai na descrição do convite do closer.
    coalesce(nullif(p ->> 'descricao', ''), 'Reunião marcada pelo agente ' || v_a.nome || ' (' || v_m.codigo || ').'),
    null, now()
  )
  returning id into v_evento;

  if nullif(p ->> 'reserva_id', '') is not null then
    update public.agenda_reservas set confirmada_em = now() where id = (p ->> 'reserva_id')::uuid;
  end if;

  update public.mandatos set reuniao_id = v_evento, sdr_lead_id = v_lead.id where id = v_m.id;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_m.empresa_id, 'sdr.reuniao_agendada',
    jsonb_build_object(
      'resumo', 'Reunião agendada pelo agente ' || v_a.nome || ' para '
                || to_char(v_inicio at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') || '.',
      'url', '/comercial/vendas/' || v_venda, 'lead_id', v_lead.id, 'venda_id', v_venda,
      'evento_id', v_evento, 'modalidade', v_modalidade, 'vendedor_destino_id', v_closer),
    null);
  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_m.empresa_id, 'reuniao.agendada_por_ia',
    jsonb_build_object(
      'titulo', 'Reunião marcada por ' || v_a.nome,
      'resumo', coalesce(v_empresa.razao_social, 'Empresa') || ' — '
                || to_char(v_inicio at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') || '.',
      'url', '/agentes/mandatos?m=' || v_m.id, 'mandato_id', v_m.id, 'agente_id', v_a.id,
      'vendedor_destino_id', v_closer, 'evento_id', v_evento,
      -- O closer é quem precisa saber (regra `nomeados`): a reunião está na agenda DELE.
      'destinatarios', coalesce((select jsonb_agg(c.usuario_id) from public.vendedores c
                                  where c.id = v_closer and c.usuario_id is not null), '[]'::jsonb)),
    null);

  return jsonb_build_object('evento_id', v_evento, 'venda_id', v_venda, 'lead_id', v_lead.id);
end $$;

-- ─── §6.1 `mover_estagio_funil` com efeito de verdade ───────────────────────
--
-- Era um no-op que contava como executado. Agora move — mas só PARA FRENTE e só entre
-- estágios que uma conversa pode justificar. `convertida` não sai daqui (é a plataforma
-- que carimba) e `perdida` exige motivo de uma pessoa.

create or replace function public.app__agente_mover_estagio(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_m public.mandatos;
  v_estagio text := p ->> 'estagio';
  v_atual text;
  v_ordem_nf text[] := array['a_prospectar', 'em_prospeccao', 'em_negociacao'];
  v_ordem_lead text[] := array['a_contatar', 'em_conversa', 'qualificada'];
begin
  select * into v_m from public.mandatos where id = (p ->> 'mandato_id')::uuid;
  if v_m.id is null then
    raise exception 'Mandato não encontrado.' using errcode = 'no_data_found';
  end if;

  if v_m.tipo = 'originacao_nf' then
    if v_m.nota_access_key is null then
      raise exception 'Este mandato não tem nota.' using errcode = '22023';
    end if;
    if not (v_estagio = any (v_ordem_nf)) then
      raise exception 'Estágio de nota que o agente pode dar: em_prospeccao ou em_negociacao.' using errcode = '22023';
    end if;
    select estagio_funil into v_atual from public.notas_fiscais where access_key = v_m.nota_access_key;
    if array_position(v_ordem_nf, v_atual) is null or array_position(v_ordem_nf, v_estagio) <= array_position(v_ordem_nf, v_atual) then
      return jsonb_build_object('movido', false, 'de', v_atual, 'motivo', 'só para frente, a partir do começo do funil');
    end if;
    update public.notas_fiscais set estagio_funil = v_estagio, estagio_alterado_em = now()
     where access_key = v_m.nota_access_key;
  else
    if not (v_estagio = any (v_ordem_lead)) then
      raise exception 'Estágio de lead que o agente pode dar: em_conversa ou qualificada.' using errcode = '22023';
    end if;
    select l.estagio into v_atual from public.sdr_leads l
     where l.empresa_id = v_m.empresa_id and l.encerrado_em is null and l.sdr_id = v_m.agente_id
     order by l.atualizado_em desc limit 1;
    if v_atual is null then
      insert into public.sdr_leads (empresa_id, sdr_id, origem, estagio, distribuido_em, ultimo_toque_em, atualizado_em)
      values (v_m.empresa_id, v_m.agente_id, 'manual', v_estagio, now(), now(), now());
      v_atual := 'a_contatar';
    elsif array_position(v_ordem_lead, v_atual) is null or array_position(v_ordem_lead, v_estagio) <= array_position(v_ordem_lead, v_atual) then
      return jsonb_build_object('movido', false, 'de', v_atual, 'motivo', 'só para frente');
    else
      update public.sdr_leads set estagio = v_estagio, ultimo_toque_em = now(), atualizado_em = now()
       where empresa_id = v_m.empresa_id and encerrado_em is null and sdr_id = v_m.agente_id;
    end if;
  end if;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_m.empresa_id, case when v_m.tipo = 'originacao_nf' then 'nf.estagio_alterado' else 'sdr.lead_movido' end,
    jsonb_build_object('resumo', 'O agente moveu de ' || coalesce(v_atual, '—') || ' para ' || v_estagio || '.',
      'mandato_id', v_m.id, 'access_key', v_m.nota_access_key, 'de', v_atual, 'para', v_estagio),
    null);
  return jsonb_build_object('movido', true, 'de', v_atual, 'para', v_estagio);
end $$;

-- ─── Voz: a ligação do mandato (§4.3) ───────────────────────────────────────

create or replace function public.app__voz_enfileirar_mandato(p jsonb)
returns public.voz_ligacoes language plpgsql security definer set search_path = '' as $$
declare
  v_m public.mandatos;
  v_contato uuid := nullif(p ->> 'contato_id', '')::uuid;
  v_telefone text := public.app__telefone_e164(p ->> 'telefone');
  v_objetivo text := coalesce(nullif(p ->> 'objetivo', ''), 'ofertar_antecipacao');
  v_access_key text;
  v_cnpj text;
  v_motivo text;
  v_n int;
  v_tentativa int;
  v_linha public.voz_ligacoes;
begin
  select * into v_m from public.mandatos where id = (p ->> 'mandato_id')::uuid;
  if v_m.id is null then
    raise exception 'Mandato não encontrado.' using errcode = 'no_data_found';
  end if;
  v_access_key := case when v_objetivo = 'ofertar_antecipacao' then v_m.nota_access_key else null end;
  select cnpj into v_cnpj from public.empresas where id = v_m.empresa_id;

  v_motivo := public.app__voz_portao(v_telefone, v_contato, v_m.empresa_id, v_cnpj, v_access_key);
  if v_motivo is not null then
    raise exception '%', public.app__voz_portao_mensagem(v_motivo) using errcode = '42501', detail = v_motivo;
  end if;

  if exists (select 1 from public.voz_ligacoes
              where mandato_id = v_m.id and contato_id is not distinct from v_contato
                and status in ('a_enviar', 'enviada')) then
    raise exception 'Já existe uma ligação em andamento para este contato neste mandato.'
      using errcode = '23505', detail = 'ligacao_aberta';
  end if;

  select count(*) + 1 into v_n from public.voz_ligacoes where mandato_id = v_m.id;
  -- A `tentativa` é por NOTA (índice único parcial da 0270a); o sufixo do id externo é
  -- por mandato. Uma ligação manual anterior sobre a mesma nota já ocupou a tentativa 1.
  if v_access_key is not null then
    select coalesce(max(tentativa), 0) + 1 into v_tentativa from public.voz_ligacoes where access_key = v_access_key;
  end if;

  insert into public.voz_ligacoes (
    access_key, tentativa, id_externo, fornecedor_cnpj, empresa_id, contato_id, telefone,
    status, pedido, origem, objetivo, mandato_id, agendada_para
  ) values (
    v_access_key, coalesce(v_tentativa, 1), v_m.codigo || ':' || v_n,
    case when v_access_key is not null then (select fornecedor_cnpj from public.notas_fiscais where access_key = v_access_key) else null end,
    v_m.empresa_id, v_contato, v_telefone, 'a_enviar',
    jsonb_build_object('contexto', p -> 'contexto'),
    'agente', v_objetivo, v_m.id, nullif(p ->> 'agendada_para', '')::timestamptz
  )
  returning * into v_linha;
  return v_linha;
end $$;

-- ─── O gancho do mandato, preenchido (0270a o deixou vazio) ─────────────────
--
-- Na transação da RPC de resultado: acorda o mandato e escreve na AÇÃO que pediu a ligação
-- o resultado e o sinal que o disjuntor lê. O consumo do desfecho estruturado (contato
-- indicado, retorno) é feito pelo worker logo depois, fora desta transação.

create or replace function public.app__voz_resultado_para_mandato(p_linha public.voz_ligacoes, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_sinal text;
begin
  if p_linha.mandato_id is null then
    return;
  end if;
  v_sinal := case
    when p_linha.outcome = 'pediu_para_nao_contatar' then 'supressao'
    when p_linha.outcome in ('nao_tem_interesse', 'recusa') then 'sem_interesse'
    when p_linha.outcome in ('transferido_humano', 'quer_negociar', 'objecao_taxa') then 'escalacao'
    when p_linha.status = 'falhou' then 'falha_tecnica'
    else 'ok'
  end;
  update public.mandato_acoes set
    resultado = coalesce(resultado, '{}'::jsonb) || jsonb_build_object(
      'ligacao_status', p_linha.status, 'outcome', p_linha.outcome, 'resumo', p_linha.resumo),
    sinal = v_sinal,
    sucesso = p_linha.status = 'concluida'
   where voz_ligacao_id = p_linha.id;
  if p_linha.comunicacao_id is not null then
    insert into public.mandato_conversas (mandato_id, conversa_id)
    select p_linha.mandato_id, c.conversa_id from public.comunicacoes c
     where c.id = p_linha.comunicacao_id and c.conversa_id is not null
    on conflict do nothing;
  end if;
  update public.mandatos set proxima_acao_em = now(),
         estado = case when estado = 'aguardando_externo' then 'em_andamento' else estado end
   where id = p_linha.mandato_id and estado in ('aberto', 'em_andamento', 'aguardando_externo');
end $$;

create or replace function public.app__voz_varrer_orfas(p_minutos int)
returns table (id uuid, id_externo text, mandato_id uuid)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  update public.voz_ligacoes v set
    status = 'falhou',
    erro = 'timeout: nenhum resultado da Ana em ' || p_minutos || ' minutos',
    motivo_recusa = 'timeout',
    encerrada_em = now()
  where v.status = 'enviada'
    and coalesce(v.enviada_em, v.atualizada_em) < now() - make_interval(mins => greatest(p_minutos, 5))
  returning v.id, v.id_externo, v.mandato_id;
end $$;

-- ─── Reservas de janela (§7.5) ──────────────────────────────────────────────
--
-- Reservar trava as reservas do closer e recusa sobreposição com outra reserva viva ou
-- com reunião já marcada. Devolve o id; a reserva expira sozinha.

create or replace function public.app__agenda_reservar(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_closer uuid := (p ->> 'closer_id')::uuid;
  v_inicio timestamptz := (p ->> 'inicio')::timestamptz;
  v_fim timestamptz := (p ->> 'fim')::timestamptz;
  v_min int := coalesce((p ->> 'minutos')::int, 30);
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('agenda:' || v_closer::text));
  if exists (select 1 from public.agenda_reservas r
              where r.closer_id = v_closer and r.expira_em > now() and r.confirmada_em is null
                and tstzrange(r.inicio, r.fim) && tstzrange(v_inicio, v_fim)
                and r.mandato_id is distinct from nullif(p ->> 'mandato_id', '')::uuid)
     or exists (select 1 from public.vendedor_eventos e
                 where e.vendedor_id = v_closer and e.cancelado_em is null
                   and tstzrange(e.inicio_em, e.inicio_em + make_interval(mins => coalesce(e.duracao_min, 30)))
                       && tstzrange(v_inicio, v_fim)) then
    return jsonb_build_object('ok', false, 'motivo', 'ocupado');
  end if;
  insert into public.agenda_reservas (closer_id, mandato_id, inicio, fim, expira_em)
  values (v_closer, nullif(p ->> 'mandato_id', '')::uuid, v_inicio, v_fim, now() + make_interval(mins => v_min))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'reserva_id', v_id);
end $$;

-- ─── Grants ─────────────────────────────────────────────────────────────────

do $$
declare
  f text;
begin
  foreach f in array array[
    'app__agentes_proximo_codigo()', 'app__agentes_orcamento_do_mes(date)', 'app__agentes_reservar(jsonb)',
    'app__agentes_consumir(jsonb)', 'app__agentes_estornar(jsonb)', 'app__agentes_consumo_direto(jsonb)',
    'app__agentes_alertas_orcamento()', 'app__agentes_criar_mandato(jsonb)', 'app__agentes_salvar_tokens_caixa(jsonb)',
    'app__agente_agendar_reuniao(jsonb)', 'app__agente_mover_estagio(jsonb)', 'app__voz_enfileirar_mandato(jsonb)',
    'app__voz_resultado_para_mandato(public.voz_ligacoes, jsonb)', 'app__voz_varrer_orfas(int)',
    'app__agenda_reservar(jsonb)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;

  foreach f in array array[
    'app_agentes_criar_mandato(jsonb)', 'app_agentes_mandato_acao(jsonb)', 'app_agentes_decidir_proposta(jsonb)',
    'app_agentes_salvar_regra(jsonb)', 'app_agentes_ligar_regra(jsonb)', 'app_agentes_registrar_previa(jsonb)',
    'app_agentes_salvar_persona(jsonb)', 'app_agentes_pausar_agente(jsonb)', 'app_agentes_reabrir_disjuntor(jsonb)',
    'app_agentes_salvar_disjuntor(jsonb)', 'app_agentes_salvar_material(jsonb)', 'app_agentes_salvar_config(jsonb)',
    'app_agentes_salvar_caixa(jsonb)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

grant execute on function public.app__agentes_mes_atual() to authenticated, service_role;
