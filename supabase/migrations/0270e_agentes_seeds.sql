-- ============================================================================
-- 0270e — Agentes: settings, módulo nos perfis, avisos e playbooks por tipo de mandato
--
-- O padrão é CONSERVADOR de propósito: orçamento mensal zero (nenhuma ferramenta paga
-- roda até um gestor definir o teto), nenhum agente cadastrado, toda regra nasce
-- desligada. Ligar a operação é um ato de gestão na tela, nunca efeito de um deploy.
-- ============================================================================

-- ─── §12 Settings ───────────────────────────────────────────────────────────

insert into public.agentes_config (chave, valor) values
  ('geral', jsonb_build_object(
    'kill_switch', false,
    'identificacao', 'se_perguntada',
    'max_passos_por_ciclo', 8,
    'intervalo_ciclo_min', 5,
    'mandatos_por_ciclo', 20,
    'tempo_limite_ciclo_s', 120,
    'intervalo_sem_mandato_horas', 24,
    'horizonte_agendamento_dias_uteis', 10,
    'reuniao_duracao_min', 30,
    'reuniao_buffer_min', 15,
    'reserva_janela_min', 30,
    'voz_timeout_minutos', 30,
    'modo_carteira_habilitado', false,
    'digest_hora', 18)),
  -- A janela do 05A como ponto de partida: é a que já está valendo para toda mensagem.
  ('janela', coalesce(
    (select valor from public.comunicacao_config where chave = 'janela'),
    jsonb_build_object('hora_inicio', 9, 'hora_fim', 18, 'dias_semana', jsonb_build_array(1, 2, 3, 4, 5),
                       'timezone', 'America/Sao_Paulo'))),
  ('precos', jsonb_build_object(
    'cambio_usd_brl', 5.5,
    'modelo_entrada_usd_mtok', 3,
    'modelo_saida_usd_mtok', 15,
    'ferramentas_centavos', jsonb_build_object(
      'buscar_contatos_apollo', 200, 'enriquecer_telefone', 165, 'buscar_dominio_empresa', 30,
      'enviar_whatsapp', 2, 'enviar_email', 1, 'enviar_material', 2, 'ligar', 350))),
  ('disjuntor', jsonb_build_object(
    'janela_acoes', 20, 'limiar_supressao', 0.10, 'limiar_sem_interesse', 0.60,
    'limiar_escalacao', 0.30, 'limiar_falha_tecnica', 0.25)),
  ('orcamento', jsonb_build_object('teto_mensal_centavos', 0, 'alertas_pct', jsonb_build_array(50, 80, 95)))
on conflict (chave) do nothing;

-- ─── Módulo nos perfis ──────────────────────────────────────────────────────
-- Admin e Comercial são os gestores (app_gestor_comercial). Closer acompanha os agentes
-- de que é o closer designado — a RLS (0270c) restringe o que ele vê a esses.
insert into public.perfil_modulos (perfil_id, modulo_id)
select p.id, 'agentes' from public.perfis p
where p.nome in ('Admin', 'Comercial', 'Closer')
on conflict do nothing;

-- ─── §13 Tipos de aviso ─────────────────────────────────────────────────────
--
-- `orcamento.alerta` e `orcamento.estourado` JÁ EXISTEM e são do Radar (orçamento de
-- enriquecimento). Os do orçamento de agentes ganharam o prefixo do módulo para não caírem
-- nas regras de lá.

insert into public.notificacao_tipos (tipo, modulo, nome, descricao, gravidade) values
  ('mandato.criado', 'agentes', 'Mandato criado', null, 'normal'),
  ('mandato.iniciado', 'agentes', 'Mandato em andamento', null, 'normal'),
  ('mandato.acao_executada', 'agentes', 'Ação do agente', 'Cada ferramenta que o agente executou. Alimenta a timeline, não o sino.', 'normal'),
  ('mandato.plano_atualizado', 'agentes', 'Plano do mandato atualizado', null, 'normal'),
  ('mandato.escalado', 'agentes', 'Mandato escalado para humano', 'O agente parou e pediu uma pessoa: reclamação, negociação, advogado ou pedido expresso.', 'critica'),
  ('mandato.concluido', 'agentes', 'Mandato concluído', null, 'normal'),
  ('mandato.encerrado', 'agentes', 'Mandato encerrado sem sucesso', null, 'normal'),
  ('mandato.pausado', 'agentes', 'Mandato pausado', null, 'normal'),
  ('agente.disjuntor_aberto', 'agentes', 'Disjuntor do agente aberto', 'O agente parou sozinho: supressões, recusas, escalações ou falhas acima do limiar nas últimas ações.', 'critica'),
  ('agente.disjuntor_reaberto', 'agentes', 'Disjuntor do agente reaberto', null, 'normal'),
  ('agente.cota_atingida', 'agentes', 'Cota do agente atingida', null, 'normal'),
  ('agentes.orcamento_alerta', 'agentes', 'Orçamento dos agentes', 'O consumo do mês passou de 50/80/95% do teto.', 'normal'),
  ('agentes.orcamento_esgotado', 'agentes', 'Orçamento dos agentes esgotado', 'Ferramentas pagas pararam; os mandatos ficam pausados até o mês seguinte ou até o teto subir.', 'critica'),
  ('agentes.proposta_pendente', 'agentes', 'Proposta de mandato aguardando aprovação', null, 'normal'),
  ('agentes.digest', 'agentes', 'Resumo diário do agente', 'O que fez, o que conseguiu, quanto custou e o que planeja.', 'normal'),
  ('reuniao.agendada_por_ia', 'agentes', 'Reunião marcada por um agente', null, 'normal'),
  ('voz.desfecho_estruturado', 'agentes', 'Desfecho de ligação consumido pelo mandato', null, 'normal'),
  ('agentes.sem_janela', 'agentes', 'Interesse sem janela do closer', 'O cliente quer a reunião e nem o closer nem o substituto têm horário no horizonte de agendamento.', 'normal')
on conflict (tipo) do nothing;

-- Gestores: o que exige ação ou muda dinheiro.
insert into public.notificacao_regras (tipo_evento, perfil_id, canais, dedup_horas, fallback_admin)
select r.tipo, pf.id, r.canais::text[], r.dedup, true
from (values
  ('mandato.escalado',             '{sino,push}',       0),
  ('agente.disjuntor_aberto',      '{sino,push,email}', 0),
  ('agentes.orcamento_alerta',     '{sino,push}',       20),
  ('agentes.orcamento_esgotado',   '{sino,push,email}', 0),
  ('agentes.proposta_pendente',    '{sino,push}',       0),
  ('mandato.concluido',            '{sino}',            0),
  ('agente.cota_atingida',         '{sino}',            20),
  ('agentes.digest',               '{sino,email}',      20),
  ('agentes.sem_janela',           '{sino,push}',       4)
) as r(tipo, canais, dedup)
join public.perfis pf on pf.nome in ('Admin', 'Comercial')
where not exists (select 1 from public.notificacao_regras x where x.tipo_evento = r.tipo and x.perfil_id = pf.id);

-- O closer do agente (payload.destinatarios): a reunião que vai para a agenda dele e a
-- conversa que o agente devolveu a uma pessoa.
insert into public.notificacao_regras
  (tipo_evento, papel, canais, frequencia, dedup_horas, fallback_admin, respeita_silencio)
select r.tipo, 'nomeados', r.canais::text[], 'imediato', r.dedup, false, r.silencio
from (values
  ('reuniao.agendada_por_ia',  '{sino,push}', 0, true),
  ('mandato.escalado',         '{sino,push}', 0, false),
  ('mandato.concluido',        '{sino}',      0, true),
  ('agente.disjuntor_aberto',  '{sino,push}', 0, false)
) as r(tipo, canais, dedup, silencio)
where not exists (select 1 from public.notificacao_regras x where x.tipo_evento = r.tipo and x.papel = 'nomeados');

-- ─── Playbooks por tipo de mandato (§12) ────────────────────────────────────
--
-- O "como" de cada tipo. Reusa `agente_playbooks` (versionado, editável sem deploy), com a
-- coluna nova `tipo_mandato` dizendo a que tipo ele serve. `acoes_permitidas` aqui são
-- FERRAMENTAS do loop (core/agentes/ferramentas.ts), não ações do agente de conversa.

alter table public.agente_playbooks add column if not exists tipo_mandato text
  constraint agente_playbooks_tipo_mandato_check check (tipo_mandato is null or tipo_mandato in
    ('originacao_nf', 'agendamento_reuniao', 'reativacao', 'qualificacao'));

insert into public.agente_playbooks (nome, funil, objetivo, instrucoes, acoes_permitidas, prazos, ativo, versao, tipo_mandato)
values
  ('Mandato — Originação de NF', 'nfs', 'antecipar_nf',
   'Objetivo: fazer o fornecedor da nota antecipar este recebível na plataforma. '
   || 'Comece pelo contato que já existe no cadastro ou na própria NF. Se não houver telefone bom, busque o domínio e os contatos do financeiro antes de gastar com enriquecimento. '
   || 'Prefira a ligação para ofertar (a Ana diz o líquido e a taxa com a proposta do dia); use WhatsApp para confirmar e mandar o link. '
   || 'Nunca cite números que não vieram no contexto. Negociação de taxa ou prazo é de uma pessoa: escale. '
   || 'Conclua quando o fornecedor iniciar o cadastro ou pedir a antecipação; encerre sem sucesso quando os contatos se esgotarem ou a nota vencer.',
   array['consultar_empresa', 'consultar_historico', 'consultar_contatos', 'listar_materiais',
         'buscar_dominio_empresa', 'buscar_contatos_apollo', 'enriquecer_telefone', 'registrar_contato',
         'atualizar_contato', 'enviar_whatsapp', 'enviar_email', 'enviar_material', 'ligar', 'agendar_ligacao',
         'mover_estagio_funil', 'propor_mandato', 'escalar_humano', 'encerrar_mandato', 'atualizar_plano'],
   jsonb_build_object('silencio_dias', 2, 'max_tentativas', 6),
   true, 1, 'originacao_nf'),
  ('Mandato — Agendamento de reunião', 'sdr', 'agendar_reuniao',
   'Objetivo: marcar uma reunião do closer designado com quem DECIDE sobre antecipação na empresa (financeiro, sócio, controller). '
   || 'Descubra quem decide antes de insistir: quem atende pode indicar o decisor — registre o contato indicado e siga com ele. '
   || 'Ofereça sempre janelas REAIS da agenda do closer (consultar_agenda_closer) e nunca invente horário. '
   || 'Uma pergunta por mensagem. Reclamação, negociação comercial ou advogado: escale. '
   || 'Conclua quando a reunião estiver marcada; encerre sem sucesso após os contatos se esgotarem.',
   array['consultar_empresa', 'consultar_historico', 'consultar_contatos', 'listar_materiais',
         'buscar_dominio_empresa', 'buscar_contatos_apollo', 'enriquecer_telefone', 'registrar_contato',
         'atualizar_contato', 'enviar_whatsapp', 'enviar_email', 'enviar_material', 'ligar', 'agendar_ligacao',
         'consultar_agenda_closer', 'agendar_reuniao', 'mover_estagio_funil', 'propor_mandato',
         'escalar_humano', 'encerrar_mandato', 'atualizar_plano'],
   jsonb_build_object('silencio_dias', 3, 'max_tentativas', 8),
   true, 1, 'agendamento_reuniao'),
  ('Mandato — Reativação', 'vendas', 'reativar',
   'Objetivo: trazer de volta um ex-cliente ou um cliente parado. '
   || 'Comece entendendo o que mudou (obra parada, troca de financeiro, insatisfação) antes de ofertar qualquer coisa. '
   || 'Se aparecer insatisfação ou reclamação, escale na hora. Se houver interesse em voltar a operar, proponha um mandato de agendamento para o closer. '
   || 'Conclua quando houver interesse claro e o próximo passo com o closer estiver combinado.',
   array['consultar_empresa', 'consultar_historico', 'consultar_contatos', 'listar_materiais',
         'registrar_contato', 'atualizar_contato', 'enviar_whatsapp', 'enviar_email', 'enviar_material',
         'ligar', 'agendar_ligacao', 'consultar_agenda_closer', 'agendar_reuniao', 'propor_mandato',
         'escalar_humano', 'encerrar_mandato', 'atualizar_plano'],
   jsonb_build_object('silencio_dias', 4, 'max_tentativas', 6),
   true, 1, 'reativacao'),
  ('Mandato — Qualificação', 'sdr', 'nenhum',
   'Objetivo: descobrir se a empresa tem fit (recebíveis de obra, volume, quem decide) e registrar o que foi descoberto. '
   || 'Faça no máximo três perguntas por conversa. Quando houver interesse claro, NÃO marque reunião por conta própria: proponha um mandato de agendamento (propor_mandato), que vai para aprovação. '
   || 'Mova o lead para qualificada só com fit confirmado. Encerre sem sucesso quando ficar claro que não há fit.',
   array['consultar_empresa', 'consultar_historico', 'consultar_contatos', 'listar_materiais',
         'buscar_dominio_empresa', 'buscar_contatos_apollo', 'registrar_contato', 'atualizar_contato',
         'enviar_whatsapp', 'enviar_email', 'enviar_material', 'ligar', 'agendar_ligacao',
         'mover_estagio_funil', 'propor_mandato', 'escalar_humano', 'encerrar_mandato', 'atualizar_plano'],
   jsonb_build_object('silencio_dias', 3, 'max_tentativas', 6),
   true, 1, 'qualificacao')
on conflict (nome, versao) do nothing;
