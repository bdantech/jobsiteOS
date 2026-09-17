-- ═════════════════════════════════════════════════════════════════════════════
-- 0213 — A base legal deixa de ser porta, a reunião do SDR nasce com 30 min,
--        e o acesso cruzado se enxerga na tela
--
-- Três correções reportadas no mesmo dia. Moram juntas porque são pequenas e
-- independentes entre si — nenhuma depende da outra para fazer sentido.
--
-- ─── 1. BASE LEGAL NÃO RECUSA MAIS O ENVIO ──────────────────────────────────
-- `contatos.base_legal` nasceu como porta (0155): sem base registrada, ninguém era
-- abordado. A intenção era boa e a régua estava no lugar certo — o portão do §1.4,
-- repetido aqui na RPC de enfileiramento, como manda a 0144.
--
-- O que a prática mostrou é que a coluna não media o que o nome dela promete. Todo
-- telefone que chega a este sistema tem base: a NF-e é dado público, o contato
-- cadastrado à mão veio de relação comercial, o do formulário deu aceite. O que a
-- coluna nula media era OUTRA coisa — que ninguém preencheu o campo naquele caminho
-- de entrada. E uma trava sobre preenchimento, numa tela de vender, não protege
-- ninguém: ela ensina a pessoa a procurar outro jeito de mandar a mensagem, que é
-- exatamente o caminho sem registro nenhum.
--
-- Então o valor continua sendo gravado e continua servindo para o que ele de fato
-- decide — o link de descadastro (`exigeDescadastro`) e a pergunta "como chegamos a
-- esta pessoa?". Ele só não recusa mais. Quem recusa continua recusando: supressão
-- (que é a PESSOA pedindo para não receber, e essa nenhuma confirmação fura), kill
-- switch, teto da thread, teto da conta, cooldown e janela.
--
-- A trava some nas três camadas de uma vez — RPC (aqui), portão do worker
-- (`packages/core/src/comunicacao/portao.ts`) e compositor. Tirar de uma só faria a
-- mensagem passar numa tela e morrer na fila, que é a pior das duas falhas.
--
-- O que esta migração NÃO toca: `campanhas/exclusao.ts` continua excluindo do
-- público de campanha quem não tem base registrada. Campanha é escolher A QUEM
-- falar em lote, e mudar esse recorte muda o tamanho de disparos já planejados —
-- é decisão de outra pessoa, em outro momento.
--
-- ─── 2. A REUNIÃO QUE O SDR MARCA NASCE COM 30 MINUTOS ──────────────────────
-- `vendedor_eventos.duracao_min` tem default 60 desde a 0091, e o agendamento do
-- funil de reuniões não informa duração — ou seja, toda reunião marcada pelo SDR
-- entrava na agenda do closer (e no convite do Google, que é o que o cliente vê)
-- ocupando uma hora. A conversa de descoberta é de meia hora, e a diferença não é
-- cosmética: ela bloqueia o dobro da agenda de quem fecha e pede o dobro do tempo
-- de quem ainda não decidiu conversar com a gente.
--
-- O 30 entra no INSERT, e não como novo default da coluna: quem cria evento por
-- outros caminhos (a aba Reunião, o calendário) continua com a régua de lá, e a aba
-- Reunião continua podendo ajustar a duração depois. O UPDATE de remarcação não
-- mexe em `duracao_min` de propósito — uma reunião que o closer esticou para uma
-- hora não deve encolher porque o SDR mudou o horário.
--
-- Aceita `duracao_min` no payload para quando a tela quiser oferecer o campo; sem
-- ele, 30.
--
-- ─── 3. `sou_eu` NAS DUAS LISTAS DE VENDEDOR VISÍVEL ────────────────────────
-- As telas do Comercial decidem se mostram o seletor de vendedor contando a lista:
-- "mais de um → há escolha a fazer". A conta erra no caso que mais importa — o
-- closer que recebeu acesso cruzado a UMA pessoa. A lista dele filtrada por tipo
-- tem um item, a conta dá 1, e o seletor não aparece; o acesso fica publicado no
-- banco e sem porta na tela.
--
-- O que a tela precisa saber não é quantos são, é se há alguém ALÉM DE MIM. Isso o
-- banco sabe e o cliente não: a lista não dizia qual dos nomes é o de quem
-- perguntou. `sou_eu` é esse campo. As duas funções ganham juntas porque as duas
-- alimentam seletores, e uma régua que vale só em metade das telas é a mesma
-- confusão de antes.
--
-- As duas devolvem jsonb, então nenhum tipo gerado muda com isto.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── 1. Enfileirar sem a trava de base legal ────────────────────────────────

create or replace function public.app_comunicacao_enfileirar(p jsonb)
returns public.mensagens_outbox
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_ator uuid := auth.uid();
  v_canal text := p ->> 'canal';
  v_contato public.contatos;
  v_destino text;
  v_ident text;
  v_empresa public.empresas;
  v_msg public.mensagens_outbox;
  v_conversa uuid;
  v_vendedor uuid;
  v_cooldown int;
  v_ultimo timestamptz;
begin
  if not public.app_tem_modulo('comunicacao') then
    raise exception 'Sem acesso ao módulo Comunicação.' using errcode = '42501';
  end if;
  if v_canal not in ('whatsapp', 'email') then
    raise exception 'Canal inválido: %.', v_canal using errcode = '22023';
  end if;
  if nullif(p ->> 'corpo', '') is null then
    raise exception 'A mensagem está vazia.' using errcode = '23514';
  end if;

  select * into v_contato from public.contatos where id = (p ->> 'contato_id')::uuid;
  if v_contato.id is null then
    raise exception 'Contato não encontrado.' using errcode = 'no_data_found';
  end if;
  select * into v_empresa from public.empresas where id = v_contato.empresa_id;

  v_destino := case when v_canal = 'email' then v_contato.email
                    else coalesce(v_contato.whatsapp, v_contato.telefone) end;
  v_ident := public.app__identificador_canonico(v_canal, v_destino);
  if v_ident is null then
    raise exception 'Este contato não tem % cadastrado.', v_canal using errcode = '23514';
  end if;

  if exists (
    select 1 from public.supressao s
    where s.valor = v_ident
      and s.escopo = case when v_canal = 'email' then 'email' else 'whatsapp' end
      and (s.expira_em is null or s.expira_em >= current_date)
  ) or exists (
    select 1 from public.supressao s
    where s.escopo = 'empresa' and s.valor = v_empresa.cnpj
      and (s.expira_em is null or s.expira_em >= current_date)
  ) then
    raise exception 'Este destinatário está na lista de supressão.' using errcode = '42501';
  end if;

  -- A recusa por `v_contato.base_legal is null` ficava aqui. Ver o cabeçalho: o
  -- campo continua gravado e continua decidindo o link de descadastro; ele só não
  -- é mais motivo de recusa, nem aqui, nem no portão do worker, nem no compositor.

  v_cooldown := coalesce((select (valor #>> '{}')::int from public.comunicacao_config
                          where chave = 'cooldown_dias'), 3);
  if v_cooldown > 0 and coalesce((p ->> 'ignorar_cooldown')::boolean, false) is not true then
    select max(criado_em) into v_ultimo from public.comunicacoes
      where contato_id = v_contato.id and direcao = 'saida';
    if v_ultimo is not null and v_ultimo > now() - make_interval(days => v_cooldown) then
      raise exception 'Falamos com este contato há menos de % dia(s).', v_cooldown
        using errcode = '23514';
    end if;
  end if;

  select vc.vendedor_id into v_vendedor
    from public.vendedor_carteira vc
    where vc.empresa_id = v_empresa.id and vc.ate is null
    order by case vc.papel when 'originacao' then 1 when 'sdr' then 2 else 3 end
    limit 1;
  v_vendedor := coalesce(
    (select v.id from public.vendedores v where v.usuario_id = v_ator limit 1),
    v_vendedor
  );

  v_conversa := public.app__conversa_para(v_canal, v_ident, v_empresa.id, v_contato.id, v_vendedor);

  insert into public.mensagens_outbox (
    canal, fornecedor_cnpj, fornecedor_nome, fornecedor_empresa_id,
    destinatario, destinatario_contato_id, destinatario_ponto_focal,
    whatsapp_conta_id, access_keys, assunto, corpo, status,
    conversa_id, empresa_id, vendedor_id, template_id, criada_por, origem,
    funil, funil_card_id, agendada_para
  ) values (
    v_canal, v_empresa.cnpj, coalesce(v_empresa.razao_social, v_empresa.nome_fantasia), v_empresa.id,
    v_ident, v_contato.id, coalesce(v_contato.ponto_focal, false),
    nullif(p ->> 'whatsapp_conta_id', '')::uuid, '{}',
    nullif(p ->> 'assunto', ''), p ->> 'corpo',
    'aprovada',
    v_conversa, v_empresa.id, v_vendedor, nullif(p ->> 'template_id', '')::uuid, v_ator, 'compositor',
    nullif(p ->> 'funil', ''), nullif(p ->> 'funil_card_id', ''),
    case when coalesce((p ->> 'forcar_janela')::boolean, false) then now() else null end
  ) returning * into v_msg;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'comunicacao.enfileirada', 'mensagens_outbox', v_msg.id::text, p - 'corpo');

  return v_msg;
end $$;

-- ─── 2. A reunião do SDR nasce com 30 minutos ───────────────────────────────

create or replace function public.app_mover_lead_sdr(p jsonb)
returns public.sdr_leads
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_ator uuid := auth.uid();
  v_lead public.sdr_leads;
  v_estagio text := nullif(p ->> 'estagio', '');
  v_tem_fit boolean := p ? 'fit' and jsonb_typeof(p -> 'fit') = 'boolean';
  v_fit boolean := (p ->> 'fit')::boolean;
  v_motivo uuid := nullif(p ->> 'sem_fit_motivo', '')::uuid;
  v_reuniao timestamptz := nullif(p ->> 'reuniao_em', '')::timestamptz;
  v_destino uuid := nullif(p ->> 'vendedor_destino_id', '')::uuid;
  v_modalidade text := coalesce(nullif(p ->> 'modalidade', ''), 'meet');
  v_local text := nullif(p ->> 'local', '');
  v_participantes jsonb := coalesce(p -> 'participantes', '[]'::jsonb);
  -- Meia hora: é o tamanho da conversa de descoberta. Ver o cabeçalho da 0213.
  v_duracao int := coalesce(nullif(p ->> 'duracao_min', '')::int, 30);
  v_empresa public.empresas;
  v_venda_id uuid;
  v_evento_id uuid;
  v_remarcou boolean := false;
begin
  if not public.app_tem_modulo('comercial') then
    raise exception 'Sem acesso ao módulo Comercial.' using errcode = '42501';
  end if;

  select * into v_lead from public.sdr_leads where id = (p ->> 'lead_id')::uuid;
  if v_lead.id is null then
    raise exception 'Lead não encontrado.' using errcode = 'no_data_found';
  end if;
  select * into v_empresa from public.empresas where id = v_lead.empresa_id;

  if v_tem_fit and v_lead.estagio = 'a_contatar' and coalesce(v_estagio, '') = 'a_contatar' then
    raise exception 'Avalie o fit depois de contatar a empresa.' using errcode = '22023';
  end if;
  if v_tem_fit and not v_fit and v_motivo is null then
    raise exception 'Sem fit exige motivo.' using errcode = '22023';
  end if;
  if v_lead.estagio = 'a_contatar' and v_estagio = 'em_conversa' then
    raise exception 'O lead entra em conversa sozinho, quando a primeira mensagem sair.'
      using errcode = '42501';
  end if;
  if v_estagio = 'reuniao_agendada' and (v_reuniao is null or v_destino is null) then
    raise exception 'Agendar exige data e vendedor destino.' using errcode = '22023';
  end if;
  if v_modalidade not in ('meet', 'presencial', 'telefone', 'a_definir') then
    raise exception 'Modalidade inválida.' using errcode = '22023';
  end if;
  if v_estagio = 'reuniao_agendada' and v_modalidade = 'presencial' and v_local is null then
    raise exception 'Reunião presencial exige o local.' using errcode = '22023';
  end if;
  if v_duracao < 15 or v_duracao > 480 then
    raise exception 'Duração fora do razoável: % min.', v_duracao using errcode = '22023';
  end if;

  update public.sdr_leads set
    estagio = coalesce(v_estagio, estagio),
    fit = case when v_tem_fit then v_fit else fit end,
    fit_definido_em = case when v_tem_fit then now() else fit_definido_em end,
    sem_fit_motivo = case when v_tem_fit and not v_fit then v_motivo else sem_fit_motivo end,
    encerrado_em = case
      when v_tem_fit and not v_fit then now()
      when v_tem_fit and v_fit and encerrado_motivo = 'sem_fit' then null
      else encerrado_em end,
    encerrado_motivo = case
      when v_tem_fit and not v_fit then 'sem_fit'
      when v_tem_fit and v_fit and encerrado_motivo = 'sem_fit' then null
      else encerrado_motivo end,
    reuniao_em = coalesce(v_reuniao, reuniao_em),
    vendedor_destino_id = coalesce(v_destino, vendedor_destino_id),
    ultimo_toque_em = now(),
    atualizado_em = now()
  where id = v_lead.id
  returning * into v_lead;

  if v_estagio = 'reuniao_agendada' then
    select id into v_venda_id
    from public.vendas
    where sdr_lead_id = v_lead.id and estagio not in ('ganho', 'perdido')
    order by criada_em desc limit 1;

    if v_venda_id is null then
      insert into public.vendas (empresa_id, vendedor_id, sdr_lead_id, estagio)
      values (v_lead.empresa_id, v_destino, v_lead.id, 'reuniao_agendada')
      returning id into v_venda_id;
    else
      v_remarcou := true;
      update public.vendas set
        vendedor_id = v_destino,
        estagio = case when estagio in ('reuniao_agendada', 'reuniao_reagendada')
                       then 'reuniao_reagendada' else estagio end,
        atualizada_em = now()
      where id = v_venda_id;
    end if;

    select id into v_evento_id
    from public.vendedor_eventos
    where sdr_lead_id = v_lead.id and tipo = 'reuniao' and cancelado_em is null
    order by criado_em desc limit 1;

    if v_evento_id is null then
      insert into public.vendedor_eventos (
        vendedor_id, acompanhantes, empresa_id, titulo, inicio_em, duracao_min,
        sdr_lead_id, venda_id,
        modalidade, local, participantes, criado_por, google_pendente_em
      )
      values (
        v_destino,
        case when v_lead.sdr_id = v_destino then '{}'::uuid[] else array[v_lead.sdr_id] end,
        v_lead.empresa_id,
        'Reunião — ' || coalesce(v_empresa.razao_social, 'empresa'),
        v_reuniao, v_duracao, v_lead.id, v_venda_id,
        v_modalidade, v_local, v_participantes, v_ator, now()
      )
      returning id into v_evento_id;
    else
      -- A remarcação NÃO mexe na duração: quem esticou a reunião para uma hora foi
      -- o closer, e mudar o horário não é motivo para desfazer aquilo.
      update public.vendedor_eventos set
        vendedor_id = v_destino,
        acompanhantes = case when v_lead.sdr_id = v_destino then '{}'::uuid[]
                             else array[v_lead.sdr_id] end,
        venda_id = v_venda_id,
        inicio_em = v_reuniao,
        modalidade = v_modalidade,
        local = v_local,
        participantes = case when v_participantes = '[]'::jsonb then participantes
                             else v_participantes end,
        google_pendente_em = now(),
        atualizado_em = now()
      where id = v_evento_id;
    end if;

    insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
    values (v_lead.empresa_id, 'sdr.reuniao_agendada',
      jsonb_build_object(
        'resumo', case when v_remarcou then 'Reunião remarcada para ' else 'Reunião agendada para ' end
                  || to_char(v_reuniao at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') || '.',
        'url', '/comercial/vendas/' || v_venda_id,
        'lead_id', v_lead.id, 'venda_id', v_venda_id, 'evento_id', v_evento_id,
        'remarcada', v_remarcou, 'modalidade', v_modalidade, 'vendedor_destino_id', v_destino),
      v_ator);
  elsif v_estagio = 'no_show' then
    insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
    values (v_lead.empresa_id, 'sdr.no_show',
      jsonb_build_object('resumo', 'Reunião marcada e não aconteceu (no-show).', 'lead_id', v_lead.id),
      v_ator);
  end if;

  if v_tem_fit and not v_fit then
    insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
    values (v_lead.empresa_id, 'sdr.sem_fit',
      jsonb_build_object(
        'resumo', 'Sem fit (' || v_lead.estagio || '): ' ||
                  coalesce((select m.motivo from public.motivos_perda m where m.id = v_motivo), '—') || '.',
        'lead_id', v_lead.id, 'motivo_id', v_motivo, 'estagio', v_lead.estagio, 'origem', v_lead.origem),
      v_ator);
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'sdr.lead_movido', 'sdr_leads', v_lead.id::text, p);

  return v_lead;
end $$;

-- ─── 3. `sou_eu` nas listas que alimentam os seletores ──────────────────────

create or replace function public.comercial_vendedores_visiveis()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.nome), '[]'::jsonb)
  from (
    select v.id, v.nome, v.tipo, v.is_ia,
           v.id is not distinct from public.app_vendedor_atual() as sou_eu
    from public.vendedores v
    where v.ativo and public.app_tem_modulo('comercial') and public.app_pode_ver_vendedor(v.id)
  ) x;
$$;

create or replace function public.comercial_vendedores_da_comissao()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.nome), '[]'::jsonb)
  from (
    select v.id, v.nome, v.tipo, v.is_ia,
           v.id is not distinct from public.app_vendedor_atual() as sou_eu
    from public.vendedores v
    where v.ativo
      and public.app_tem_modulo('comercial')
      and v.id = any (coalesce(public.app_vendedores_visiveis_comissao(), '{}'::uuid[]))
  ) x;
$$;
