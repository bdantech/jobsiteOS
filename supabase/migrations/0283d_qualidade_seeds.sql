-- ═════════════════════════════════════════════════════════════════════════════
-- 0283d — Inteligência de Conversas (05C): rubricas iniciais e avisos
--
-- As três rubricas nascem ATIVAS e NÃO CALIBRADAS — ou seja, em sombra: analisam e
-- gravam desde o primeiro dia, e nenhuma nota chega a um vendedor até a calibração (§5).
-- É a sombra que produz as interações que o gestor vai rotular.
--
-- ─── A CONDIÇÃO DE APLICABILIDADE NÃO É OPCIONAL (§3.2) ─────────────────────
-- "Definiu próximo passo" numa ligação em que o cliente disse "não tenho interesse" é
-- falso negativo. Cada item que depende de algo ter acontecido carrega a pergunta que
-- verifica isso, e item inaplicável sai do denominador.
--
-- ─── PERGUNTA NEGATIVA, RESPOSTA ESPERADA NEGATIVA ──────────────────────────
-- "Alguma pergunta do cliente ficou sem resposta?" é a pergunta do spec, e é melhor
-- assim para o classificador (ele procura a falta). O que conta como atendido é o NÃO —
-- `atende = {nao}`.
-- ═════════════════════════════════════════════════════════════════════════════

do $$
declare
  v_reuniao uuid;
  v_ligacao uuid;
  v_texto uuid;
  v_tipo text;
  v_id uuid;
begin
  insert into public.rubricas (tipo_interacao, nome, versao, ativa, ativada_em, descricao)
  values ('reuniao', 'Reunião comercial', 1, true, now(),
          'Dor → Solução → Segurança → Próximos passos: o formato de reunião da OnePay, decomposto em checagens observáveis.')
  on conflict (tipo_interacao, versao) do nothing
  returning id into v_reuniao;

  if v_reuniao is not null then
    insert into public.rubrica_itens (rubrica_id, ordem, chave, etapa, rotulo, pergunta, tipo_resposta, atende, peso,
                                      condicao_aplicabilidade, orientacao, gera_pendencia)
    values
      (v_reuniao, 1, 'explorou_dor', 'Dor', 'perguntas sobre a situação do cliente',
       'O vendedor fez perguntas sobre a situação ou dificuldade atual do cliente antes de apresentar a solução?',
       'sim_nao', '{sim}', 1, null,
       'Antes de apresentar a OnePay, pergunte como está o caixa, em quanto tempo o contratante paga e o que trava a obra. Deixe o cliente descrever a dificuldade com as palavras dele.',
       null),
      (v_reuniao, 2, 'cliente_verbalizou_dor', 'Dor', 'dor dita pelo cliente',
       'O cliente descreveu uma dificuldade, necessidade ou problema concreto?',
       'sim_nao', '{sim}', 1, null,
       'Se o cliente não nomeou um problema, aprofunde: "quanto tempo vocês esperam para receber a medição?", "o que acontece no caixa quando ela atrasa?".',
       null),
      (v_reuniao, 3, 'apresentou_solucao', 'Solução', 'solução explicada',
       'O vendedor explicou como a OnePay resolve a dificuldade que o cliente descreveu?',
       'sim_nao', '{sim}', 1,
       'O cliente descreveu alguma dificuldade, necessidade ou problema durante a conversa?',
       'Mostre como a antecipação resolve o problema que o cliente acabou de contar: prazo de recebimento, custo, como a operação funciona na prática.',
       null),
      (v_reuniao, 4, 'conectou_a_dor', 'Solução', 'solução ligada à dor',
       'A solução apresentada foi conectada explicitamente ao que o cliente disse?',
       'sim_nao', '{sim}', 1,
       'O cliente descreveu uma dificuldade, necessidade ou problema concreto durante a conversa?',
       'Volte às palavras do cliente ao apresentar: "você disse que a medição demora 90 dias — com a antecipação, esse dinheiro entra em D+1".',
       null),
      (v_reuniao, 5, 'tratou_objecao', 'Segurança', 'objeções respondidas',
       'Toda objeção levantada pelo cliente recebeu resposta?',
       'sim_nao', '{sim}', 1,
       'O cliente levantou alguma objeção, dúvida ou resistência durante a conversa?',
       'Responda cada objeção antes de seguir. Se não tiver a resposta na hora, diga quando vai trazer — e traga.',
       null),
      (v_reuniao, 6, 'trouxe_prova', 'Segurança', 'elemento de segurança',
       'O vendedor trouxe elemento de segurança (caso, número, garantia, prazo, referência)?',
       'sim_nao', '{sim}', 1,
       'A conversa chegou à apresentação da solução da OnePay?',
       'Traga algo verificável: um cliente parecido que já opera, o prazo médio de liberação, quem está por trás da operação. Segurança é o que transforma interesse em decisão.',
       null),
      (v_reuniao, 7, 'definiu_proximo_passo', 'Próximos passos', 'próximo passo combinado',
       'Ficou combinado um próximo passo concreto?',
       'sim_nao', '{sim}', 1,
       'A conversa terminou sem que o cliente recusasse explicitamente seguir adiante?',
       'Não termine a reunião sem combinar o que acontece agora: envio de documentos, proposta, uma segunda conversa com quem decide.',
       null),
      (v_reuniao, 8, 'proximo_passo_com_data', 'Próximos passos', 'próximo passo com data',
       'Esse próximo passo tem data ou prazo definido?',
       'sim_nao', '{sim}', 1,
       'Ficou combinado algum próximo passo entre as partes?',
       'Feche a data na hora: "te mando a proposta amanhã até as 12h, e falamos na quinta às 10h?". Próximo passo sem data é intenção.',
       null);
  end if;

  -- Ligação e conversa de texto: aderência e pendência. Duas rubricas, mesmo formato —
  -- cada uma calibra sozinha, porque uma ligação de dois minutos e uma semana de
  -- WhatsApp não erram do mesmo jeito.
  foreach v_tipo in array array['ligacao', 'conversa_texto'] loop
    v_id := null;
    insert into public.rubricas (tipo_interacao, nome, versao, ativa, ativada_em, descricao)
    values (v_tipo, case v_tipo when 'ligacao' then 'Ligação' else 'Conversa de texto' end, 1, true, now(),
            'Aderência ao discurso e o que ficou pendente do nosso lado.')
    on conflict (tipo_interacao, versao) do nothing
    returning id into v_id;
    if v_id is null then
      continue;
    end if;

    insert into public.rubrica_itens (rubrica_id, ordem, chave, etapa, rotulo, pergunta, tipo_resposta, opcoes, atende, peso,
                                      condicao_aplicabilidade, orientacao, gera_pendencia)
    values
      (v_id, 1, 'aderencia_discurso', 'Discurso', 'alinhamento com a proposta',
       'O que o vendedor disse está alinhado com a proposta de valor e as condições definidas?',
       'sim_nao', null, '{sim}', 1,
       'O vendedor falou sobre a OnePay, a antecipação ou condições comerciais?',
       'Fale das condições vigentes (taxa, prazo, limite) como estão na política. Não prometa o que não está nela — o cliente cobra depois.',
       null),
      (v_id, 2, 'respondeu_pergunta', 'Pendências', 'pergunta respondida',
       'Alguma pergunta do cliente ficou sem resposta?',
       'sim_nao', null, '{nao}', 1,
       'O cliente fez alguma pergunta?',
       'Responda toda pergunta do cliente. Se não souber na hora, diga quando vai responder — e volte com a resposta.',
       'pergunta_sem_resposta'),
      (v_id, 3, 'pendencia_nossa', 'Pendências', 'pendência nossa resolvida',
       'Ficou alguma pendência do nosso lado sem retorno?',
       'sim_nao', null, '{nao}', 1,
       'Algo foi pedido ao nosso lado ou prometido por nós (proposta, documento, resposta, retorno)?',
       'O que foi prometido ao cliente precisa voltar para ele. Feche a pendência ou avise o novo prazo antes que ele precise cobrar.',
       'pendencia_nossa'),
      (v_id, 4, 'follow_up_no_prazo', 'Pendências', 'retorno no prazo',
       'O retorno ao cliente aconteceu dentro do prazo combinado?',
       'sim_nao', null, '{sim}', 1,
       'Foi combinado um prazo para retornarmos ao cliente, e esse prazo já passou?',
       'Retorne no prazo que você mesmo deu. Se não der, avise antes do prazo vencer — atraso avisado é combinado, atraso calado é descaso.',
       'follow_up_atrasado'),
      (v_id, 5, 'objecao_registrada', 'Mercado', 'objeção',
       'Houve objeção? Qual?',
       'escolha', '["preço", "prazo", "burocracia", "concorrente", "não é o momento", "sem objeção"]'::jsonb, null, 0,
       null,
       'Registro informativo: não pontua.',
       null),
      (v_id, 6, 'mencionou_concorrente', 'Mercado', 'concorrente citado',
       'O cliente mencionou outra empresa de antecipação, banco, fundo ou ERP?',
       'sim_nao', null, null, 0,
       null,
       'Registro informativo: não pontua.',
       null);
  end loop;
end $$;

-- ─── Avisos (§14) ───────────────────────────────────────────────────────────

insert into public.notificacao_tipos (tipo, modulo, nome, descricao, gravidade) values
  ('reuniao.sem_captura', 'comercial', 'O gravador não entrou na reunião',
   'A reunião começou e o Fireflies não entrou. Vai para quem conduz, na hora.', 'critica'),
  ('reuniao.transcrita', 'comercial', 'Transcrição pronta',
   'A transcrição da reunião chegou e está na aba Reunião.', 'normal'),
  ('analise.publicada', 'comercial', 'Feedback novo',
   'Uma interação sua foi analisada. Resumo diário.', 'normal'),
  ('qualidade.pendencia_detectada', 'comercial', 'Pendência detectada',
   'Ficou algo parado do nosso lado numa conversa. Também vira item no Meu Dia.', 'normal'),
  ('analise.contestada', 'comercial', 'Contestação aberta',
   'Um vendedor contestou um item da análise. Fila em Comercial → Qualidade.', 'normal'),
  ('analise.contestacao_resolvida', 'comercial', 'Contestação revisada',
   'A gestão revisou a sua contestação.', 'normal'),
  ('rubrica.saiu_de_sombra', 'comercial', 'Rubrica calibrada',
   'A rubrica saiu de sombra: a partir de agora as notas são publicadas para o time.', 'normal')
on conflict (tipo) do nothing;

insert into public.notificacao_regras (tipo_evento, papel, canais, frequencia, dedup_horas, fallback_admin, respeita_silencio)
values
  ('reuniao.sem_captura',            'vendedor_citado', '{sino,push,email}', 'imediato',      1, true,  false),
  ('reuniao.transcrita',             'vendedor_citado', '{sino}',            'imediato',      0, false, true),
  ('analise.publicada',              'vendedor_citado', '{sino}',            'resumo_diario', 0, false, true),
  ('qualidade.pendencia_detectada',  'vendedor_citado', '{sino}',            'imediato',      0, false, true),
  ('analise.contestacao_resolvida',  'vendedor_citado', '{sino,push}',       'imediato',      0, false, true)
on conflict do nothing;

insert into public.notificacao_regras (tipo_evento, perfil_id, canais, frequencia, dedup_horas, fallback_admin, respeita_silencio)
select r.tipo, pf.id, r.canais::text[], 'imediato', 0, false, true
from (values
  ('analise.contestada',     'Comercial', '{sino,email}'),
  ('analise.contestada',     'Admin',     '{sino}'),
  ('rubrica.saiu_de_sombra', 'Comercial', '{sino}'),
  ('rubrica.saiu_de_sombra', 'Admin',     '{sino}')
) as r(tipo, perfil, canais)
join public.perfis pf on pf.nome = r.perfil
on conflict do nothing;
