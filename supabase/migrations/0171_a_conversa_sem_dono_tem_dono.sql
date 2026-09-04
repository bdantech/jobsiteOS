-- ============================================================================
-- 0171 — A conversa sem dono quase sempre tem dono
--
-- 54 das 72 threads estavam sem `responsavel_vendedor_id`, e o inbox mostrava
-- "sem responsável" em todas elas. Mas TODAS têm mensagens que passaram por um
-- número que é de alguém: o webhook diz por qual conta a mensagem entrou, e
-- `whatsapp_contas.usuario_responsavel` diz de quem é a conta.
--
-- A causa é a mesma da 0169 e tem a mesma forma: a única fonte de posse era a
-- CARTEIRA (`resolverRemetente` acha a empresa pelo contato e devolve o dono
-- dela), e ela não responde nada enquanto ninguém identificou o contato — que é
-- o estado normal de uma conversa nova. A 0169 corrigiu a autoria das MENSAGENS;
-- a posse da CONVERSA ficou de fora, e é ela que o inbox mostra e filtra.
--
-- ─── COMO SE ESCOLHE, QUANDO HÁ MAIS DE UM NÚMERO ───────────────────────────
-- Algumas threads têm mensagens de duas contas (a migração para o número real,
-- em 02/09, deixou linhas com o `sessionId` do provedor no lugar do número).
-- Ganha quem TROCOU MAIS MENSAGENS naquela thread — não a mais recente, que
-- daria a conversa inteira a quem respondeu uma vez.
--
-- Só preenche o que está NULO. Uma thread com dono foi atribuída por quem sabia
-- mais — o compositor sabe quem apertou enviar, e a vinculação sabe de quem é a
-- carteira —, e sobrescrever isso trocaria um fato por uma inferência.
--
-- O worker passa a fazer o mesmo na ingestão, e `app__conversa_para` já grava com
-- `coalesce`: a thread que já tem dono não troca de dono, e a que não tem passa a
-- ter na próxima mensagem.
-- ============================================================================

with dono as (
  select distinct on (c.conversa_id)
    c.conversa_id,
    v.id as vendedor_id
  from public.comunicacoes c
  join public.whatsapp_contas w on w.numero = c.conta_remetente
  join public.vendedores v on v.usuario_id = w.usuario_responsavel and v.ativo
  where c.conversa_id is not null
  group by c.conversa_id, v.id
  order by c.conversa_id, count(*) desc, v.id
)
update public.conversas cv
set responsavel_vendedor_id = dono.vendedor_id
from dono
where dono.conversa_id = cv.id
  and cv.responsavel_vendedor_id is null;

-- A fila de identificação ganha a mesma sugestão: quem for identificar a
-- conversa já encontra preenchido quem de fato a atendeu.
with dono as (
  select distinct on (nv.id)
    nv.id,
    v.id as vendedor_id
  from public.conversas_nao_vinculadas nv
  join public.whatsapp_contas w on w.numero = nv.conta_recebedora
  join public.vendedores v on v.usuario_id = w.usuario_responsavel and v.ativo
  where nv.vendedor_sugerido_id is null
  order by nv.id, v.id
)
update public.conversas_nao_vinculadas nv
set vendedor_sugerido_id = dono.vendedor_id
from dono
where dono.id = nv.id
  and nv.vendedor_sugerido_id is null;
