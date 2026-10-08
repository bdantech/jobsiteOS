-- ─────────────────────────────────────────────────────────────────────────────
-- 0292b — A calibração lê a fala
--
-- Quem rotula uma janela de conversa em Qualidade → Calibração precisa ler o que o
-- classificador leu. Com a 0292 o classificador passou a receber a transcrição do áudio;
-- a tela continuava recebendo só "(áudio · 15s)", e o rótulo humano seria dado sobre
-- outro texto.
--
-- Corpo lido do banco vivo em 08/10/2026; a única mudança é `'transcricao', m.transcricao`
-- nas mensagens da janela.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.app_qualidade_analise(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
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
                        'transcricao', m.transcricao,
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
        and (v_gestor or not ai.em_sombra))
  );
end $function$;
