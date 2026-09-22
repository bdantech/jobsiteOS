-- 0232 — O lembrete é do SDR, sai pelo número dele, e o texto é escrito para a
-- hora da ENTREGA.
--
-- O caso: um lembrete do card do Viktor (SDR da ALPHAPAV) foi gravado como sendo
-- do Fabio (o closer que iria à reunião) e saiu pelo celular do Rodrigo, que não
-- tinha nada a ver com o card. Três decisões erradas em cadeia, cada uma
-- defensável isoladamente.
--
-- Esta migração traz só a parte que vive no banco — o template que faltava. O
-- resto é código (`lembretes-reuniao.ts`).
--
-- ─── Por que um template novo, e não um "amanhã/hoje" no mesmo ─────────────
--
-- A janela de envio é seg–sex, 9h–18h, então fim de semana nunca recebeu nada —
-- isso já estava certo. O que faltava era o CORPO saber disso.
--
-- Um D-1 gerado no domingo de manhã dizia "nossa conversa AMANHÃ, 21/09" e só
-- saía da fila na segunda às 9h, quando "amanhã" já era hoje e a reunião estava a
-- uma hora. O texto foi escrito para uma realidade e entregue em outra.
--
-- A escolha do template passou a ser feita contra o instante da ENTREGA
-- (`proximaAbertura`), e não contra o instante da geração. Domingo de manhã, para
-- uma reunião segunda ao meio-dia, a resposta agora é este D-0.
--
-- Ele fala em HORA e não em data, de propósito: "hoje, às 13:00" é a frase que a
-- pessoa confere no relógio. Repetir a data de hoje é ruído.
insert into templates_mensagem (nome, canal, funil, objetivo, assunto, corpo, variaveis, ativo)
values (
  'Lembrete D-0',
  'whatsapp',
  'sdr',
  'agendar_reuniao',
  null,
  'Oi, {contato_nome}! Passando para lembrar da nossa conversa hoje, às {hora_reuniao}. Segue de pé?',
  array['contato_nome', 'hora_reuniao'],
  true
)
on conflict do nothing;
