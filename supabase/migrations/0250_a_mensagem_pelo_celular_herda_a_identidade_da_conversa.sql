/*
 * A mensagem que saiu pelo celular ficava fora do card.
 *
 * ── O QUE ACONTECIA ─────────────────────────────────────────────────────────
 * `resolverRemetente` reconhece a pessoa pelo IDENTIFICADOR da mensagem. Numa
 * saída pelo aparelho, o provedor costuma mandar só o LID — e o LID acha a
 * THREAD (`app__conversa_por_lid` e `app__conversa_absorver_lid` existem para
 * isso), mas não acha contato nenhum: procurar em `contatos.whatsapp` por um LID
 * nunca casa. A linha nascia na conversa certa com `empresa_id` nulo.
 *
 * O inbox lê por `conversa_id` e mostrava tudo. A aba "Comunicação" do card lê
 * por `empresa_id` e mostrava metade — e a metade que sumia era justamente a
 * resposta dada pelo celular. Na mesma conversa, no mesmo minuto, a entrada
 * aparecia e a saída não.
 *
 * 1.395 mensagens em 123 conversas, 97% delas em conversa com LID. 1.201 caem em
 * 87 fornecedores que têm NF — ou seja, dentro de cards de NF que existem hoje.
 *
 * ── POR QUE HERDAR NÃO É CHUTAR ─────────────────────────────────────────────
 * Não se está adivinhando de quem é a mensagem: está-se usando a identidade da
 * PRÓPRIA thread em que ela foi escrita, que é a mesma que o inbox usa para
 * montar o diálogo. `app_conversa_vincular` já faz exatamente isto desde que
 * existe — só que apenas para quem passa pela fila de identificação, e estas
 * conversas foram identificadas por outro caminho.
 *
 * O `coalesce` é a garantia de que nada é sobrescrito: o que o resolver
 * descobriu continua valendo, e só o nulo é preenchido. Conversa sem empresa
 * segue sem empresa — desconhecido continua desconhecido.
 *
 * A porta de escrita do worker (`escreverNoLedger`) passa a fazer o mesmo na
 * entrada, para não refazer este retroativo no mês que vem.
 */

update public.comunicacoes m
   set empresa_id = coalesce(m.empresa_id, cv.empresa_id),
       contato_id = coalesce(m.contato_id, cv.contato_id)
  from public.conversas cv
 where cv.id = m.conversa_id
   and (m.empresa_id is null or m.contato_id is null)
   and (cv.empresa_id is not null or cv.contato_id is not null);
