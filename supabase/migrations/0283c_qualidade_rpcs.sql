-- ═════════════════════════════════════════════════════════════════════════════
-- 0283c — Inteligência de Conversas (05C): RPCs
--
-- Toda escrita da tela passa por aqui (SECURITY DEFINER, com a regra de quem pode
-- escrita no corpo). O worker escreve com service role, mas o que precisa ser atômico —
-- gravar uma análise com itens, pendências e eventos; recalcular uma nota — também é
-- função, para que a tela e o worker não tenham duas versões da mesma conta.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── Utilidades ─────────────────────────────────────────────────────────────

create or replace function public.app__qualidade_exige_gestor()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.app_tem_modulo('comercial') and public.app_gestor_comercial()) then
    raise exception 'Só a gestão comercial faz isto.' using errcode = '42501';
  end if;
end $$;

/*
 * A NOTA, recalculada dos itens. É a mesma aritmética de `calcularNota` e `explicarNota`
 * no core (05C §4.3): Σ(peso × atendido) / Σ(peso) sobre os aplicáveis, fora os itens em
 * sombra; NULL quando não há o que somar — nunca zero. Roda quando um veredito muda um item.
 */
create or replace function public.app__qualidade_recalcular(p_analise uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_peso numeric; v_peso_ok numeric; v_n int; v_ok int; v_score numeric;
  v_sombra numeric; v_faltas text[]; v_expl text;
begin
  select coalesce(sum(greatest(ai.peso, 0)), 0),
         coalesce(sum(case when ai.atendido then greatest(ai.peso, 0) else 0 end), 0),
         count(*), count(*) filter (where ai.atendido)
    into v_peso, v_peso_ok, v_n, v_ok
  from public.analise_itens ai
  where ai.analise_id = p_analise and ai.aplicavel and ai.atendido is not null and not ai.em_sombra;

  v_score := case when v_peso > 0 then round(v_peso_ok / v_peso, 3) end;

  select case when sum(greatest(ai.peso, 0)) > 0
              then round(sum(case when ai.atendido then greatest(ai.peso, 0) else 0 end) / sum(greatest(ai.peso, 0)), 3) end
    into v_sombra
  from public.analise_itens ai
  where ai.analise_id = p_analise and ai.aplicavel and ai.atendido is not null;

  select array_agg(ri.rotulo order by ri.ordem) into v_faltas
  from public.analise_itens ai join public.rubrica_itens ri on ri.id = ai.item_id
  where ai.analise_id = p_analise and ai.aplicavel and ai.atendido = false and not ai.em_sombra and ai.peso > 0;

  v_expl := case
    when v_score is null then 'Sem avaliação aplicável.'
    when coalesce(cardinality(v_faltas), 0) = 0
      then replace(to_char(v_score, 'FM0.00'), '.', ',') || ' — todos os ' || v_n || ' itens aplicáveis atendidos.'
    when cardinality(v_faltas) = 1
      then replace(to_char(v_score, 'FM0.00'), '.', ',') || ' porque faltou: ' || v_faltas[1] || '.'
    else replace(to_char(v_score, 'FM0.00'), '.', ',') || ' porque faltou: '
         || array_to_string(v_faltas[1:cardinality(v_faltas) - 1], ', ') || ' e ' || v_faltas[cardinality(v_faltas)] || '.'
  end;

  update public.analises set
    score = case when modo = 'publicado' then v_score end,
    score_sombra = v_sombra,
    itens_aplicaveis = v_n,
    itens_atendidos = v_ok,
    explicacao = v_expl
  where id = p_analise;
end $$;

-- ─── §13 Settings ───────────────────────────────────────────────────────────

create or replace function public.app_qualidade_salvar_config(p jsonb)
returns public.qualidade_config language plpgsql security definer set search_path = '' as $$
declare
  v_chave text := p ->> 'chave';
  v_valor jsonb := p -> 'valor';
  v_linha public.qualidade_config;
begin
  perform public.app__qualidade_exige_gestor();
  if v_chave not in ('captura', 'classificacao', 'calibracao', 'janela', 'retencao', 'vinculacao', 'precos') then
    raise exception 'Chave de configuração desconhecida: %.', v_chave using errcode = '22023';
  end if;
  if v_valor is null or jsonb_typeof(v_valor) <> 'object' then
    raise exception 'Valor inválido.' using errcode = '22023';
  end if;
  /* Ligar a captura sem as credenciais do Fireflies poria o notetaker em reunião de
     cliente sem ninguém para receber o transcript. */
  if v_chave = 'captura' and coalesce((v_valor ->> 'ligada')::boolean, false)
     and (select count(*) from public.qualidade_segredos
           where chave in ('fireflies_api_key', 'fireflies_webhook_secret')) < 2 then
    raise exception 'Cadastre a chave da API e o segredo do webhook do Fireflies antes de ligar a captura.'
      using errcode = '22023';
  end if;

  insert into public.qualidade_config as c (chave, valor, atualizado_por, atualizado_em)
  values (v_chave, v_valor, auth.uid(), now())
  on conflict (chave) do update set valor = c.valor || excluded.valor,
    atualizado_por = excluded.atualizado_por, atualizado_em = now()
  returning * into v_linha;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (auth.uid(), 'qualidade.config_salva', 'qualidade_config', v_chave, v_valor);
  return v_linha;
end $$;

/* O segredo vai para o Vault; a resposta nunca o devolve. Valor vazio apaga. */
create or replace function public.app_qualidade_salvar_segredo(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_chave text := p ->> 'chave';
  v_valor text := nullif(btrim(coalesce(p ->> 'valor', '')), '');
  v_atual public.qualidade_segredos;
  v_id uuid;
begin
  perform public.app__qualidade_exige_gestor();
  if v_chave not in ('fireflies_api_key', 'fireflies_webhook_secret', 'jev_api_key') then
    raise exception 'Segredo desconhecido.' using errcode = '22023';
  end if;
  select * into v_atual from public.qualidade_segredos where chave = v_chave;

  if v_valor is null then
    if v_atual.chave is not null then
      delete from vault.secrets where id = v_atual.secret_id;
      delete from public.qualidade_segredos where chave = v_chave;
    end if;
  elsif v_atual.chave is not null then
    perform vault.update_secret(v_atual.secret_id, v_valor);
    update public.qualidade_segredos set definido_por = auth.uid(), definido_em = now() where chave = v_chave;
  else
    v_id := vault.create_secret(v_valor, 'qualidade_' || v_chave || '_' || extract(epoch from now())::bigint::text,
                                'Inteligência de Conversas (05C): ' || v_chave);
    insert into public.qualidade_segredos (chave, secret_id, definido_por) values (v_chave, v_id, auth.uid());
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (auth.uid(), case when v_valor is null then 'qualidade.segredo_removido' else 'qualidade.segredo_definido' end,
          'qualidade_segredos', v_chave, '{}'::jsonb);
  return jsonb_build_object('chave', v_chave, 'definido', v_valor is not null);
end $$;

create or replace function public.app_qualidade_segredos()
returns table (chave text, definido_em timestamptz, definido_por text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.app__qualidade_exige_gestor();
  return query
    select s.chave, s.definido_em, u.nome
    from public.qualidade_segredos s left join public.usuarios u on u.id = s.definido_por;
end $$;

/* Só o service role lê o valor. */
create or replace function public.app__qualidade_segredo(p_chave text)
returns text language sql stable security definer set search_path = '' as $$
  select d.decrypted_secret
  from public.qualidade_segredos s join vault.decrypted_secrets d on d.id = s.secret_id
  where s.chave = p_chave
$$;

create or replace function public.app_qualidade_pessoas()
returns table (vendedor_id uuid, nome text, tipo text, is_ia boolean, captura_ativa boolean, analise_ativa boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.app__qualidade_exige_gestor();
  return query
    select v.id, v.nome, v.tipo, v.is_ia, coalesce(p.captura_ativa, true), coalesce(p.analise_ativa, true)
    from public.vendedores v left join public.qualidade_pessoas p on p.vendedor_id = v.id
    where v.ativo
    order by v.is_ia, v.nome;
end $$;

create or replace function public.app_qualidade_salvar_pessoa(p jsonb)
returns public.qualidade_pessoas language plpgsql security definer set search_path = '' as $$
declare
  v_linha public.qualidade_pessoas;
begin
  perform public.app__qualidade_exige_gestor();
  insert into public.qualidade_pessoas as q (vendedor_id, captura_ativa, analise_ativa, atualizado_por, atualizado_em)
  values ((p ->> 'vendedor_id')::uuid,
          coalesce((p ->> 'captura_ativa')::boolean, true),
          coalesce((p ->> 'analise_ativa')::boolean, true),
          auth.uid(), now())
  on conflict (vendedor_id) do update set
    captura_ativa = case when p ? 'captura_ativa' then excluded.captura_ativa else q.captura_ativa end,
    analise_ativa = case when p ? 'analise_ativa' then excluded.analise_ativa else q.analise_ativa end,
    atualizado_por = excluded.atualizado_por, atualizado_em = now()
  returning * into v_linha;

  /* Desligar a captura de alguém tira o notetaker das reuniões futuras dela agora —
     não só das que ainda vão ser marcadas. */
  if not v_linha.captura_ativa then
    with alvo as (
      update public.reunioes r set captura_status = 'dispensada', dispensada_motivo = 'pessoa_sem_captura',
             dispensada_por = auth.uid(), atualizada_em = now()
      from public.vendedor_eventos ve
      where ve.id = r.evento_id and r.vendedor_id = v_linha.vendedor_id
        and r.captura_status = 'agendada' and ve.inicio_em > now()
      returning r.evento_id
    )
    update public.vendedor_eventos ve set google_pendente_em = now(), atualizado_em = now()
    from alvo where ve.id = alvo.evento_id;
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (auth.uid(), 'qualidade.pessoa_salva', 'qualidade_pessoas', v_linha.vendedor_id::text, p);
  return v_linha;
end $$;

-- ─── §1 A captura na aba Reunião ────────────────────────────────────────────

create or replace function public.app__reuniao_visivel(p_ev public.vendedor_eventos)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.app_tem_modulo('comercial') and (
    public.app_gestor_comercial()
    or public.app_pode_ver_vendedor(p_ev.vendedor_id)
    or exists (select 1 from unnest(p_ev.acompanhantes) a where public.app_pode_ver_vendedor(a))
  )
$$;

create or replace function public.app_reuniao_captura(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_ev public.vendedor_eventos;
  v_r public.reunioes;
  v_analise jsonb;
begin
  select * into v_ev from public.vendedor_eventos where id = (p ->> 'evento_id')::uuid;
  if v_ev.id is null or not public.app__reuniao_visivel(v_ev) then
    return null;
  end if;
  select * into v_r from public.reunioes where evento_id = v_ev.id;

  select jsonb_build_object('id', a.id, 'score', a.score, 'modo', a.modo, 'score_sombra',
           case when public.app_gestor_comercial() then a.score_sombra end,
           'itens_aplicaveis', a.itens_aplicaveis, 'itens_atendidos', a.itens_atendidos, 'explicacao', a.explicacao)
    into v_analise
  from public.analises a
  where a.reuniao_id = v_r.id
    and public.app__qualidade_ve_analise(a.vendedor_id)
    and (a.modo = 'publicado' or public.app_gestor_comercial())
  order by a.analisada_em desc limit 1;

  return jsonb_build_object(
    'captura_ligada', public.app__qualidade_captura_ligada(),
    'evento', jsonb_build_object('id', v_ev.id, 'inicio_em', v_ev.inicio_em, 'duracao_min', v_ev.duracao_min,
                                 'meet_url', v_ev.meet_url, 'modalidade', v_ev.modalidade,
                                 'cancelado', v_ev.cancelado_em is not null),
    'reuniao', case when v_r.id is null then null else jsonb_build_object(
      'id', v_r.id,
      'captura_status', v_r.captura_status,
      'dispensada_motivo', v_r.dispensada_motivo,
      'bot_entrou_em', v_r.bot_entrou_em,
      'alerta_sem_bot_em', v_r.alerta_sem_bot_em,
      'transcricao_recebida_em', v_r.transcricao_recebida_em,
      'transcricao_expurgada_em', v_r.transcricao_expurgada_em,
      'transcricao', v_r.transcricao,
      'segmentos', v_r.transcricao_segmentos,
      'resumo', v_r.resumo,
      'resumo_origem', v_r.resumo_origem,
      'proximos_passos', v_r.proximos_passos,
      'participantes', v_r.participantes_detectados,
      'duracao_s', v_r.duracao_s,
      'url_fireflies', v_r.url_fireflies) end,
    'resgate', jsonb_build_object(
      'enviados', coalesce((select jsonb_agg(f.enviado_em order by f.enviado_em) from public.fireflies_resgates f
                             where f.status = 'enviado' and f.enviado_em > now() - interval '20 minutes'), '[]'::jsonb),
      'na_fila', exists (select 1 from public.fireflies_resgates f where f.reuniao_id = v_r.id and f.status = 'na_fila'),
      'ultimo', (select jsonb_build_object('status', f.status, 'pedido_em', f.pedido_em, 'erro', f.erro)
                   from public.fireflies_resgates f where f.reuniao_id = v_r.id order by f.pedido_em desc limit 1)),
    'analise', v_analise
  );
end $$;

/* "Não gravar esta reunião": reunião interna, ou cliente que não autorizou. */
create or replace function public.app_reuniao_dispensar_captura(p jsonb)
returns public.reunioes language plpgsql security definer set search_path = '' as $$
declare
  v_ev public.vendedor_eventos;
  v_r public.reunioes;
  v_dispensar boolean := coalesce((p ->> 'dispensar')::boolean, true);
begin
  select * into v_ev from public.vendedor_eventos where id = (p ->> 'evento_id')::uuid;
  if v_ev.id is null or not public.app__reuniao_visivel(v_ev) then
    raise exception 'Reunião não encontrada.' using errcode = 'no_data_found';
  end if;
  select * into v_r from public.reunioes where evento_id = v_ev.id for update;
  if v_r.id is null then
    raise exception 'Esta reunião não tem captura.' using errcode = '22023';
  end if;
  if v_r.captura_status in ('bot_entrou', 'transcrita') then
    raise exception 'A reunião já foi gravada.' using errcode = '22023';
  end if;
  if not v_dispensar and v_ev.modalidade in ('presencial', 'telefone') then
    raise exception 'Reunião sem link de conferência não tem onde o gravador entrar.' using errcode = '22023';
  end if;

  update public.reunioes set
    captura_status = case when v_dispensar then 'dispensada' else 'agendada' end,
    dispensada_motivo = case when v_dispensar then coalesce(nullif(p ->> 'motivo', ''), 'nao_gravar') end,
    dispensada_por = case when v_dispensar then auth.uid() end,
    alerta_sem_bot_em = null,
    atualizada_em = now()
  where id = v_r.id returning * into v_r;

  -- O convite muda (sai ou volta o notetaker): o Google precisa saber.
  if v_ev.inicio_em > now() and v_ev.cancelado_em is null then
    update public.vendedor_eventos set google_pendente_em = now(), atualizado_em = now() where id = v_ev.id;
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (auth.uid(), case when v_dispensar then 'qualidade.captura_dispensada' else 'qualidade.captura_reativada' end,
          'reunioes', v_r.id::text, p);
  return v_r;
end $$;

/*
 * "Chamar o bot agora" — entra na fila; o worker envia respeitando o limite de 3 a cada 20
 * minutos da conta. A fila é por reunião: apertar duas vezes não gasta duas vagas.
 */
create or replace function public.app_reuniao_chamar_bot(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ev public.vendedor_eventos;
  v_r public.reunioes;
  v_id uuid;
begin
  select * into v_ev from public.vendedor_eventos where id = (p ->> 'evento_id')::uuid;
  if v_ev.id is null or not public.app__reuniao_visivel(v_ev) then
    raise exception 'Reunião não encontrada.' using errcode = 'no_data_found';
  end if;
  select * into v_r from public.reunioes where evento_id = v_ev.id;
  if v_r.id is null or not public.app__qualidade_captura_ligada() then
    raise exception 'A captura não está ligada para esta reunião.' using errcode = '22023';
  end if;
  if v_r.captura_status in ('transcrita', 'dispensada') then
    raise exception 'Esta reunião não está esperando o gravador.' using errcode = '22023';
  end if;
  if v_ev.meet_url is null then
    raise exception 'A reunião não tem link de conferência.' using errcode = '22023';
  end if;
  if now() < v_ev.inicio_em - interval '10 minutes'
     or now() > v_ev.inicio_em + make_interval(mins => v_ev.duracao_min) then
    raise exception 'O gravador só pode ser chamado com a reunião acontecendo.' using errcode = '22023';
  end if;

  insert into public.fireflies_resgates (reuniao_id, pedido_por)
  values (v_r.id, auth.uid())
  on conflict (reuniao_id) where status = 'na_fila' do nothing
  returning id into v_id;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (auth.uid(), 'qualidade.bot_chamado', 'reunioes', v_r.id::text, p);

  return jsonb_build_object(
    'resgate_id', v_id,
    'ja_na_fila', v_id is null,
    'enviados', coalesce((select jsonb_agg(f.enviado_em order by f.enviado_em) from public.fireflies_resgates f
                           where f.status = 'enviado' and f.enviado_em > now() - interval '20 minutes'), '[]'::jsonb));
end $$;

-- ─── §6 O detalhe de uma análise ────────────────────────────────────────────

create or replace function public.app_qualidade_analise(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_a public.analises;
  v_gestor boolean := public.app_gestor_comercial();
  v_texto boolean := coalesce((p ->> 'incluir_texto')::boolean, false);
  v_tipo text;
  v_interacao jsonb;
begin
  if not public.app_tem_modulo('comercial') then
    return null;
  end if;
  select * into v_a from public.analises where id = (p ->> 'analise_id')::uuid;
  if v_a.id is null or not public.app__qualidade_ve_analise(v_a.vendedor_id)
     or (v_a.modo <> 'publicado' and not v_gestor) then
    return null;
  end if;
  select r.tipo_interacao into v_tipo from public.rubricas r where r.id = v_a.rubrica_id;

  if v_a.escopo = 'reuniao' then
    select jsonb_build_object(
             'evento_id', ve.id, 'titulo', ve.titulo, 'inicio_em', ve.inicio_em, 'venda_id', ve.venda_id,
             'sdr_lead_id', ve.sdr_lead_id, 'url_fireflies', r.url_fireflies, 'resumo', r.resumo,
             'duracao_s', r.duracao_s, 'proximos_passos', r.proximos_passos,
             'participantes', r.participantes_detectados,
             'texto', case when v_texto then r.transcricao end)
      into v_interacao
    from public.reunioes r join public.vendedor_eventos ve on ve.id = r.evento_id
    where r.id = v_a.reuniao_id;
  elsif v_a.escopo = 'ligacao' then
    select jsonb_build_object(
             'telefone', l.telefone, 'iniciada_em', coalesce(l.iniciada_em, l.enviada_em), 'duracao_s', l.duracao_s,
             'resumo', l.resumo, 'outcome', l.outcome, 'gravacao', l.links ->> 'gravacao',
             'turnos', case when v_texto then l.transcricao end)
      into v_interacao
    from public.voz_ligacoes l where l.id = v_a.voz_ligacao_id;
  else
    select jsonb_build_object(
             'conversa_id', c.id, 'canal', c.canal, 'identificador', c.identificador_externo,
             'inicio', v_a.janela_inicio, 'fim', v_a.janela_fim, 'mensagens_qtd', v_a.janela_mensagens,
             'mensagens', case when v_texto then (
               select coalesce(jsonb_agg(jsonb_build_object(
                        'id', m.id, 'direcao', m.direcao, 'corpo', m.corpo, 'assunto', m.assunto,
                        'criado_em', m.criado_em, 'por_ia', m.por_ia) order by m.criado_em), '[]'::jsonb)
               from public.comunicacoes m
               where m.conversa_id = c.id and m.canal in ('whatsapp', 'email')
                 and m.criado_em > coalesce(v_a.janela_inicio, '-infinity'::timestamptz)
                 and m.criado_em <= v_a.janela_fim) end)
      into v_interacao
    from public.conversas c where c.id = v_a.conversa_id;
  end if;

  return jsonb_build_object(
    'analise', jsonb_build_object(
      'id', v_a.id, 'escopo', v_a.escopo, 'modo', v_a.modo, 'score', v_a.score,
      'score_sombra', case when v_gestor then v_a.score_sombra end,
      'itens_aplicaveis', v_a.itens_aplicaveis, 'itens_atendidos', v_a.itens_atendidos,
      'explicacao', v_a.explicacao, 'analisada_em', v_a.analisada_em, 'publicada_em', v_a.publicada_em,
      'provedor', v_a.provedor, 'caiu_para_claude', v_a.caiu_para_claude,
      'custo_centavos', case when v_gestor then v_a.custo_centavos end,
      'rubrica_id', v_a.rubrica_id, 'rubrica_versao', v_a.rubrica_versao, 'tipo_interacao', v_tipo,
      'rubrica_ativa', (select r.ativa from public.rubricas r where r.id = v_a.rubrica_id)),
    'empresa', (select jsonb_build_object('id', e.id, 'nome', coalesce(nullif(e.nome_fantasia, ''), e.razao_social))
                  from public.empresas e where e.id = v_a.empresa_id),
    'contato', (select jsonb_build_object('id', ct.id, 'nome', ct.nome, 'cargo', ct.cargo)
                  from public.contatos ct where ct.id = v_a.contato_id),
    'vendedor', (select jsonb_build_object('id', v.id, 'nome', v.nome, 'is_ia', v.is_ia)
                   from public.vendedores v where v.id = v_a.vendedor_id),
    'pode_contestar', v_a.modo = 'publicado' and v_a.vendedor_id = public.app_vendedor_atual(),
    'interacao', v_interacao,
    'itens', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', ai.id, 'item_id', ai.item_id, 'chave', ai.chave, 'etapa', ri.etapa, 'ordem', ri.ordem,
               'rotulo', ri.rotulo, 'pergunta', ri.pergunta, 'orientacao_rubrica', ri.orientacao,
               'tipo_resposta', ri.tipo_resposta, 'peso', ai.peso, 'aplicavel', ai.aplicavel,
               'resultado', ai.resultado, 'prob_atendido', ai.prob_atendido, 'atendido', ai.atendido,
               'em_sombra', ai.em_sombra, 'banda_cinzenta', ai.banda_cinzenta, 'divergente', ai.divergente,
               'revisao_pendente', ai.revisao_pendente, 'citacao', ai.citacao, 'orientacao', ai.orientacao,
               'provedor', ai.provedor, 'contestado', ai.contestado, 'corrigido_em', ai.corrigido_em,
               'contestacao', (select jsonb_build_object('id', c.id, 'justificativa', c.justificativa,
                                 'veredito', c.veredito, 'resposta_gestor', c.resposta_gestor,
                                 'criada_em', c.criada_em, 'revisada_em', c.revisada_em)
                                 from public.analise_contestacoes c where c.analise_item_id = ai.id
                                 order by c.criada_em desc limit 1),
               'rotulo_humano', case when v_gestor then (
                 select jsonb_build_object('aplicavel', cr.aplicavel, 'atendido', cr.atendido, 'resultado', cr.resultado,
                                           'origem', cr.origem)
                 from public.calibracao_rotulos cr where cr.analise_id = v_a.id and cr.chave = ai.chave) end
             ) order by ri.ordem), '[]'::jsonb)
      from public.analise_itens ai join public.rubrica_itens ri on ri.id = ai.item_id
      where ai.analise_id = v_a.id
        -- o vendedor não vê item em sombra: ele não conta, e mostrá-lo seria cobrar pelo que não foi calibrado
        and (v_gestor or not ai.em_sombra))
  );
end $$;

/* O selo no card da empresa e no histórico da conversa: sempre clicável, nunca um número solto. */
create or replace function public.app_qualidade_selo(p jsonb)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('analise_id', a.id, 'score', a.score, 'escopo', a.escopo, 'analisada_em', a.analisada_em,
                            'itens_aplicaveis', a.itens_aplicaveis, 'itens_atendidos', a.itens_atendidos,
                            'explicacao', a.explicacao)
  from public.analises a
  where public.app_tem_modulo('comercial')
    and a.modo = 'publicado'
    and public.app__qualidade_ve_analise(a.vendedor_id)
    and ((p ? 'empresa_id' and a.empresa_id = (p ->> 'empresa_id')::uuid)
         or (p ? 'conversa_id' and a.conversa_id = (p ->> 'conversa_id')::uuid)
         or (p ? 'evento_id' and a.reuniao_id = (select r.id from public.reunioes r where r.evento_id = (p ->> 'evento_id')::uuid)))
  order by a.analisada_em desc
  limit 1
$$;

-- ─── §7 A aba Feedback ──────────────────────────────────────────────────────

create or replace function public.app_qualidade_feedback(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_vend uuid := coalesce(nullif(p ->> 'vendedor_id', '')::uuid, public.app_vendedor_atual());
  v_dias int := coalesce((p ->> 'dias')::int, 30);
  v_limite int := least(coalesce((p ->> 'limite')::int, 20), 100);
begin
  if v_vend is null or not public.app_tem_modulo('comercial') or not public.app__qualidade_ve_analise(v_vend) then
    return null;
  end if;

  return jsonb_build_object(
    'vendedor', (select jsonb_build_object('id', v.id, 'nome', v.nome, 'is_ia', v.is_ia, 'tipo', v.tipo)
                   from public.vendedores v where v.id = v_vend),
    'resumo', (
      select jsonb_build_object('analises', count(*), 'nota_media', round(avg(a.score), 3),
                                'sem_avaliacao', count(*) filter (where a.score is null))
      from public.analises a
      where a.vendedor_id = v_vend and a.modo = 'publicado' and a.analisada_em > now() - make_interval(days => v_dias)),
    /* Quantas análises desta pessoa ainda estão em sombra: a tela diz que existem, sem nota. */
    'em_sombra', (select count(*) from public.analises a
                   where a.vendedor_id = v_vend and a.modo = 'sombra' and a.analisada_em > now() - make_interval(days => v_dias)),
    'ultimas', (
      select coalesce(jsonb_agg(x order by x.analisada_em desc), '[]'::jsonb) from (
        select a.id, a.escopo, a.score, a.explicacao, a.itens_aplicaveis, a.itens_atendidos, a.analisada_em,
               a.rubrica_versao, r.tipo_interacao,
               coalesce(nullif(e.nome_fantasia, ''), e.razao_social) as empresa_nome, a.empresa_id,
               (select coalesce(jsonb_agg(jsonb_build_object(
                         'id', ai.id, 'chave', ai.chave, 'rotulo', ri.rotulo, 'etapa', ri.etapa,
                         'pergunta', ri.pergunta, 'citacao', ai.citacao,
                         'orientacao', coalesce(ai.orientacao, ri.orientacao), 'contestado', ai.contestado,
                         'veredito', (select c.veredito from public.analise_contestacoes c
                                       where c.analise_item_id = ai.id order by c.criada_em desc limit 1))
                       order by ri.ordem), '[]'::jsonb)
                  from public.analise_itens ai join public.rubrica_itens ri on ri.id = ai.item_id
                 where ai.analise_id = a.id and ai.aplicavel and ai.atendido = false and not ai.em_sombra) as faltas
        from public.analises a
        join public.rubricas r on r.id = a.rubrica_id
        left join public.empresas e on e.id = a.empresa_id
        where a.vendedor_id = v_vend and a.modo = 'publicado'
        order by a.analisada_em desc
        limit v_limite
      ) x),
    /* Onde mais perde pontos: a pior taxa de atendimento nos últimos N dias, com a orientação da rubrica. */
    'piores_itens', (
      select coalesce(jsonb_agg(y order by y.taxa asc, y.aplicaveis desc), '[]'::jsonb) from (
        select ai.chave, max(ri.rotulo) as rotulo, max(ri.etapa) as etapa,
               (array_agg(ri.orientacao order by a.analisada_em desc))[1] as orientacao,
               count(*) as aplicaveis, count(*) filter (where ai.atendido) as atendidos,
               round(count(*) filter (where ai.atendido)::numeric / count(*), 3) as taxa
        from public.analise_itens ai
        join public.analises a on a.id = ai.analise_id
        join public.rubrica_itens ri on ri.id = ai.item_id
        where a.vendedor_id = v_vend and a.modo = 'publicado'
          and a.analisada_em > now() - make_interval(days => v_dias)
          and ai.aplicavel and ai.atendido is not null and not ai.em_sombra and ai.peso > 0
        group by ai.chave
        having count(*) >= 2 and count(*) filter (where not ai.atendido) > 0
        order by 7 asc
        limit 5
      ) y),
    'pendencias', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', q.id, 'tipo', q.tipo, 'descricao', q.descricao, 'citacao', q.citacao, 'prazo_em', q.prazo_em,
               'criada_em', q.criada_em, 'empresa_id', q.empresa_id,
               'empresa_nome', coalesce(nullif(e.nome_fantasia, ''), e.razao_social),
               'conversa_id', q.conversa_id, 'analise_id', q.analise_id,
               'evento_id', (select r.evento_id from public.reunioes r where r.id = q.reuniao_id))
             order by q.prazo_em nulls last, q.criada_em), '[]'::jsonb)
      from public.qualidade_pendencias q left join public.empresas e on e.id = q.empresa_id
      where q.vendedor_id = v_vend and q.status = 'aberta'),
    /*
     * A evolução é por etapa e DENTRO DA MESMA VERSÃO de rubrica: comparar nota entre
     * versões é comparar réguas diferentes. Vem por versão, e a tela avisa a fronteira.
     */
    'evolucao', (
      select coalesce(jsonb_agg(z order by z.tipo_interacao, z.versao, z.semana, z.etapa), '[]'::jsonb) from (
        select r.tipo_interacao, a.rubrica_versao as versao,
               date_trunc('week', a.analisada_em at time zone 'America/Sao_Paulo')::date as semana,
               coalesce(ri.etapa, 'Geral') as etapa,
               round(sum(case when ai.atendido then ai.peso else 0 end) / nullif(sum(ai.peso), 0), 3) as taxa,
               count(distinct a.id) as analises
        from public.analises a
        join public.rubricas r on r.id = a.rubrica_id
        join public.analise_itens ai on ai.analise_id = a.id
        join public.rubrica_itens ri on ri.id = ai.item_id
        where a.vendedor_id = v_vend and a.modo = 'publicado'
          and a.analisada_em > now() - interval '180 days'
          and ai.aplicavel and ai.atendido is not null and not ai.em_sombra and ai.peso > 0
        group by 1, 2, 3, 4
      ) z)
  );
end $$;

-- ─── §9 Contestação ─────────────────────────────────────────────────────────

create or replace function public.app_qualidade_contestar(p jsonb)
returns public.analise_contestacoes language plpgsql security definer set search_path = '' as $$
declare
  v_item public.analise_itens;
  v_a public.analises;
  v_c public.analise_contestacoes;
  v_rotulo text;
begin
  select * into v_item from public.analise_itens where id = (p ->> 'analise_item_id')::uuid;
  select * into v_a from public.analises where id = v_item.analise_id;
  if v_a.id is null or v_a.vendedor_id is distinct from public.app_vendedor_atual() then
    raise exception 'Só quem foi avaliado contesta o item.' using errcode = '42501';
  end if;
  if v_a.modo <> 'publicado' or v_item.em_sombra then
    raise exception 'Este item não está publicado.' using errcode = '22023';
  end if;
  if exists (select 1 from public.analise_contestacoes where analise_item_id = v_item.id and veredito is null) then
    raise exception 'Este item já está em revisão.' using errcode = '23505';
  end if;

  insert into public.analise_contestacoes (analise_item_id, analise_id, contestado_por, justificativa)
  values (v_item.id, v_a.id, auth.uid(), nullif(btrim(coalesce(p ->> 'justificativa', '')), ''))
  returning * into v_c;
  update public.analise_itens set contestado = true where id = v_item.id;

  select ri.rotulo into v_rotulo from public.rubrica_itens ri where ri.id = v_item.item_id;
  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_a.empresa_id, 'analise.contestada',
    jsonb_build_object(
      'titulo', 'Item contestado',
      'resumo', coalesce((select v.nome from public.vendedores v where v.id = v_a.vendedor_id), 'Vendedor')
                || ' contestou "' || coalesce(v_rotulo, v_item.chave) || '".',
      'url', '/comercial/qualidade?aba=contestacoes',
      'analise_id', v_a.id, 'contestacao_id', v_c.id, 'item_chave', v_item.chave, 'vendedor_id', v_a.vendedor_id,
      'chave', 'contestacao:' || v_c.id),
    auth.uid());
  return v_c;
end $$;

create or replace function public.app_qualidade_contestacoes(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_abertas boolean := coalesce((p ->> 'abertas')::boolean, true);
begin
  perform public.app__qualidade_exige_gestor();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', c.id, 'analise_id', c.analise_id, 'analise_item_id', c.analise_item_id,
             'justificativa', c.justificativa, 'criada_em', c.criada_em, 'veredito', c.veredito,
             'resposta_gestor', c.resposta_gestor, 'rotulo_humano', c.rotulo_humano, 'revisada_em', c.revisada_em,
             'contestado_por', u.nome, 'vendedor', v.nome, 'escopo', a.escopo,
             'empresa_nome', coalesce(nullif(e.nome_fantasia, ''), e.razao_social),
             'chave', ai.chave, 'rotulo', ri.rotulo, 'pergunta', ri.pergunta, 'etapa', ri.etapa,
             'atendido', ai.atendido, 'aplicavel', ai.aplicavel, 'citacao', ai.citacao, 'orientacao', ai.orientacao,
             'prob_atendido', ai.prob_atendido, 'provedor', ai.provedor)
           order by c.criada_em), '[]'::jsonb)
    from public.analise_contestacoes c
    join public.analise_itens ai on ai.id = c.analise_item_id
    join public.rubrica_itens ri on ri.id = ai.item_id
    join public.analises a on a.id = c.analise_id
    left join public.usuarios u on u.id = c.contestado_por
    left join public.vendedores v on v.id = a.vendedor_id
    left join public.empresas e on e.id = a.empresa_id
    where (v_abertas and c.veredito is null) or (not v_abertas and c.veredito is not null and c.revisada_em > now() - interval '60 days')
  );
end $$;

/*
 * Contestar não apaga a nota — abre uma revisão. Procedente corrige o item e recalcula a
 * nota; `rubrica_ajustar` marca o item para revisão de redação. E TODO rótulo humano entra
 * no conjunto de calibração: é isso que faz o loop girar sem ninguém montar dataset.
 */
create or replace function public.app_qualidade_decidir_contestacao(p jsonb)
returns public.analise_contestacoes language plpgsql security definer set search_path = '' as $$
declare
  v_c public.analise_contestacoes;
  v_item public.analise_itens;
  v_a public.analises;
  v_veredito text := p ->> 'veredito';
  v_rotulo text := nullif(p ->> 'rotulo_humano', '');
  v_tipo text;
  v_rubrica public.rubricas;
  v_n int;
  v_limite int;
begin
  perform public.app__qualidade_exige_gestor();
  select * into v_c from public.analise_contestacoes where id = (p ->> 'id')::uuid for update;
  if v_c.id is null then
    raise exception 'Contestação não encontrada.' using errcode = 'no_data_found';
  end if;
  if v_c.veredito is not null then
    raise exception 'Esta contestação já foi decidida.' using errcode = '23505';
  end if;
  if v_veredito not in ('procedente', 'improcedente', 'rubrica_ajustar') then
    raise exception 'Veredito inválido.' using errcode = '22023';
  end if;
  if v_rotulo is not null and v_rotulo not in ('atendido', 'nao_atendido', 'nao_aplicavel') then
    raise exception 'Rótulo inválido.' using errcode = '22023';
  end if;
  if v_veredito = 'procedente' and v_rotulo is null then
    raise exception 'Procedente exige dizer qual era a resposta certa.' using errcode = '22023';
  end if;

  select * into v_item from public.analise_itens where id = v_c.analise_item_id for update;
  select * into v_a from public.analises where id = v_c.analise_id;
  select * into v_rubrica from public.rubricas where id = v_a.rubrica_id;
  v_tipo := v_rubrica.tipo_interacao;

  update public.analise_contestacoes set
    veredito = v_veredito,
    resposta_gestor = nullif(btrim(coalesce(p ->> 'resposta', '')), ''),
    rotulo_humano = v_rotulo,
    revisada_por = auth.uid(),
    revisada_em = now()
  where id = v_c.id returning * into v_c;

  if v_veredito = 'procedente' then
    update public.analise_itens set
      aplicavel = v_rotulo <> 'nao_aplicavel',
      atendido = case when v_rotulo = 'nao_aplicavel' then null else v_rotulo = 'atendido' end,
      corrigido_em = now()
    where id = v_item.id;
    perform public.app__qualidade_recalcular(v_a.id);
    -- A pendência nascida de uma falta que não era falta deixa de ser trabalho de alguém.
    if v_rotulo <> 'nao_atendido' then
      update public.qualidade_pendencias set status = 'descartada', resolvida_em = now(), resolvida_por = auth.uid()
      where analise_item_id = v_item.id and status = 'aberta';
    end if;
  elsif v_veredito = 'rubrica_ajustar' then
    update public.rubrica_itens set precisa_revisao = true where id = v_item.item_id;
  end if;

  if v_rotulo is not null then
    insert into public.calibracao_rotulos (analise_id, tipo_interacao, chave, aplicavel, atendido, origem,
                                           contestacao_id, rotulado_por)
    values (v_a.id, v_tipo, v_item.chave, v_rotulo <> 'nao_aplicavel',
            case when v_rotulo = 'nao_aplicavel' then null else v_rotulo = 'atendido' end,
            'contestacao', v_c.id, auth.uid())
    on conflict (analise_id, chave) do update set
      aplicavel = excluded.aplicavel, atendido = excluded.atendido, origem = excluded.origem,
      contestacao_id = excluded.contestacao_id, rotulado_por = excluded.rotulado_por, rotulado_em = now();

    /* §5.4: N contestações rotuladas desde a última calibração pedem recalibração. */
    v_limite := coalesce((public.app__qualidade_cfg('calibracao') ->> 'n_contestacoes_para_recalibrar')::int, 15);
    select count(*) into v_n from public.analise_contestacoes c
      join public.analises a on a.id = c.analise_id
     where a.rubrica_id = v_rubrica.id and c.rotulo_humano is not null
       and c.revisada_em > coalesce(v_rubrica.calibrada_em, '-infinity'::timestamptz);
    if v_n >= v_limite and v_rubrica.recalibrar_pedido_em is null then
      update public.rubricas set recalibrar_pedido_em = now() where id = v_rubrica.id;
    end if;
  end if;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_a.empresa_id, 'analise.contestacao_resolvida',
    jsonb_build_object(
      'titulo', 'Contestação revisada',
      'resumo', 'Sua contestação de "' || coalesce((select ri.rotulo from public.rubrica_itens ri where ri.id = v_item.item_id), v_item.chave)
                || '" foi ' || case v_veredito when 'procedente' then 'aceita — a nota foi recalculada'
                                               when 'improcedente' then 'revisada e o item fica como estava'
                                               else 'aceita como defeito da pergunta' end || '.',
      'url', '/comercial/feedback?analise=' || v_a.id,
      'analise_id', v_a.id, 'contestacao_id', v_c.id, 'veredito', v_veredito, 'vendedor_id', v_a.vendedor_id),
    auth.uid());

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (auth.uid(), 'qualidade.contestacao_decidida', 'analise_contestacoes', v_c.id::text, p);
  return v_c;
end $$;

-- ─── §5 Calibração: rotulagem ───────────────────────────────────────────────

create or replace function public.app_qualidade_para_rotular(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_tipo text := p ->> 'tipo_interacao';
  v_limite int := least(coalesce((p ->> 'limite')::int, 30), 200);
begin
  perform public.app__qualidade_exige_gestor();
  return (
    select jsonb_build_object(
      'rotuladas', (select count(distinct cr.analise_id) from public.calibracao_rotulos cr where cr.tipo_interacao = v_tipo),
      'fila', coalesce(jsonb_agg(x order by x.rotulos_feitos, x.analisada_em desc), '[]'::jsonb))
    from (
      select a.id, a.escopo, a.modo, a.analisada_em, a.rubrica_versao,
             coalesce(nullif(e.nome_fantasia, ''), e.razao_social) as empresa_nome, v.nome as vendedor_nome,
             (select count(*) from public.calibracao_rotulos cr where cr.analise_id = a.id) as rotulos_feitos
      from public.analises a
      join public.rubricas r on r.id = a.rubrica_id
      left join public.empresas e on e.id = a.empresa_id
      left join public.vendedores v on v.id = a.vendedor_id
      where r.tipo_interacao = v_tipo
      order by (select count(*) from public.calibracao_rotulos cr where cr.analise_id = a.id), a.analisada_em desc
      limit v_limite
    ) x
  );
end $$;

/* Rótulo item a item, com a MESMA pergunta que vai ao classificador. */
create or replace function public.app_qualidade_rotular(p jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_a public.analises;
  v_tipo text;
  v_r jsonb;
  v_n int := 0;
begin
  perform public.app__qualidade_exige_gestor();
  select * into v_a from public.analises where id = (p ->> 'analise_id')::uuid;
  if v_a.id is null then
    raise exception 'Análise não encontrada.' using errcode = 'no_data_found';
  end if;
  select r.tipo_interacao into v_tipo from public.rubricas r where r.id = v_a.rubrica_id;

  for v_r in select * from jsonb_array_elements(coalesce(p -> 'rotulos', '[]'::jsonb)) loop
    if nullif(v_r ->> 'chave', '') is null or not (v_r ? 'aplicavel') then
      continue;
    end if;
    insert into public.calibracao_rotulos (analise_id, tipo_interacao, chave, aplicavel, atendido, resultado, origem, rotulado_por)
    values (v_a.id, v_tipo, v_r ->> 'chave', (v_r ->> 'aplicavel')::boolean,
            case when (v_r ->> 'aplicavel')::boolean then (v_r ->> 'atendido')::boolean end,
            nullif(v_r ->> 'resultado', ''), 'manual', auth.uid())
    on conflict (analise_id, chave) do update set
      aplicavel = excluded.aplicavel, atendido = excluded.atendido, resultado = excluded.resultado,
      origem = 'manual', contestacao_id = null, rotulado_por = excluded.rotulado_por, rotulado_em = now();
    v_n := v_n + 1;
  end loop;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (auth.uid(), 'qualidade.rotulos_salvos', 'analises', v_a.id::text, jsonb_build_object('n', v_n));
  return v_n;
end $$;

-- ─── §3.3 Rubricas: versão nova, ativação, override ─────────────────────────

/*
 * Editar rubrica ativa cria VERSÃO NOVA; a vigente não muda. A nova nasce inativa e não
 * calibrada: ativar é um segundo passo, consciente, porque ativar devolve a régua à
 * sombra até a recalibração — e reinicia a comparabilidade histórica da nota.
 */
create or replace function public.app_qualidade_salvar_rubrica(p jsonb)
returns public.rubricas language plpgsql security definer set search_path = '' as $$
declare
  v_tipo text := p ->> 'tipo_interacao';
  v_r public.rubricas;
  v_i jsonb;
  v_ordem int := 0;
  v_chaves text[] := '{}';
  v_tr text;
begin
  perform public.app__qualidade_exige_gestor();
  if v_tipo not in ('reuniao', 'ligacao', 'conversa_texto') then
    raise exception 'Tipo de interação inválido.' using errcode = '22023';
  end if;
  if jsonb_typeof(p -> 'itens') <> 'array' or jsonb_array_length(p -> 'itens') = 0 then
    raise exception 'A rubrica precisa de pelo menos um item.' using errcode = '22023';
  end if;

  insert into public.rubricas (tipo_interacao, nome, versao, descricao, criada_por)
  values (v_tipo, coalesce(nullif(btrim(p ->> 'nome'), ''), 'Rubrica'),
          coalesce((select max(versao) from public.rubricas where tipo_interacao = v_tipo), 0) + 1,
          nullif(btrim(coalesce(p ->> 'descricao', '')), ''), auth.uid())
  returning * into v_r;

  for v_i in select * from jsonb_array_elements(p -> 'itens') loop
    v_ordem := v_ordem + 1;
    v_tr := coalesce(v_i ->> 'tipo_resposta', 'sim_nao');
    if (v_i ->> 'chave') = any (v_chaves) then
      raise exception 'Chave repetida: %.', v_i ->> 'chave' using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(v_i ->> 'pergunta', '')), '') is null or nullif(btrim(coalesce(v_i ->> 'orientacao', '')), '') is null then
      raise exception 'Todo item precisa de pergunta e orientação (%).', v_i ->> 'chave' using errcode = '22023';
    end if;
    if v_tr = 'escolha' and jsonb_typeof(v_i -> 'opcoes') is distinct from 'array' then
      raise exception 'Item de escolha precisa das opções (%).', v_i ->> 'chave' using errcode = '22023';
    end if;
    v_chaves := v_chaves || (v_i ->> 'chave');
    insert into public.rubrica_itens (rubrica_id, ordem, chave, etapa, rotulo, pergunta, tipo_resposta, opcoes, atende, peso,
                                      condicao_aplicabilidade, orientacao, gera_pendencia, ativo)
    values (v_r.id, coalesce((v_i ->> 'ordem')::int, v_ordem), v_i ->> 'chave', nullif(v_i ->> 'etapa', ''),
            coalesce(nullif(btrim(coalesce(v_i ->> 'rotulo', '')), ''), replace(v_i ->> 'chave', '_', ' ')),
            btrim(v_i ->> 'pergunta'), v_tr,
            case when jsonb_typeof(v_i -> 'opcoes') = 'array' then v_i -> 'opcoes' end,
            case when jsonb_typeof(v_i -> 'atende') = 'array'
                 then array(select jsonb_array_elements_text(v_i -> 'atende')) end,
            coalesce((v_i ->> 'peso')::numeric, 1),
            nullif(btrim(coalesce(v_i ->> 'condicao_aplicabilidade', '')), ''),
            btrim(v_i ->> 'orientacao'), nullif(v_i ->> 'gera_pendencia', ''),
            coalesce((v_i ->> 'ativo')::boolean, true));
  end loop;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (null, 'rubrica.versionada',
    jsonb_build_object('titulo', 'Rubrica versionada',
                       'resumo', 'Nova versão ' || v_r.versao || ' da rubrica de ' || v_tipo || ' (inativa até ser ativada).',
                       'url', '/comercial/qualidade?aba=rubricas', 'rubrica_id', v_r.id),
    auth.uid());
  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (auth.uid(), 'qualidade.rubrica_versionada', 'rubricas', v_r.id::text, p);
  return v_r;
end $$;

create or replace function public.app_qualidade_ativar_rubrica(p jsonb)
returns public.rubricas language plpgsql security definer set search_path = '' as $$
declare
  v_r public.rubricas;
begin
  perform public.app__qualidade_exige_gestor();
  select * into v_r from public.rubricas where id = (p ->> 'rubrica_id')::uuid for update;
  if v_r.id is null then
    raise exception 'Rubrica não encontrada.' using errcode = 'no_data_found';
  end if;
  update public.rubricas set ativa = false where tipo_interacao = v_r.tipo_interacao and ativa and id <> v_r.id;
  update public.rubricas set ativa = true, ativada_em = now(),
    -- Versão nova pede calibração: os rótulos que já existem são reaproveitados pela chave.
    recalibrar_pedido_em = case when calibrada_em is null then now() else recalibrar_pedido_em end
  where id = v_r.id returning * into v_r;
  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (auth.uid(), 'qualidade.rubrica_ativada', 'rubricas', v_r.id::text, p);
  return v_r;
end $$;

create or replace function public.app_qualidade_pedir_recalibracao(p jsonb)
returns public.rubricas language plpgsql security definer set search_path = '' as $$
declare
  v_r public.rubricas;
begin
  perform public.app__qualidade_exige_gestor();
  update public.rubricas set recalibrar_pedido_em = now() where id = (p ->> 'rubrica_id')::uuid returning * into v_r;
  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (auth.uid(), 'qualidade.recalibracao_pedida', 'rubricas', v_r.id::text, p);
  return v_r;
end $$;

/* O limiar só é escrito pela calibração ou por override EXPLÍCITO, com quem e por quê (§5.3). */
create or replace function public.app_qualidade_override_limiar(p jsonb)
returns public.rubrica_itens language plpgsql security definer set search_path = '' as $$
declare
  v_i public.rubrica_itens;
  v_limiar numeric := (p ->> 'limiar')::numeric;
  v_motivo text := nullif(btrim(coalesce(p ->> 'motivo', '')), '');
begin
  perform public.app__qualidade_exige_gestor();
  if v_limiar is null or v_limiar <= 0 or v_limiar >= 1 then
    raise exception 'O limiar fica entre 0 e 1.' using errcode = '22023';
  end if;
  if v_motivo is null then
    raise exception 'O override exige o motivo.' using errcode = '22023';
  end if;
  update public.rubrica_itens set limiar = round(v_limiar, 3), limiar_origem = 'override',
    limiar_override_por = auth.uid(), limiar_override_motivo = v_motivo, limiar_override_em = now()
  where id = (p ->> 'item_id')::uuid returning * into v_i;
  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (auth.uid(), 'qualidade.limiar_override', 'rubrica_itens', v_i.id::text, p);
  return v_i;
end $$;

-- ─── §7 Pendências ──────────────────────────────────────────────────────────

create or replace function public.app_qualidade_resolver_pendencia(p jsonb)
returns public.qualidade_pendencias language plpgsql security definer set search_path = '' as $$
declare
  v_q public.qualidade_pendencias;
begin
  select * into v_q from public.qualidade_pendencias where id = (p ->> 'id')::uuid for update;
  if v_q.id is null or not (v_q.vendedor_id = any (public.app_meu_dia_alvos()) or public.app_gestor_comercial()) then
    raise exception 'Pendência não encontrada.' using errcode = 'no_data_found';
  end if;
  update public.qualidade_pendencias set
    status = case when coalesce((p ->> 'descartar')::boolean, false) then 'descartada' else 'resolvida' end,
    resolvida_em = now(), resolvida_por = auth.uid()
  where id = v_q.id returning * into v_q;
  return v_q;
end $$;

-- ─── §8 Comercial → Qualidade ───────────────────────────────────────────────

create or replace function public.app_qualidade_agregado(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_desde timestamptz := now() - make_interval(days => coalesce((p ->> 'dias')::int, 90));
begin
  perform public.app__qualidade_exige_gestor();
  return jsonb_build_object(
    'por_vendedor', (
      select coalesce(jsonb_agg(x order by x.is_ia, x.nota_media desc nulls last), '[]'::jsonb) from (
        select v.id as vendedor_id, v.nome, v.is_ia, v.tipo,
               count(*) filter (where a.modo = 'publicado') as analises,
               count(*) filter (where a.modo = 'sombra') as em_sombra,
               round(avg(a.score) filter (where a.modo = 'publicado'), 3) as nota_media,
               round(avg(a.score) filter (where a.modo = 'publicado' and a.escopo = 'reuniao'), 3) as nota_reuniao,
               round(avg(a.score) filter (where a.modo = 'publicado' and a.escopo = 'ligacao'), 3) as nota_ligacao,
               round(avg(a.score) filter (where a.modo = 'publicado' and a.escopo = 'janela_conversa'), 3) as nota_conversa,
               (select count(*) from public.qualidade_pendencias q where q.vendedor_id = v.id and q.status = 'aberta') as pendencias_abertas
        from public.analises a join public.vendedores v on v.id = a.vendedor_id
        where a.analisada_em >= v_desde
        group by v.id
      ) x),
    'por_etapa', (
      select coalesce(jsonb_agg(x order by x.tipo_interacao, x.etapa), '[]'::jsonb) from (
        select r.tipo_interacao, coalesce(ri.etapa, 'Geral') as etapa, v.is_ia,
               round(sum(case when ai.atendido then ai.peso else 0 end) / nullif(sum(ai.peso), 0), 3) as taxa,
               count(*) as itens
        from public.analise_itens ai
        join public.analises a on a.id = ai.analise_id
        join public.rubricas r on r.id = a.rubrica_id
        join public.rubrica_itens ri on ri.id = ai.item_id
        left join public.vendedores v on v.id = a.vendedor_id
        where a.analisada_em >= v_desde and a.modo = 'publicado'
          and ai.aplicavel and ai.atendido is not null and not ai.em_sombra and ai.peso > 0
        group by 1, 2, 3
      ) x),
    'objecoes', (
      select coalesce(jsonb_agg(x order by x.n desc), '[]'::jsonb) from (
        select ai.resultado as objecao, count(*) as n
        from public.analise_itens ai join public.analises a on a.id = ai.analise_id
        where a.analisada_em >= v_desde and ai.chave = 'objecao_registrada' and ai.aplicavel and ai.resultado is not null
        group by 1
      ) x),
    'concorrentes', (
      select coalesce(jsonb_agg(x order by x.analisada_em desc), '[]'::jsonb) from (
        select a.id as analise_id, a.analisada_em, a.empresa_id,
               coalesce(nullif(e.nome_fantasia, ''), e.razao_social) as empresa_nome, v.nome as vendedor
        from public.analise_itens ai
        join public.analises a on a.id = ai.analise_id
        left join public.empresas e on e.id = a.empresa_id
        left join public.vendedores v on v.id = a.vendedor_id
        where a.analisada_em >= v_desde and ai.chave = 'mencionou_concorrente' and ai.aplicavel
          and ai.resultado = 'sim' and coalesce(ai.prob_atendido, ai.probabilidade) >= 0.5
        limit 50
      ) x),
    'evolucao', (
      select coalesce(jsonb_agg(x order by x.semana, x.is_ia), '[]'::jsonb) from (
        select date_trunc('week', a.analisada_em at time zone 'America/Sao_Paulo')::date as semana,
               coalesce(v.is_ia, false) as is_ia, round(avg(a.score), 3) as nota_media, count(*) as analises
        from public.analises a left join public.vendedores v on v.id = a.vendedor_id
        where a.analisada_em >= v_desde and a.modo = 'publicado' and a.score is not null
        group by 1, 2
      ) x),
    /* A saúde do instrumento: item muito contestado é rubrica mal escrita, não vendedor ruim. */
    'contestacao_por_item', (
      select coalesce(jsonb_agg(x order by x.taxa desc nulls last, x.contestados desc), '[]'::jsonb) from (
        select ri.chave, max(ri.rotulo) as rotulo, r.tipo_interacao,
               count(*) as avaliados,
               count(*) filter (where ai.contestado) as contestados,
               round(count(*) filter (where ai.contestado)::numeric / nullif(count(*), 0), 3) as taxa,
               (select count(*) from public.analise_contestacoes c join public.analise_itens x on x.id = c.analise_item_id
                 where x.chave = ri.chave and c.veredito = 'procedente' and c.criada_em >= v_desde) as procedentes,
               bool_or(ri.precisa_revisao) as precisa_revisao
        from public.analise_itens ai
        join public.analises a on a.id = ai.analise_id
        join public.rubricas r on r.id = a.rubrica_id
        join public.rubrica_itens ri on ri.id = ai.item_id
        where a.analisada_em >= v_desde and a.modo = 'publicado' and not ai.em_sombra and ai.aplicavel
        group by ri.chave, r.tipo_interacao
      ) x),
    'custo', (
      select coalesce(jsonb_agg(x order by x.mes desc), '[]'::jsonb) from (
        select to_char(a.analisada_em at time zone 'America/Sao_Paulo', 'YYYY-MM') as mes,
               count(*) as analises,
               round(sum(a.custo_jev_centavos), 2) as jev_centavos,
               round(sum(a.custo_claude_centavos), 2) as claude_centavos,
               count(*) filter (where a.caiu_para_claude) as caiu_para_claude,
               (select count(*) from public.analise_itens ai join public.analises b on b.id = ai.analise_id
                 where to_char(b.analisada_em at time zone 'America/Sao_Paulo', 'YYYY-MM') = to_char(a.analisada_em at time zone 'America/Sao_Paulo', 'YYYY-MM')
                   and ai.provedor = 'claude') as itens_claude,
               (select count(*) from public.analise_itens ai join public.analises b on b.id = ai.analise_id
                 where to_char(b.analisada_em at time zone 'America/Sao_Paulo', 'YYYY-MM') = to_char(a.analisada_em at time zone 'America/Sao_Paulo', 'YYYY-MM')
                   and ai.provedor = 'jev') as itens_jev,
               (select count(*) from public.analise_itens ai join public.analises b on b.id = ai.analise_id
                 where to_char(b.analisada_em at time zone 'America/Sao_Paulo', 'YYYY-MM') = to_char(a.analisada_em at time zone 'America/Sao_Paulo', 'YYYY-MM')
                   and ai.banda_cinzenta) as itens_banda_cinzenta
        from public.analises a
        where a.analisada_em >= now() - interval '12 months'
        group by 1
      ) x),
    'fila', (select jsonb_object_agg(status, n) from (select status, count(*) n from public.analise_fila group by 1) f)
  );
end $$;

-- ─── §10 Vinculação ─────────────────────────────────────────────────────────

create or replace function public.app_qualidade_vinculacao(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_desde timestamptz := now() - make_interval(days => coalesce((p ->> 'dias')::int, 30));
begin
  perform public.app__qualidade_exige_gestor();
  return jsonb_build_object(
    'por_etapa', (
      select coalesce(jsonb_object_agg(x.etapa, x.n), '{}'::jsonb) from (
        select case when t.aplicada then t.etapa else 'humano' end as etapa, count(*) as n
        from (select distinct on (nao_vinculada_id) * from public.vinculacao_tentativas
               where criada_em >= v_desde order by nao_vinculada_id, criada_em desc) t
        group by 1) x),
    'nao_resolviveis', (select count(*) from (select distinct on (nao_vinculada_id) * from public.vinculacao_tentativas
                          where criada_em >= v_desde order by nao_vinculada_id, criada_em desc) t where t.nao_resolvivel),
    'custo_centavos', (select round(coalesce(sum(custo_centavos), 0), 2) from public.vinculacao_tentativas where criada_em >= v_desde),
    'auditoria', (
      select coalesce(jsonb_agg(x order by x.mes desc), '[]'::jsonb) from (
        select to_char(auditada_em at time zone 'America/Sao_Paulo', 'YYYY-MM') as mes,
               count(*) as auditadas, count(*) filter (where auditoria_correta) as corretas
        from public.vinculacao_tentativas where auditada_em is not null group by 1) x),
    /* A amostra do mês: vínculos automáticos ainda não auditados, sorteados. */
    'amostra', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select t.id, t.etapa, t.probabilidade, t.motivo, t.criada_em, n.canal, n.identificador_externo, n.nome_sugerido,
               coalesce(nullif(e.nome_fantasia, ''), e.razao_social) as empresa_nome, e.cnpj
        from public.vinculacao_tentativas t
        join public.conversas_nao_vinculadas n on n.id = t.nao_vinculada_id
        left join public.empresas e on e.id = t.empresa_id
        where t.aplicada and t.auditada_em is null
          and t.criada_em >= date_trunc('month', now()) - interval '1 month'
        order by md5(t.id::text || to_char(now(), 'YYYY-MM'))
        limit 10) x),
    'fila_humana', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select n.id, n.canal, n.identificador_externo, n.nome_sugerido, n.qtd_mensagens, n.ultima_mensagem_em,
               t.motivo, t.nao_resolvivel, t.candidatas
        from public.conversas_nao_vinculadas n
        join lateral (select * from public.vinculacao_tentativas t where t.nao_vinculada_id = n.id
                       order by t.criada_em desc limit 1) t on true
        where n.status = 'pendente' and not t.aplicada
        order by coalesce((t.candidatas -> 0 ->> 'valor')::numeric, 0) desc, n.qtd_mensagens desc
        limit 50) x)
  );
end $$;

create or replace function public.app_qualidade_auditar_vinculo(p jsonb)
returns public.vinculacao_tentativas language plpgsql security definer set search_path = '' as $$
declare
  v_t public.vinculacao_tentativas;
begin
  perform public.app__qualidade_exige_gestor();
  update public.vinculacao_tentativas set auditada_em = now(), auditada_por = auth.uid(),
    auditoria_correta = (p ->> 'correta')::boolean
  where id = (p ->> 'id')::uuid returning * into v_t;
  return v_t;
end $$;

/*
 * A vinculação automática usa o MESMO `app_conversa_vincular` da tela — contato criado,
 * threads irmãs, ledger, primeiro contato, tudo igual. A única mudança é deixar o service
 * role passar pelo portão do módulo (o worker não tem perfil). Remendo cirúrgico no corpo
 * vivo, para não reescrever 120 linhas da 0197 e arriscar divergir delas.
 */
do $$
declare
  d text;
  novo text;
begin
  d := pg_get_functiondef('public.app_conversa_vincular(jsonb)'::regprocedure);
  novo := replace(d,
    'if not public.app_tem_modulo(''comunicacao'') then',
    'if coalesce(auth.role(), '''') <> ''service_role'' and not public.app_tem_modulo(''comunicacao'') then');
  if novo = d then
    raise exception 'app_conversa_vincular mudou: o remendo do service role não encontrou o portão.';
  end if;
  execute novo;
end $$;
grant execute on function public.app_conversa_vincular(jsonb) to service_role;

-- ─── §11 Sugestões de cadastro ──────────────────────────────────────────────

create or replace function public.app_empresa_sugestoes(p jsonb)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'campo', s.campo, 'valor_atual', s.valor_atual, 'valor_sugerido', s.valor_sugerido,
           'contato_id', s.contato_id, 'contato_nome', ct.nome, 'analise_id', s.analise_id, 'criada_em', s.criada_em)
         order by s.criada_em desc), '[]'::jsonb)
  from public.empresa_sugestoes_cadastro s left join public.contatos ct on ct.id = s.contato_id
  where s.empresa_id = (p ->> 'empresa_id')::uuid and s.status = 'pendente'
    and public.app_tem_modulo('comercial')
    and exists (select 1 from public.empresas e where e.id = s.empresa_id)
$$;

create or replace function public.app_empresa_sugestao_decidir(p jsonb)
returns public.empresa_sugestoes_cadastro language plpgsql security definer set search_path = '' as $$
declare
  v_s public.empresa_sugestoes_cadastro;
  v_aceitar boolean := coalesce((p ->> 'aceitar')::boolean, false);
begin
  if not public.app_tem_modulo('comercial') then
    raise exception 'Sem acesso.' using errcode = '42501';
  end if;
  select * into v_s from public.empresa_sugestoes_cadastro where id = (p ->> 'id')::uuid and status = 'pendente' for update;
  if v_s.id is null then
    raise exception 'Sugestão não encontrada.' using errcode = 'no_data_found';
  end if;
  if v_aceitar and v_s.contato_id is not null then
    update public.contatos set
      nome = case when v_s.campo = 'nome' then v_s.valor_sugerido else nome end,
      cargo = case when v_s.campo = 'cargo' then v_s.valor_sugerido else cargo end,
      email = case when v_s.campo = 'email' then v_s.valor_sugerido else email end,
      telefone = case when v_s.campo = 'telefone' then v_s.valor_sugerido else telefone end
    where id = v_s.contato_id;
  end if;
  update public.empresa_sugestoes_cadastro set status = case when v_aceitar then 'aceita' else 'recusada' end,
    decidida_por = auth.uid(), decidida_em = now()
  where id = v_s.id returning * into v_s;
  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (auth.uid(), 'qualidade.sugestao_decidida', 'empresa_sugestoes_cadastro', v_s.id::text, p);
  return v_s;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- Service role (worker)
-- ═════════════════════════════════════════════════════════════════════════════

/*
 * Qual reunião é esta transcrição. Referência nossa → evento do Google (o `cal_id` vem
 * como `<id>@google.com` ou só `<id>`) → link da conferência, a mais próxima no tempo.
 */
create or replace function public.app__reuniao_por_fireflies(p jsonb)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from (
    select r.id, 1 as ordem, 0::float as dist from public.reunioes r
    where nullif(p ->> 'client_reference_id', '') is not null and r.fireflies_client_reference_id = p ->> 'client_reference_id'
    union all
    select r.id, 2, 0 from public.reunioes r
    where nullif(p ->> 'meeting_id', '') is not null and r.fireflies_meeting_id = p ->> 'meeting_id'
    union all
    select r.id, 3, 0 from public.reunioes r join public.vendedor_eventos ve on ve.id = r.evento_id
    where nullif(p ->> 'cal_id', '') is not null
      and ve.google_evento_id = split_part(p ->> 'cal_id', '@', 1)
    union all
    select r.id, 4, abs(extract(epoch from ve.inicio_em - coalesce(nullif(p ->> 'inicio', '')::timestamptz, now())))
    from public.reunioes r join public.vendedor_eventos ve on ve.id = r.evento_id
    where nullif(p ->> 'meeting_link', '') is not null and ve.meet_url is not null
      and lower(regexp_replace(regexp_replace(ve.meet_url, '^https?://', ''), '[?#].*$', '')) = p ->> 'meeting_link'
      and ve.inicio_em between coalesce(nullif(p ->> 'inicio', '')::timestamptz, now()) - interval '1 day'
                           and coalesce(nullif(p ->> 'inicio', '')::timestamptz, now()) + interval '1 day'
  ) x
  order by ordem, dist
  limit 1
$$;

/*
 * O vigia (§1.4), a cada 5 minutos: reunião que começou há mais de N minutos e o bot não
 * entrou vira ALERTA ao condutor — sem isso a falha só aparece quando alguém procura o
 * transcript. E reunião que acabou há horas sem transcrição vira `sem_captura`, que é a
 * verdade e não um "agendada" eterno.
 */
create or replace function public.app__qualidade_vigiar()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_min int := coalesce((public.app__qualidade_cfg('captura') ->> 'minutos_para_bot')::int, 5);
  v_alertas int := 0;
  v_sem int := 0;
  v_canceladas int := 0;
  v_r record;
begin
  update public.reunioes r set captura_status = 'dispensada', dispensada_motivo = 'cancelada', atualizada_em = now()
  from public.vendedor_eventos ve
  where ve.id = r.evento_id and ve.cancelado_em is not null and r.captura_status = 'agendada';
  get diagnostics v_canceladas = row_count;

  for v_r in
    update public.reunioes r set alerta_sem_bot_em = now(), atualizada_em = now()
    from public.vendedor_eventos ve
    where ve.id = r.evento_id and r.captura_status = 'agendada' and r.alerta_sem_bot_em is null
      and ve.cancelado_em is null
      and ve.inicio_em < now() - make_interval(mins => v_min)
      and ve.inicio_em > now() - interval '3 hours'
    returning r.id, r.evento_id, r.empresa_id, r.vendedor_id, ve.titulo, ve.venda_id, ve.sdr_lead_id, ve.inicio_em
  loop
    v_alertas := v_alertas + 1;
    insert into public.empresa_eventos (empresa_id, tipo, payload)
    values (v_r.empresa_id, 'reuniao.sem_captura',
      jsonb_build_object(
        'titulo', 'O gravador não entrou na reunião',
        'resumo', coalesce(v_r.titulo, 'Reunião') || ' começou às '
                  || to_char(v_r.inicio_em at time zone 'America/Sao_Paulo', 'HH24:MI')
                  || ' e o Fireflies não entrou. Chame o bot pela aba Reunião ou siga sem gravação.',
        'url', case when v_r.venda_id is not null then '/comercial/vendas/' || v_r.venda_id else '/comercial/sdr' end,
        'evento_id', v_r.evento_id, 'reuniao_id', v_r.id, 'vendedor_id', v_r.vendedor_id,
        'chave', 'sem_captura:' || v_r.id));
  end loop;

  update public.reunioes r set captura_status = 'sem_captura', atualizada_em = now()
  from public.vendedor_eventos ve
  where ve.id = r.evento_id and r.transcricao_recebida_em is null
    and ((r.captura_status = 'agendada' and ve.inicio_em + make_interval(mins => ve.duracao_min) < now() - interval '3 hours')
      or (r.captura_status = 'bot_entrou' and ve.inicio_em + make_interval(mins => ve.duracao_min) < now() - interval '12 hours'));
  get diagnostics v_sem = row_count;

  return jsonb_build_object('alertas', v_alertas, 'sem_captura', v_sem, 'canceladas', v_canceladas);
end $$;

/*
 * As conversas que talvez tenham janela a fechar, com os horários das mensagens desde a
 * última janela. Quem decide se a janela fecha é `fecharJanela` no core (testado); aqui só
 * o recorte barato. A primeira passada olha 30 dias para trás, não o histórico inteiro.
 */
create or replace function public.app__qualidade_janelas_candidatas(p_horas int, p_limite int)
returns table (conversa_id uuid, ultima_janela_fim timestamptz, mensagens timestamptz[])
language sql stable security definer set search_path = '' as $$
  select c.id, lj.fim,
         array(select m.criado_em from public.comunicacoes m
                where m.conversa_id = c.id and m.canal in ('whatsapp', 'email')
                  and coalesce(m.corpo, m.assunto, '') <> ''
                  and m.criado_em > coalesce(lj.fim, now() - interval '30 days')
                order by m.criado_em)
  from public.conversas c
  left join lateral (select max(f.janela_fim) as fim from public.analise_fila f
                      where f.conversa_id = c.id and f.escopo = 'janela_conversa') lj on true
  where c.ultima_mensagem_em < now() - make_interval(hours => p_horas)
    and c.ultima_mensagem_em > now() - interval '30 days'
    and (lj.fim is null or c.ultima_mensagem_em > lj.fim)
  order by c.ultima_mensagem_em desc
  limit p_limite
$$;

/*
 * Grava uma análise inteira numa transação: a análise, os itens, as pendências (só quando
 * publicada — pendência é cobrança, e nada cobra antes da calibração), os eventos e o
 * fechamento da fila. A nota vem do worker (core) e é recalculada aqui pela mesma regra,
 * para que a tela e o banco nunca discordem.
 */
create or replace function public.app__qualidade_gravar_analise(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_modo text := coalesce(p ->> 'modo', 'sombra');
  v_i jsonb;
  v_item_id uuid;
  v_ai uuid;
  v_pend jsonb;
  v_vendedor uuid := nullif(p ->> 'vendedor_id', '')::uuid;
  v_empresa uuid := nullif(p ->> 'empresa_id', '')::uuid;
  v_n_pend int := 0;
begin
  insert into public.analises (
    escopo, reuniao_id, voz_ligacao_id, conversa_id, janela_inicio, janela_fim, janela_mensagens,
    empresa_id, contato_id, vendedor_id, agente_id, rubrica_id, rubrica_versao, modo, publicada_em,
    provedor, custo_centavos, custo_jev_centavos, custo_claude_centavos, tokens_entrada, tokens_saida, caiu_para_claude
  ) values (
    p ->> 'escopo', nullif(p ->> 'reuniao_id', '')::uuid, nullif(p ->> 'voz_ligacao_id', '')::uuid,
    nullif(p ->> 'conversa_id', '')::uuid, nullif(p ->> 'janela_inicio', '')::timestamptz,
    nullif(p ->> 'janela_fim', '')::timestamptz, nullif(p ->> 'janela_mensagens', '')::int,
    v_empresa, nullif(p ->> 'contato_id', '')::uuid, v_vendedor, nullif(p ->> 'agente_id', '')::uuid,
    (p ->> 'rubrica_id')::uuid, (p ->> 'rubrica_versao')::int, v_modo, case when v_modo = 'publicado' then now() end,
    coalesce(p ->> 'provedor', 'jev'),
    coalesce((p ->> 'custo_jev_centavos')::numeric, 0) + coalesce((p ->> 'custo_claude_centavos')::numeric, 0),
    coalesce((p ->> 'custo_jev_centavos')::numeric, 0), coalesce((p ->> 'custo_claude_centavos')::numeric, 0),
    nullif(p ->> 'tokens_entrada', '')::int, nullif(p ->> 'tokens_saida', '')::int,
    coalesce((p ->> 'caiu_para_claude')::boolean, false)
  )
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    -- A interação já tinha análise: a fila fecha apontando para ela, sem duplicar nada.
    update public.analise_fila set status = 'concluida', processada_em = now(), erro = 'já analisada'
    where id = nullif(p ->> 'fila_id', '')::uuid;
    return null;
  end if;

  for v_i in select * from jsonb_array_elements(coalesce(p -> 'itens', '[]'::jsonb)) loop
    select ri.id into v_item_id from public.rubrica_itens ri
     where ri.rubrica_id = (p ->> 'rubrica_id')::uuid and ri.chave = v_i ->> 'chave';
    if v_item_id is null then
      continue;
    end if;
    insert into public.analise_itens (
      analise_id, item_id, chave, peso, aplicavel, aplicabilidade_prob, resultado, probabilidade, prob_atendido,
      limiar_usado, atendido, banda_cinzenta, em_sombra, divergente, atendido_original, revisao_pendente,
      citacao, orientacao, provedor
    ) values (
      v_id, v_item_id, v_i ->> 'chave', coalesce((v_i ->> 'peso')::numeric, 1), (v_i ->> 'aplicavel')::boolean,
      (v_i ->> 'aplicabilidade_prob')::numeric, v_i ->> 'resultado', (v_i ->> 'probabilidade')::numeric,
      (v_i ->> 'prob_atendido')::numeric, (v_i ->> 'limiar_usado')::numeric, (v_i ->> 'atendido')::boolean,
      coalesce((v_i ->> 'banda_cinzenta')::boolean, false), coalesce((v_i ->> 'em_sombra')::boolean, true),
      coalesce((v_i ->> 'divergente')::boolean, false), (v_i ->> 'atendido_original')::boolean,
      coalesce((v_i ->> 'revisao_pendente')::boolean, false),
      nullif(v_i ->> 'citacao', ''), nullif(v_i ->> 'orientacao', ''), nullif(v_i ->> 'provedor', '')
    ) returning id into v_ai;

    -- O que o classificador disse sobre este item vira amostra — se a interação já foi rotulada.
    insert into public.calibracao_amostras (item_id, analise_id, prob_aplicavel, prob_atendido, provedor)
    select v_item_id, v_id, (v_i ->> 'aplicabilidade_prob')::numeric, (v_i ->> 'prob_atendido_classificador')::numeric,
           coalesce(v_i ->> 'provedor_classificador', 'jev')
    where (v_i ->> 'prob_atendido_classificador') is not null
    on conflict do nothing;
  end loop;

  perform public.app__qualidade_recalcular(v_id);

  if v_modo = 'publicado' and v_vendedor is not null then
    for v_pend in select * from jsonb_array_elements(coalesce(p -> 'pendencias', '[]'::jsonb)) loop
      if nullif(v_pend ->> 'chave', '') is null then
        -- Compromisso que o nosso lado assumiu ("mando a proposta até sexta"): não nasce de
        -- item reprovado, nasce do que foi combinado — e vira atraso quando o prazo passa.
        insert into public.qualidade_pendencias (analise_id, vendedor_id, empresa_id, conversa_id, reuniao_id,
                                                 tipo, descricao, citacao, prazo_em)
        values (v_id, v_vendedor, v_empresa, nullif(p ->> 'conversa_id', '')::uuid, nullif(p ->> 'reuniao_id', '')::uuid,
                coalesce(nullif(v_pend ->> 'tipo', ''), 'proximo_passo'), v_pend ->> 'descricao',
                nullif(v_pend ->> 'citacao', ''), nullif(v_pend ->> 'prazo_em', '')::timestamptz);
      else
        insert into public.qualidade_pendencias (analise_id, analise_item_id, vendedor_id, empresa_id, conversa_id,
                                                 reuniao_id, tipo, descricao, citacao, prazo_em)
        select v_id, ai.id, v_vendedor, v_empresa, nullif(p ->> 'conversa_id', '')::uuid,
               nullif(p ->> 'reuniao_id', '')::uuid, v_pend ->> 'tipo', v_pend ->> 'descricao',
               nullif(v_pend ->> 'citacao', ''), nullif(v_pend ->> 'prazo_em', '')::timestamptz
        from public.analise_itens ai
        where ai.analise_id = v_id and ai.chave = v_pend ->> 'chave' and ai.atendido = false
        on conflict do nothing;
      end if;
      if found then v_n_pend := v_n_pend + 1; end if;
    end loop;
  end if;

  update public.analise_fila set status = 'concluida', processada_em = now(), analise_id = v_id, erro = null
  where id = nullif(p ->> 'fila_id', '')::uuid;

  insert into public.empresa_eventos (empresa_id, tipo, payload)
  values (v_empresa, 'analise.concluida',
    jsonb_build_object('resumo', 'Interação analisada (' || (p ->> 'escopo') || ').', 'analise_id', v_id,
                       'escopo', p ->> 'escopo', 'modo', v_modo, 'vendedor_id', v_vendedor));
  if v_modo = 'publicado' and v_vendedor is not null then
    insert into public.empresa_eventos (empresa_id, tipo, payload)
    values (v_empresa, 'analise.publicada',
      jsonb_build_object('titulo', 'Feedback novo',
                         'resumo', 'Uma interação sua foi analisada. ' || coalesce((select explicacao from public.analises where id = v_id), ''),
                         'url', '/comercial/feedback?analise=' || v_id, 'analise_id', v_id, 'vendedor_id', v_vendedor));
  end if;
  if v_n_pend > 0 then
    insert into public.empresa_eventos (empresa_id, tipo, payload)
    values (v_empresa, 'qualidade.pendencia_detectada',
      jsonb_build_object('titulo', 'Pendência detectada',
                         'resumo', v_n_pend || ' pendência(s) do nosso lado ficaram numa conversa. Estão no seu Meu Dia.',
                         'url', '/comercial/meu-dia', 'analise_id', v_id, 'vendedor_id', v_vendedor));
  end if;
  return v_id;
end $$;

/*
 * Write-back cadastral (§11): o aditivo grava direto — contato novo, campo vazio —, sempre
 * com origem `analise_conversa` e o link da interação. Sobrescrita só propõe.
 * Gente nossa (e-mail de usuário, domínio de usuário, notetaker) nunca vira contato.
 */
create or replace function public.app__qualidade_writeback(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_empresa uuid := (p ->> 'empresa_id')::uuid;
  v_c jsonb;
  v_email text; v_tel text; v_nome text; v_cargo text;
  v_ct public.contatos;
  v_criados int := 0; v_completados int := 0; v_sugeridos int := 0;
  v_origem jsonb := jsonb_build_object('analise_id', p ->> 'analise_id', 'reuniao_id', p ->> 'reuniao_id', 'escopo', p ->> 'escopo');
begin
  if v_empresa is null then
    return jsonb_build_object('criados', 0, 'completados', 0, 'sugeridos', 0);
  end if;

  for v_c in select * from jsonb_array_elements(coalesce(p -> 'contatos', '[]'::jsonb)) loop
    v_nome := nullif(btrim(coalesce(v_c ->> 'nome', '')), '');
    v_email := nullif(lower(btrim(coalesce(v_c ->> 'email', ''))), '');
    v_tel := nullif(regexp_replace(coalesce(v_c ->> 'telefone', ''), '\D', '', 'g'), '');
    v_cargo := nullif(btrim(coalesce(v_c ->> 'cargo', '')), '');
    if v_nome is null then continue; end if;
    if v_tel is not null and length(v_tel) < 10 then v_tel := null; end if;

    if v_email is not null and (
         v_email like '%@fireflies.ai'
         or exists (select 1 from public.usuarios u where lower(u.email) = v_email)
         or split_part(v_email, '@', 2) in (select distinct split_part(lower(u.email), '@', 2) from public.usuarios u)) then
      continue;
    end if;

    v_ct := null;
    select * into v_ct from public.contatos ct
     where ct.empresa_id = v_empresa
       and ((v_email is not null and lower(ct.email) = v_email)
         or (v_tel is not null and (regexp_replace(coalesce(ct.telefone, ''), '\D', '', 'g') = v_tel
                                    or regexp_replace(coalesce(ct.whatsapp, ''), '\D', '', 'g') = v_tel))
         or lower(btrim(ct.nome)) = lower(v_nome))
     order by (v_email is not null and lower(ct.email) = v_email) desc
     limit 1;

    if v_ct.id is null then
      -- Contato novo só com algo além do nome: um nome solto não é cadastro, é anotação.
      if v_email is null and v_tel is null and v_cargo is null then continue; end if;
      insert into public.contatos (empresa_id, nome, cargo, email, telefone, origem, origem_interacao,
                                   base_legal, base_legal_em, base_legal_detalhe)
      values (v_empresa, v_nome, v_cargo, v_email, v_tel, 'analise_conversa', v_origem,
              'relacao_comercial', now(), 'Participou de interação comercial registrada (' || coalesce(p ->> 'escopo', '') || ').');
      v_criados := v_criados + 1;
    else
      if v_cargo is not null and nullif(btrim(coalesce(v_ct.cargo, '')), '') is null then
        update public.contatos set cargo = v_cargo where id = v_ct.id;
        v_completados := v_completados + 1;
      elsif v_cargo is not null and lower(btrim(v_ct.cargo)) <> lower(v_cargo) then
        insert into public.empresa_sugestoes_cadastro (empresa_id, contato_id, campo, valor_atual, valor_sugerido, analise_id)
        values (v_empresa, v_ct.id, 'cargo', v_ct.cargo, v_cargo, nullif(p ->> 'analise_id', '')::uuid)
        on conflict do nothing;
        if found then v_sugeridos := v_sugeridos + 1; end if;
      end if;
      if v_email is not null and nullif(btrim(coalesce(v_ct.email, '')), '') is null then
        update public.contatos set email = v_email where id = v_ct.id;
        v_completados := v_completados + 1;
      elsif v_email is not null and lower(v_ct.email) <> v_email then
        insert into public.empresa_sugestoes_cadastro (empresa_id, contato_id, campo, valor_atual, valor_sugerido, analise_id)
        values (v_empresa, v_ct.id, 'email', v_ct.email, v_email, nullif(p ->> 'analise_id', '')::uuid)
        on conflict do nothing;
        if found then v_sugeridos := v_sugeridos + 1; end if;
      end if;
      if v_tel is not null and nullif(btrim(coalesce(v_ct.telefone, '')), '') is null then
        update public.contatos set telefone = v_tel where id = v_ct.id;
        v_completados := v_completados + 1;
      elsif v_tel is not null and regexp_replace(v_ct.telefone, '\D', '', 'g') <> v_tel
            and regexp_replace(coalesce(v_ct.whatsapp, ''), '\D', '', 'g') <> v_tel then
        insert into public.empresa_sugestoes_cadastro (empresa_id, contato_id, campo, valor_atual, valor_sugerido, analise_id)
        values (v_empresa, v_ct.id, 'telefone', v_ct.telefone, v_tel, nullif(p ->> 'analise_id', '')::uuid)
        on conflict do nothing;
        if found then v_sugeridos := v_sugeridos + 1; end if;
      end if;
    end if;
  end loop;

  return jsonb_build_object('criados', v_criados, 'completados', v_completados, 'sugeridos', v_sugeridos);
end $$;

-- Candidatas para a vinculação (§10).
create or replace function public.app__vinc_candidatas_dominio(p_dominio text)
returns table (empresa_id uuid, cnpj text, razao_social text, nome_fantasia text, dominio text, uf text, valor numeric)
language sql stable security definer set search_path = '' as $$
  select e.id, e.cnpj, e.razao_social, e.nome_fantasia, e.dominio, e.uf,
         coalesce(e.valor_esperado_mensal, e.faturamento_anual / 12)
  from public.empresas e where lower(e.dominio) = lower(p_dominio)
  union
  select e.id, e.cnpj, e.razao_social, e.nome_fantasia, e.dominio, e.uf,
         coalesce(e.valor_esperado_mensal, e.faturamento_anual / 12)
  from public.contatos ct join public.empresas e on e.id = ct.empresa_id
  where lower(split_part(ct.email, '@', 2)) = lower(p_dominio)
  limit 50
$$;

create or replace function public.app__vinc_candidatas_telefone(p_digitos text)
returns table (empresa_id uuid, cnpj text, razao_social text, nome_fantasia text, dominio text, uf text, valor numeric)
language sql stable security definer set search_path = '' as $$
  select distinct e.id, e.cnpj, e.razao_social, e.nome_fantasia, e.dominio, e.uf,
         coalesce(e.valor_esperado_mensal, e.faturamento_anual / 12)
  from public.contatos ct join public.empresas e on e.id = ct.empresa_id
  where length(p_digitos) >= 10
    and (right(regexp_replace(coalesce(ct.telefone, ''), '\D', '', 'g'), 11) = right(p_digitos, 11)
      or right(regexp_replace(coalesce(ct.whatsapp, ''), '\D', '', 'g'), 11) = right(p_digitos, 11))
  limit 50
$$;

create or replace function public.app__vinc_candidatas_nome(p_nome text, p_limite int)
returns table (empresa_id uuid, cnpj text, razao_social text, nome_fantasia text, dominio text, uf text, valor numeric)
language sql stable security definer set search_path = '' as $$
  select e.id, e.cnpj, e.razao_social, e.nome_fantasia, e.dominio, e.uf,
         coalesce(e.valor_esperado_mensal, e.faturamento_anual / 12)
  from public.empresas e
  where e.razao_social operator(public.%) p_nome or e.nome_fantasia operator(public.%) p_nome
  order by greatest(public.similarity(e.razao_social, p_nome), public.similarity(coalesce(e.nome_fantasia, ''), p_nome)) desc
  limit p_limite
$$;

-- ─── Grants ─────────────────────────────────────────────────────────────────

do $$
declare
  f text;
begin
  foreach f in array array[
    'app_qualidade_salvar_config(jsonb)', 'app_qualidade_salvar_segredo(jsonb)', 'app_qualidade_segredos()',
    'app_qualidade_pessoas()', 'app_qualidade_salvar_pessoa(jsonb)', 'app_reuniao_captura(jsonb)',
    'app_reuniao_dispensar_captura(jsonb)', 'app_reuniao_chamar_bot(jsonb)', 'app_qualidade_analise(jsonb)',
    'app_qualidade_selo(jsonb)', 'app_qualidade_feedback(jsonb)', 'app_qualidade_contestar(jsonb)',
    'app_qualidade_contestacoes(jsonb)', 'app_qualidade_decidir_contestacao(jsonb)', 'app_qualidade_para_rotular(jsonb)',
    'app_qualidade_rotular(jsonb)', 'app_qualidade_salvar_rubrica(jsonb)', 'app_qualidade_ativar_rubrica(jsonb)',
    'app_qualidade_pedir_recalibracao(jsonb)', 'app_qualidade_override_limiar(jsonb)',
    'app_qualidade_resolver_pendencia(jsonb)', 'app_qualidade_agregado(jsonb)', 'app_qualidade_vinculacao(jsonb)',
    'app_qualidade_auditar_vinculo(jsonb)', 'app_empresa_sugestoes(jsonb)', 'app_empresa_sugestao_decidir(jsonb)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;

  foreach f in array array[
    'app__qualidade_exige_gestor()', 'app__qualidade_recalcular(uuid)', 'app__qualidade_segredo(text)',
    'app__reuniao_visivel(public.vendedor_eventos)', 'app__reuniao_por_fireflies(jsonb)', 'app__qualidade_vigiar()',
    'app__qualidade_janelas_candidatas(int, int)', 'app__qualidade_gravar_analise(jsonb)',
    'app__qualidade_writeback(jsonb)', 'app__vinc_candidatas_dominio(text)', 'app__vinc_candidatas_telefone(text)',
    'app__vinc_candidatas_nome(text, int)', 'app__reuniao_captura_sincronizar()', 'app__voz_enfileirar_analise()'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
