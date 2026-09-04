-- ============================================================================
-- 0173 — A fila de identificação ficou para trás na 0172
--
-- A 0172 deduzia o número real a partir das linhas de `comunicacoes` que ainda
-- carregavam o `sessionId` — e reescrevia essas linhas ANTES de corrigir a fila.
-- Quando a segunda atualização rodou, a evidência já não existia: nenhuma linha
-- casava com o `sessionId`, a dedução voltou vazia, e as 20 conversas pendentes
-- continuaram sem sugestão de dono. Sem erro nenhum, que é o pior jeito de uma
-- migração não fazer nada.
--
-- O arquivo da 0172 foi reordenado para que uma reexecução do zero fique certa.
-- Esta aqui conserta o banco que já rodou a versão errada, e usa outra fonte —
-- a CONVERSA, que a 0172 já corrigiu. Ela é melhor que a original: a fila e a
-- conversa falam da mesma pessoa (mesmo canal, mesmo identificador), e a posse já
-- está resolvida lá.
-- ============================================================================

update public.conversas_nao_vinculadas nv
set
  vendedor_sugerido_id = coalesce(nv.vendedor_sugerido_id, cv.responsavel_vendedor_id),
  conta_recebedora = case
    when exists (select 1 from public.whatsapp_contas w where w.numero = nv.conta_recebedora)
      then nv.conta_recebedora
    else coalesce(
      (select w2.numero
         from public.whatsapp_contas w2
         join public.vendedores v2 on v2.usuario_id = w2.usuario_responsavel
        where v2.id = cv.responsavel_vendedor_id
        limit 1),
      nv.conta_recebedora)
  end
from public.conversas cv
where cv.canal = nv.canal
  and (
    cv.identificador_externo = nv.identificador_externo
    or (nv.lid is not null and cv.lid = nv.lid)
    or (cv.lid is not null and cv.lid = nv.identificador_externo)
  )
  and cv.responsavel_vendedor_id is not null
  and nv.vendedor_sugerido_id is null;
