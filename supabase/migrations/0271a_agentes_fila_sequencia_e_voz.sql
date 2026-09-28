-- ============================================================================
-- 0271a — Agentes: a sequência das ações, o desfecho que só entra uma vez e o
-- cancelamento de ligação que não perde o que a Ana ouviu
--
-- A auditoria do módulo de agentes (0270*) achou cinco defeitos. Três moram aqui; os
-- outros dois (a fila travada por mandatos pulados e a ligação de agendamento sem
-- janelas) são só do worker, no mesmo commit.
--
--   1. `mandato_acoes.sequencia` passa a ser do BANCO. O ciclo calculava max+1 uma vez e
--      somava em memória; o desfecho da ligação calculava o seu próprio max+1 ao mesmo
--      tempo. O `unique (mandato_id, sequencia)` recusava um dos dois e a ação sumia do
--      registro, com um log que ninguém lia.
--   2. O desfecho de uma ligação é consumido UMA vez. A Ana reenvia o webhook até receber
--      2xx; a RPC de resultado já era idempotente, o consumo pelo mandato não era — cada
--      reenvio gravava outra ação, outro evento e, no pior caso, outra reunião.
--   3. Cancelar uma ligação `enviada` na tela não descarta mais o resultado que a Ana
--      manda depois; o cancelamento acorda o mandato dono da ligação; e só cancela ligação
--      de mandato quem acompanha aquele agente.
--
-- As funções recriadas partem de `pg_get_functiondef` em 28/09/2026 (estado vivo), e os
-- grants são reafirmados porque `create or replace` não os toca — mas quem ler esta
-- migração sozinha precisa ver quem pode chamar o quê.
-- ============================================================================

-- ─── 1. A sequência das ações é do banco ────────────────────────────────────
--
-- Um trigger BEFORE INSERT numera toda linha, venha de onde vier (ciclo, desfecho de
-- ligação, qualquer caminho futuro). O valor que o chamador mandar é IGNORADO: se um
-- caminho pudesse escolher o próprio número, bastaria um esquecer para a colisão voltar.
--
-- A trava é um advisory lock de transação por mandato, e não uma linha de `mandatos`:
-- `mandatos` tem trigger de `atualizado_em` e está na publicação do Realtime, e numerar
-- uma ação não é mudar o mandato — cada ação viraria um UPDATE no kanban de todo mundo.
-- Com a trava, o segundo INSERT espera o primeiro terminar, e o `max` que ele lê (um
-- snapshot novo, tirado depois da trava) já enxerga a linha do primeiro.
--
-- O `default 0` existe só para o INSERT poder omitir a coluna — e para o tipo gerado a
-- tratar como opcional. Nenhuma linha fica com 0: o trigger sempre sobrescreve.

create or replace function public.mandato_acoes__numera()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext('mandato_acoes:' || new.mandato_id::text));
  select coalesce(max(a.sequencia), 0) + 1 into new.sequencia
    from public.mandato_acoes a
   where a.mandato_id = new.mandato_id;
  return new;
end $$;

revoke all on function public.mandato_acoes__numera() from public, anon, authenticated;

alter table public.mandato_acoes alter column sequencia set default 0;

create trigger mandato_acoes_numera
  before insert on public.mandato_acoes
  for each row execute function public.mandato_acoes__numera();

comment on column public.mandato_acoes.sequencia is
  'Ordem da ação dentro do mandato, atribuída pelo trigger mandato_acoes_numera (o valor enviado no INSERT é ignorado).';

-- ─── 2. O desfecho de uma ligação entra uma vez ─────────────────────────────
--
-- A linha `desfecho_ligacao` é o recibo do consumo: o worker a insere ANTES de registrar
-- contato indicado, marcar reunião ou emitir evento, com `on conflict do nothing`. O
-- reenvio da Ana bate no índice, não insere, e o worker para ali. Reivindicar primeiro é
-- o que impede a segunda reunião: `app__agente_agendar_reuniao` não sabe que já rodou.

create unique index mandato_acoes_desfecho_ligacao_key
  on public.mandato_acoes (voz_ligacao_id)
  where ferramenta = 'desfecho_ligacao';

-- ─── 3a. O resultado real vence o cancelamento ──────────────────────────────
--
-- Corpo de partida: `pg_get_functiondef` em 28/09/2026 (igual à 0270a). Mudanças:
--   • a linha cancelada na tela que NUNCA recebeu resultado (`resultado` nulo) é
--     reaberta pelo webhook, como já era a do timeout. Cancelar uma `enviada` é pedir à
--     Ana que não ligue; se ela já discou, o que foi dito ao telefone é fato, e a 0270a
--     prometia gravá-lo — mas a RPC devolvia cedo porque `encerrada_em` estava preenchido;
--   • ao reabrir, `motivo_recusa` é limpo nos dois casos. A trilha do cancelamento fica
--     em `cancelada_em`/`cancelada_por` e no audit_log;
--   • status desconhecido continua fechando como 'concluida' (o CHECK de status não tem
--     outro valor para "não sei"), e o payload cru continua inteiro em `resultado`.
--
-- O reenvio do MESMO resultado segue devolvendo a linha como está: depois do primeiro,
-- `resultado` deixa de ser nulo.

create or replace function public.app__voz_registrar_resultado(p jsonb)
returns public.voz_ligacoes language plpgsql security definer set search_path = '' as $$
declare
  v_id_externo text := nullif(btrim(coalesce(p ->> 'id_externo', '')), '');
  v_status_cru text := coalesce(nullif(p ->> 'status', ''), 'concluida');
  v_outcome_cru text := nullif(p ->> 'outcome', '');
  v_outcome text;
  v_chamada jsonb := coalesce(p -> 'chamada', '{}'::jsonb);
  v_resumo text := nullif(v_chamada ->> 'resumo', '');
  v_links jsonb := coalesce(p -> 'links', v_chamada -> 'links');
  v_custo numeric := coalesce(nullif(p ->> 'custo_centavos', '')::numeric,
                              nullif(v_chamada ->> 'custo_centavos', '')::numeric,
                              round(nullif(coalesce(p -> 'custo' ->> 'valor_brl', v_chamada -> 'custo' ->> 'valor_brl'), '')::numeric * 100));
  v_linha public.voz_ligacoes;
  v_nota public.notas_fiscais;
  v_empresa uuid;
  v_ident text;
  v_conversa uuid;
  v_comunicacao uuid;
  v_escopo_pedido text;
  v_telefone_digitos text;
  v_origem_ledger text;
  v_reabrindo boolean;
begin
  if v_id_externo is null then
    raise exception 'id_externo é obrigatório.' using errcode = '23514';
  end if;

  select * into v_linha from public.voz_ligacoes
   where id_externo = v_id_externo for update;
  if not found then
    raise exception 'Ligação desconhecida: %.', v_id_externo using errcode = 'no_data_found';
  end if;

  -- Fechada por decisão NOSSA sem nunca ter ouvido a Ana: a varredura desistiu (timeout)
  -- ou alguém cancelou na tela depois que ela já estava com a Ana. Nos dois casos o
  -- resultado real vence. Qualquer outra linha fechada já recebeu o seu webhook: devolve
  -- como está, e o reenvio não refaz ledger, supressão nem consumo.
  v_reabrindo := v_linha.encerrada_em is not null
                 and v_linha.resultado is null
                 and (coalesce(v_linha.motivo_recusa, '') = 'timeout' or v_linha.cancelada_em is not null);
  if v_linha.encerrada_em is not null and not v_reabrindo then
    return v_linha;
  end if;

  v_outcome := case
    when v_outcome_cru is null then null
    when v_outcome_cru = any (array[
      'antecipacao_solicitada', 'cadastro_iniciado', 'proposta_enviada', 'interesse_futuro',
      'retorno_agendado', 'agendado_com_decisor', 'quer_negociar', 'transferido_humano',
      'pediu_para_nao_contatar', 'recusa', 'objecao_taxa', 'nao_tem_interesse', 'pessoa_errada',
      'caixa_postal', 'nao_atendeu', 'indefinido',
      'agendar_retorno', 'indicou_outro_contato', 'reuniao_agendada', 'interesse',
      'nao_e_o_decisor']) then v_outcome_cru
    else 'desconhecido'
  end;

  if v_linha.access_key is not null then
    select * into v_nota from public.notas_fiscais where access_key = v_linha.access_key;
  end if;

  update public.voz_ligacoes set
    status = case v_status_cru
      when 'concluida' then 'concluida'
      when 'nao_atendida' then 'nao_atendida'
      when 'falhou' then 'falhou'
      when 'cancelada' then 'cancelada'
      else 'concluida' end,
    ligacao_id = coalesce(nullif(p ->> 'ligacao_id', ''), ligacao_id),
    chamada_id = coalesce(nullif(v_chamada ->> 'call_id', ''), chamada_id),
    outcome = v_outcome,
    resumo = v_resumo,
    resultado = p,
    links = coalesce(v_links, links),
    transcricao = coalesce(v_chamada -> 'transcricao', p -> 'transcricao', transcricao),
    custo_centavos = coalesce(v_custo::int, custo_centavos),
    duracao_s = coalesce(nullif(v_chamada ->> 'duracao_s', '')::numeric::int, duracao_s),
    erro = nullif(p ->> 'erro', ''),
    motivo_recusa = case when v_reabrindo then null else motivo_recusa end,
    encerrada_em = now()
  where id = v_linha.id
  returning * into v_linha;

  if v_linha.status = 'concluida' then
    v_empresa := v_linha.empresa_id;
    if v_empresa is null and v_linha.fornecedor_cnpj is not null then
      select id into v_empresa from public.empresas where cnpj = v_linha.fornecedor_cnpj;
      if v_empresa is null then
        begin
          v_empresa := (public.app__promover_fornecedor_para_empresa(
            v_linha.fornecedor_cnpj, v_linha.enfileirada_por, 'antecipacao')).id;
        exception when others then
          v_empresa := null;
        end;
      end if;
      if v_empresa is not null then
        update public.voz_ligacoes set empresa_id = v_empresa where id = v_linha.id
          returning * into v_linha;
      end if;
    end if;

    v_ident := public.app__identificador_canonico('whatsapp', v_linha.telefone);
    if v_empresa is not null and v_ident is not null then
      v_conversa := public.app__conversa_para('whatsapp', v_ident, v_empresa, v_linha.contato_id, null);
    end if;

    v_origem_ledger := case when v_linha.origem = 'agente' then 'agente' else 'sistema' end;

    insert into public.comunicacoes (
      conversa_id, empresa_id, contato_id, canal, direcao,
      por_ia, corpo, preview, provedor, id_externo, status_envio,
      origem, funil, funil_card_id, enviado_em, usuario_id
    ) values (
      v_conversa, v_empresa, v_linha.contato_id, 'ligacao', 'saida',
      true,
      v_resumo,
      'Ana ligou: ' || coalesce(v_outcome, 'sem desfecho') || '.',
      'voz', v_linha.chamada_id, 'enviada',
      v_origem_ledger,
      case when v_linha.access_key is not null then 'nfs' else null end,
      v_linha.access_key, now(), v_linha.enfileirada_por
    )
    returning id into v_comunicacao;

    update public.voz_ligacoes set comunicacao_id = v_comunicacao
      where id = v_linha.id returning * into v_linha;
  end if;

  if v_linha.access_key is not null
     and v_outcome in ('antecipacao_solicitada', 'cadastro_iniciado', 'proposta_enviada')
     and v_nota.estagio_funil in ('a_prospectar', 'em_prospeccao') then
    update public.notas_fiscais
      set estagio_funil = 'em_negociacao', estagio_alterado_em = now()
      where access_key = v_linha.access_key;
  end if;

  if v_outcome = 'pediu_para_nao_contatar' then
    v_escopo_pedido := coalesce(v_chamada -> 'nao_contatar' ->> 'escopo', 'telefone');
    v_telefone_digitos := regexp_replace(coalesce(v_linha.telefone, ''), '[^0-9]', '', 'g');

    if v_telefone_digitos <> '' then
      insert into public.supressao (escopo, valor, motivo, observacao, expira_em, contexto)
      values (
        'telefone', v_telefone_digitos, 'solicitacao_lgpd',
        'Pedido na ligação da Ana: ' ||
          coalesce(v_chamada -> 'nao_contatar' ->> 'literal', 'sem transcrição'),
        null, 'antecipacao'
      )
      on conflict (escopo, valor) do update
        set expira_em = null,
            motivo = 'solicitacao_lgpd',
            observacao = excluded.observacao;
    end if;

    if v_escopo_pedido in ('empresa', 'todos', 'tudo') and v_linha.fornecedor_cnpj is not null then
      perform public.app__suprimir_fornecedor(
        v_linha.fornecedor_cnpj,
        'Pedido na ligação da Ana (' || coalesce(v_linha.chamada_id, 'sem id') || ').',
        null, null, 'antecipacao'
      );
    elsif v_escopo_pedido in ('empresa', 'todos', 'tudo') and v_empresa is not null then
      insert into public.supressao (escopo, valor, motivo, observacao, expira_em, contexto)
      select 'empresa', e.cnpj, 'solicitacao_lgpd',
             'Pedido na ligação da Ana (' || coalesce(v_linha.chamada_id, 'sem id') || ').', null, 'comercial'
        from public.empresas e where e.id = v_empresa and e.cnpj is not null
      on conflict (escopo, valor) do update set expira_em = null, motivo = 'solicitacao_lgpd';
    end if;
  end if;

  perform public.app__voz_resultado_para_mandato(v_linha, p);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (
    null, 'voz.resultado', 'voz_ligacoes', v_linha.id_externo,
    jsonb_build_object('outcome', v_outcome, 'outcome_cru', v_outcome_cru, 'status', v_linha.status,
                       'ligacao_id', v_linha.ligacao_id, 'chamada_id', v_linha.chamada_id,
                       'reaberta', v_reabrindo)
  );

  return v_linha;
end $$;

revoke all on function public.app__voz_registrar_resultado(jsonb) from public, anon, authenticated;
grant execute on function public.app__voz_registrar_resultado(jsonb) to service_role;

-- ─── 3b. Cancelar: quem pode, e o mandato que esperava ──────────────────────
--
-- Corpo de partida: `pg_get_functiondef` em 28/09/2026 (igual à 0270a). Mudanças:
--   • ligação de MANDATO exige, além do módulo Comunicação (a tela), que a pessoa
--     acompanhe o agente: gestor de agentes, ou closer/substituto dele — a mesma régua
--     da RLS de `mandatos` (`app_agentes_visiveis`). O módulo sozinho deixava qualquer
--     operador derrubar o trabalho de um agente que ele nem vê;
--   • o mandato dono da ligação é ACORDADO. Ele estava `aguardando_externo` esperando um
--     resultado que não vem mais; sem isto ficava parado até a data do plano. A ação
--     `ligar` ganha o status no `resultado`, para o agente ler por que acordou;
--   • cancelada ainda em `a_enviar` (a Ana nunca soube), as janelas do closer oferecidas
--     nela são devolvidas na hora. Já `enviada`, elas ficam até expirar: a Ana pode ter
--     discado e confirmado uma, e o webhook que chegar depois precisa encontrá-la.

create or replace function public.app_voz_cancelar(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_linha public.voz_ligacoes;
  v_estava text;
  v_agente uuid;
begin
  if not public.app_tem_modulo('comunicacao') then
    raise exception 'Sem acesso ao módulo Comunicação.' using errcode = '42501';
  end if;
  select * into v_linha from public.voz_ligacoes where id = v_id for update;
  if v_linha.id is null then
    raise exception 'Ligação não encontrada.' using errcode = 'no_data_found';
  end if;

  if v_linha.mandato_id is not null then
    select m.agente_id into v_agente from public.mandatos m where m.id = v_linha.mandato_id;
    if not (public.app_agentes_gestor()
            or (v_agente is not null and v_agente = any (public.app_agentes_visiveis()))) then
      raise exception 'Esta ligação é de um mandato de agente que você não acompanha.'
        using errcode = '42501';
    end if;
  end if;

  if v_linha.status not in ('a_enviar', 'enviada') then
    raise exception 'Esta ligação já terminou (%).', v_linha.status using errcode = '22023';
  end if;
  v_estava := v_linha.status;

  update public.voz_ligacoes set
    status = 'cancelada',
    motivo_recusa = coalesce(nullif(p ->> 'motivo', ''), 'cancelada_na_tela'),
    cancelada_por = v_ator,
    cancelada_em = now(),
    encerrada_em = now()
  where id = v_id;

  if v_linha.mandato_id is not null then
    update public.mandato_acoes set
      resultado = coalesce(resultado, '{}'::jsonb) || jsonb_build_object(
        'ligacao_status', 'cancelada', 'cancelada_na_tela', true, 'status_anterior', v_estava)
     where voz_ligacao_id = v_linha.id and ferramenta = 'ligar';

    if v_estava = 'a_enviar' then
      update public.agenda_reservas r set expira_em = now()
       where r.mandato_id = v_linha.mandato_id
         and r.confirmada_em is null
         and r.expira_em > now()
         and r.id::text in (
           select j ->> 'id'
             from jsonb_array_elements(
                    case when jsonb_typeof(v_linha.pedido -> 'contexto' -> 'janelas') = 'array'
                         then v_linha.pedido -> 'contexto' -> 'janelas' else '[]'::jsonb end) j);
    end if;

    update public.mandatos set
      proxima_acao_em = now(),
      estado = case when estado = 'aguardando_externo' then 'em_andamento' else estado end
     where id = v_linha.mandato_id
       and estado in ('aberto', 'em_andamento', 'aguardando_externo');
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'voz.cancelar', 'voz_ligacoes', v_linha.id_externo,
          jsonb_build_object('status_anterior', v_estava, 'ligacao_id', v_linha.ligacao_id,
                             'mandato_id', v_linha.mandato_id));

  return jsonb_build_object(
    'id', v_linha.id,
    'ligacao_id', v_linha.ligacao_id,
    'mandato_id', v_linha.mandato_id,
    'cancelar_na_ana', v_estava = 'enviada' and v_linha.ligacao_id is not null
  );
end $$;

revoke all on function public.app_voz_cancelar(jsonb) from public, anon;
grant execute on function public.app_voz_cancelar(jsonb) to authenticated, service_role;
