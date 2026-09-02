-- ============================================================================
-- 0163 — O inbox mostra o nome que a pessoa escolheu, não o identificador dela.
--
-- A 0162 conserta a origem: dali em diante o webhook grava o telefone de verdade
-- e as threads presas ao LID vão sendo absorvidas conforme cada pessoa volta a
-- escrever. Mas até isso acontecer a lista continua exibindo `98711384416410` —
-- e ninguém reconhece um interlocutor por quinze dígitos.
--
-- O `pushName` já estava guardado o tempo todo, em `conversas_nao_vinculadas`: é
-- o nome que a própria pessoa escolheu se chamar no WhatsApp, e é ele que a fila
-- de identificação exibe. O inbox não o enxergava porque a view não o trazia.
--
-- Uma view, e não um join no cliente: a lista abre até duzentas conversas por
-- tela, e um join por linha ali é a diferença entre abrir e demorar.
-- ============================================================================

create or replace view public.inbox_conversas
with (security_invoker = true) as
select
  cv.id,
  cv.canal,
  cv.identificador_externo,
  cv.empresa_id,
  cv.contato_id,
  cv.objetivo,
  cv.playbook_id,
  cv.responsavel_vendedor_id,
  cv.modo_agente,
  cv.status,
  cv.ultima_mensagem_em,
  cv.ultima_direcao,
  cv.proxima_acao_em,
  cv.nao_lidas,
  e.cnpj          as empresa_cnpj,
  coalesce(e.razao_social, e.nome_fantasia) as empresa_nome,
  ct.nome         as contato_nome,
  ct.cargo        as contato_cargo,
  ct.base_legal   as contato_base_legal,
  ct.nao_e_o_decisor as contato_nao_e_o_decisor,
  v.nome          as responsavel_nome,
  v.is_ia         as responsavel_is_ia,
  ult.preview     as ultima_preview,
  ult.por_ia      as ultima_por_ia,
  ult.triagem     as ultima_triagem,
  sug.id          as sugestao_id,
  sug.acao        as sugestao_acao,
  sug.conteudo_sugerido as sugestao_conteudo,
  sug.justificativa as sugestao_justificativa,
  sug.confianca   as sugestao_confianca,
  -- ─── Acrescentados pela 0163 ─────────────────────────────────────────────
  cv.lid,
  /*
   * O nome que a pessoa escolheu para si no WhatsApp. Só serve enquanto ela não
   * é um contato — assim que alguém vincular, `contato_nome` é o nome OFICIAL e
   * tem precedência, porque foi conferido por gente.
   */
  nv.nome_sugerido,
  /*
   * A última mensagem saiu por onde? `celular` é a que alguém digitou no
   * aparelho, fora da plataforma. A lista precisa saber disso para não parecer
   * que a conversa está sem resposta quando ela foi respondida por fora.
   */
  ult.origem      as ultima_origem
from public.conversas cv
left join public.empresas   e  on e.id  = cv.empresa_id
left join public.contatos   ct on ct.id = cv.contato_id
left join public.vendedores v  on v.id  = cv.responsavel_vendedor_id
left join lateral (
  select m.preview, m.por_ia, m.triagem, m.origem
  from public.comunicacoes m
  where m.conversa_id = cv.id
  order by m.criado_em desc
  limit 1
) ult on true
left join lateral (
  select d.id, d.acao, d.conteudo_sugerido, d.justificativa, d.confianca
  from public.agente_decisoes d
  where d.conversa_id = cv.id and d.modo = 'sugestao'
    and not d.executada and not d.descartada
  order by d.criado_em desc
  limit 1
) sug on true
left join lateral (
  select f.nome_sugerido
  from public.conversas_nao_vinculadas f
  where f.canal = cv.canal
    and (f.identificador_externo = cv.identificador_externo
         or (cv.lid is not null and f.identificador_externo = cv.lid)
         or (cv.lid is not null and f.lid = cv.lid))
  order by f.ultima_mensagem_em desc
  limit 1
) nv on true;

revoke all on public.inbox_conversas from anon, authenticated;
grant select on public.inbox_conversas to authenticated;
