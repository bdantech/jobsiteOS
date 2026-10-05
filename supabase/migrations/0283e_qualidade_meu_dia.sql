-- ─────────────────────────────────────────────────────────────────────────────
-- 0283e — As pendências das conversas entram no Meu Dia (05C §7)
--
-- O corpo é o de 0278 (conferido contra `pg_get_functiondef` do banco vivo antes de
-- escrever, idêntico), com um bloco a mais no fim: `pendencias_conversas`. Ele vale
-- para todos os cargos, como os outros blocos de conversa, e o auxiliar vê as dele mais
-- as do closer — com "de Fulano" no subtítulo quando não são dele.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.app__md_comuns(p_alvos uuid[], p_config jsonb, p_ocultos text[])
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  v_blocos jsonb := '[]'::jsonb;
  v_itens jsonb; v_total int; v_valor numeric; v_max int; v_d numeric;
begin
  if public.app__md_ativo(p_config, 'conversas_paradas') then
    v_max := public.app__md_max(p_config, 'conversas_paradas');
    v_d := public.app__md_lim(p_config, 'conversas_paradas', 'dias_parada', 5);
    with base as (
      select c.id::text as referencia_id,
             coalesce(public.app__md_nome(e.razao_social), public.app__md_nome(e.nome_fantasia),
                      public.app__md_nome(ct.nome), public.app__md_nome(nv.nome_sugerido),
                      c.identificador_externo, 'Contato sem nome') as titulo,
             coalesce(c.objetivo, 'sem objetivo') || ' · ' || c.canal as subtitulo,
             'Objetivo aberto e sem toque há ' || extract(day from now() - c.ultima_mensagem_em)::int || ' dias' as motivo,
             e.valor_esperado_mensal as valor,
             'media'::text as urgencia,
             extract(day from now() - c.ultima_mensagem_em)::int as dias,
             e.id as empresa_id, null::timestamptz as quando,
             jsonb_build_object('conversa_id', c.id) as meta,
             extract(epoch from now() - c.ultima_mensagem_em) as ord
      from public.conversas c
      left join public.empresas e on e.id = c.empresa_id
      left join public.contatos ct on ct.id = c.contato_id
      left join lateral (
        select n.nome_sugerido from public.conversas_nao_vinculadas n
        where n.identificador_externo = c.identificador_externo
           or (c.lid is not null and n.lid = c.lid)
        order by (n.nome_sugerido is null), n.ultima_mensagem_em desc
        limit 1
      ) nv on true
      where c.responsavel_vendedor_id = any(p_alvos)
        and c.objetivo is not null and c.status <> 'encerrada'
        and c.ultima_mensagem_em < now() - make_interval(days => v_d::int)
        and not (('conversas_paradas|' || c.id::text) = any(p_ocultos))
        /* Contato ignorado na fila de identificação não é trabalho de ninguém. */
        and not exists (
          select 1 from public.conversas_nao_vinculadas nvi
          where nvi.status = 'ignorada'
            and (nvi.identificador_externo = c.identificador_externo
                 or (c.lid is not null and nvi.lid = c.lid))
        )
    )
    select coalesce((select jsonb_agg(to_jsonb(b) - 'ord') from (select * from base order by ord desc limit v_max) b), '[]'::jsonb),
           (select count(*)::int from base), (select coalesce(sum(valor), 0) from base)
      into v_itens, v_total, v_valor;
    v_blocos := v_blocos || public.app__md_bloco('conversas_paradas', v_itens, v_total, v_valor);
  end if;

  if public.app__md_ativo(p_config, 'conversas_aguardando_resposta') then
    v_max := public.app__md_max(p_config, 'conversas_aguardando_resposta');
    with base as (
      /*
       * O TÍTULO NUNCA É "Sem empresa" NEM UM NÚMERO DE TELEFONE.
       *
       * A ordem é a da confiança: razão social, nome fantasia, nome do contato no CRM,
       * nome do perfil de quem escreveu, e só então o número. Trinta e cinco das trinta
       * e oito conversas sem ficha do originador têm nome de perfil.
       */
      select c.id::text as referencia_id,
             coalesce(public.app__md_nome(e.razao_social), public.app__md_nome(e.nome_fantasia),
                      public.app__md_nome(ct.nome), public.app__md_nome(nv.nome_sugerido),
                      c.identificador_externo, 'Contato sem nome') as titulo,
             case when e.id is null then c.canal || ' · sem ficha no CRM'
                  else coalesce(ct.nome, 'contato') || ' · ' || c.canal end as subtitulo,
             'Esperando resposta há '
               || greatest(round(extract(epoch from now() - c.ultima_mensagem_em) / 3600), 0)::int
               || 'h' as motivo,
             null::numeric as valor,
             case when c.ultima_mensagem_em < now() - interval '24 hours' then 'alta' else 'media' end::text as urgencia,
             greatest(round(extract(epoch from now() - c.ultima_mensagem_em) / 3600), 0)::int as dias,
             e.id as empresa_id, null::timestamptz as quando,
             jsonb_build_object(
               'conversa_id', c.id,
               'nao_lidas', c.nao_lidas,
               /* O eixo do gráfico: horas esperando, do maior para o menor. */
               'horas', greatest(round(extract(epoch from now() - c.ultima_mensagem_em) / 3600), 0)::int,
               'canal', c.canal
             ) as meta,
             extract(epoch from now() - c.ultima_mensagem_em) as ord
      from public.conversas c
      left join public.empresas e on e.id = c.empresa_id
      left join public.contatos ct on ct.id = c.contato_id
      left join lateral (
        select n.nome_sugerido from public.conversas_nao_vinculadas n
        where n.identificador_externo = c.identificador_externo
           or (c.lid is not null and n.lid = c.lid)
        order by (n.nome_sugerido is null), n.ultima_mensagem_em desc
        limit 1
      ) nv on true
      /* A bola está comigo: a última mensagem foi RECEBIDA. */
      where c.responsavel_vendedor_id = any(p_alvos)
        and c.ultima_direcao = 'entrada' and c.status <> 'encerrada'
        and not (('conversas_aguardando_resposta|' || c.id::text) = any(p_ocultos))
        /* Contato ignorado na fila de identificação não é trabalho de ninguém. */
        and not exists (
          select 1 from public.conversas_nao_vinculadas nvi
          where nvi.status = 'ignorada'
            and (nvi.identificador_externo = c.identificador_externo
                 or (c.lid is not null and nvi.lid = c.lid))
        )
    )
    select coalesce((select jsonb_agg(to_jsonb(b) - 'ord') from (select * from base order by ord desc limit v_max) b), '[]'::jsonb),
           (select count(*)::int from base), 0
      into v_itens, v_total, v_valor;
    v_blocos := v_blocos || public.app__md_bloco('conversas_aguardando_resposta', v_itens, v_total, v_valor);
  end if;

  if public.app__md_ativo(p_config, 'proximos_passos_agente') then
    v_max := public.app__md_max(p_config, 'proximos_passos_agente');
    v_d := public.app__md_lim(p_config, 'proximos_passos_agente', 'confianca_minima', 0);
    with base as (
      select c.id::text as referencia_id,
             coalesce(public.app__md_nome(i.empresa_nome), public.app__md_nome(i.contato_nome),
                      i.identificador_externo, 'Contato sem nome') as titulo,
             coalesce(i.contato_nome, 'contato') || ' · ' || i.sugestao_acao as subtitulo,
             coalesce(i.sugestao_justificativa, 'O Agente sugeriu um próximo passo') as motivo,
             null::numeric as valor,
             'media'::text as urgencia,
             extract(day from now() - i.ultima_mensagem_em)::int as dias,
             i.empresa_id, null::timestamptz as quando,
             jsonb_build_object('conversa_id', c.id, 'sugestao_id', i.sugestao_id,
                                'conteudo', i.sugestao_conteudo, 'confianca', i.sugestao_confianca) as meta,
             coalesce(i.sugestao_confianca, 0) as ord
      from public.inbox_conversas i
      join public.conversas c on c.id = i.id
      where i.responsavel_vendedor_id = any(p_alvos)
        and i.sugestao_id is not null
        and coalesce(i.sugestao_confianca, 0) >= v_d
        and not (('proximos_passos_agente|' || c.id::text) = any(p_ocultos))
        /* Contato ignorado na fila de identificação não é trabalho de ninguém. */
        and not exists (
          select 1 from public.conversas_nao_vinculadas nvi
          where nvi.status = 'ignorada'
            and (nvi.identificador_externo = c.identificador_externo
                 or (c.lid is not null and nvi.lid = c.lid))
        )
    )
    select coalesce((select jsonb_agg(to_jsonb(b) - 'ord') from (select * from base order by ord desc limit v_max) b), '[]'::jsonb),
           (select count(*)::int from base), 0
      into v_itens, v_total, v_valor;
    v_blocos := v_blocos || public.app__md_bloco('proximos_passos_agente', v_itens, v_total, v_valor);
  end if;

  if public.app__md_ativo(p_config, 'tarefas_manuais') then
    v_max := public.app__md_max(p_config, 'tarefas_manuais');
    with base as (
      select t.id::text as referencia_id,
             t.titulo,
             coalesce(public.app__md_nome(e.razao_social), public.app__md_nome(e.nome_fantasia),
                      t.detalhe) as subtitulo,
             (case
               when t.vence_em is null then 'Sem prazo'
               when t.vence_em < current_date then 'Venceu em ' || to_char(t.vence_em, 'DD/MM')
               when t.vence_em = current_date then 'Vence hoje'
               else 'Vence em ' || to_char(t.vence_em, 'DD/MM')
             end
             /*
              * DE QUEM É A TAREFA, quando não é de quem manda na lista.
              *
              * Só aparece no caso do auxiliar, que é o único em que `p_alvos` tem mais
              * de um nome. Sem isto, a tarefa dela e a do closer ficariam
              * indistinguíveis numa lista só — e "concluir" é um botão que não admite
              * ambiguidade sobre de quem era a obrigação.
              */
             || case when t.vendedor_id is distinct from p_alvos[1]
                     then ' · tarefa de ' || coalesce(vd.nome, 'outro vendedor')
                     else '' end) as motivo,
             null::numeric as valor,
             case
               when t.vence_em is not null and t.vence_em <= current_date then 'alta'
               when t.vence_em is not null and t.vence_em <= current_date + 2 then 'media'
               else 'baixa'
             end::text as urgencia,
             case when t.vence_em is null then null else (current_date - t.vence_em) end as dias,
             t.empresa_id,
             case when t.vence_em is null then null else t.vence_em::timestamptz end as quando,
             jsonb_build_object('tarefa_id', t.id, 'vendedor_id', t.vendedor_id,
                                'vendedor_nome', vd.nome) as meta,
             coalesce(t.vence_em, current_date + 3650) as ord
      from public.meu_dia_tarefas t
      left join public.empresas e on e.id = t.empresa_id
      left join public.vendedores vd on vd.id = t.vendedor_id
      where t.vendedor_id = any(p_alvos) and t.concluida_em is null
        and not (('tarefas_manuais|' || t.id::text) = any(p_ocultos))
    )
    select coalesce((select jsonb_agg(to_jsonb(b) - 'ord') from (select * from base order by ord asc limit v_max) b), '[]'::jsonb),
           (select count(*)::int from base), 0
      into v_itens, v_total, v_valor;
    v_blocos := v_blocos || public.app__md_bloco('tarefas_manuais', v_itens, v_total, v_valor);
  end if;

  /*
   * PENDÊNCIAS DAS CONVERSAS (05C §7) — o que a análise achou parado do NOSSO lado:
   * pergunta sem resposta, retorno fora do prazo, compromisso combinado. É a parte de
   * maior valor prático do módulo, e por isso não fica só na aba Feedback: vira trabalho
   * aqui, com link para a conversa. Só nasce de análise PUBLICADA (rubrica calibrada).
   */
  if public.app__md_ativo(p_config, 'pendencias_conversas') then
    v_max := public.app__md_max(p_config, 'pendencias_conversas');
    with base as (
      select q.id::text as referencia_id,
             coalesce(public.app__md_nome(e.razao_social), public.app__md_nome(e.nome_fantasia),
                      public.app__md_nome(ct.nome), 'Conversa sem empresa') as titulo,
             case q.tipo
               when 'pergunta_sem_resposta' then 'Pergunta sem resposta'
               when 'pendencia_nossa' then 'Pendência nossa'
               when 'follow_up_atrasado' then 'Retorno fora do prazo'
               else 'Compromisso combinado' end
             || case when q.vendedor_id is distinct from p_alvos[1]
                     then ' · de ' || coalesce(vd.nome, 'outro vendedor') else '' end as subtitulo,
             (case
               when q.prazo_em is not null and q.prazo_em < now() then 'Venceu em ' || to_char(q.prazo_em at time zone 'America/Sao_Paulo', 'DD/MM') || ' · '
               when q.prazo_em is not null then 'Até ' || to_char(q.prazo_em at time zone 'America/Sao_Paulo', 'DD/MM') || ' · '
               else '' end) || q.descricao as motivo,
             null::numeric as valor,
             case
               when q.prazo_em is not null and q.prazo_em < now() then 'alta'
               when q.tipo in ('pergunta_sem_resposta', 'follow_up_atrasado') then 'alta'
               when q.prazo_em is not null and q.prazo_em < now() + interval '2 days' then 'media'
               else 'media' end::text as urgencia,
             extract(day from now() - q.criada_em)::int as dias,
             q.empresa_id,
             q.prazo_em as quando,
             jsonb_build_object('pendencia_id', q.id, 'analise_id', q.analise_id, 'conversa_id', q.conversa_id,
                                'evento_id', (select r.evento_id from public.reunioes r where r.id = q.reuniao_id),
                                'tipo', q.tipo, 'citacao', q.citacao) as meta,
             coalesce(q.prazo_em, q.criada_em + interval '3 days') as ord
      from public.qualidade_pendencias q
      left join public.analises a on a.id = q.analise_id
      left join public.empresas e on e.id = q.empresa_id
      left join public.contatos ct on ct.id = a.contato_id
      left join public.vendedores vd on vd.id = q.vendedor_id
      where q.vendedor_id = any(p_alvos) and q.status = 'aberta'
        and not (('pendencias_conversas|' || q.id::text) = any(p_ocultos))
    )
    select coalesce((select jsonb_agg(to_jsonb(b) - 'ord') from (select * from base order by ord asc limit v_max) b), '[]'::jsonb),
           (select count(*)::int from base), 0
      into v_itens, v_total, v_valor;
    v_blocos := v_blocos || public.app__md_bloco('pendencias_conversas', v_itens, v_total, v_valor);
  end if;

  return v_blocos;
end $function$;


