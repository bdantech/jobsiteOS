-- ============================================================================
-- 0172 — O `sessionId` legado é um número nosso, e dá para provar qual
--
-- Sobraram 10 conversas sem dono depois da 0171, e todas têm a mesma marca: o
-- `conta_remetente` das mensagens não é um telefone, é o `sessionId` do provedor
-- (49 dígitos). Foi assim que o webhook gravou até 02/09, quando o repasse passou
-- a identificar a conta. Como toda atribuição por número faz join por
-- `whatsapp_contas.numero`, essas linhas ficam fora de tudo: sem dono na
-- conversa, sem autor na mensagem, fora do painel de atividade e fora do filtro
-- por vendedor.
--
-- ─── A EQUIVALÊNCIA NÃO É CHUTE, É DEDUÇÃO ──────────────────────────────────
-- Onze conversas têm mensagens gravadas com o `sessionId` E com um número de
-- conta. Uma thread é a conversa com UMA pessoa do outro lado; se as duas
-- gravações aparecem nela, as duas vieram da mesma sessão. E o número que
-- coocorre é sempre o mesmo — um só, em todas as onze.
--
-- Por isso a regra abaixo é escrita como consulta e não como um `update ... set
-- conta_remetente = '5511...'`: ela SÓ age quando a dedução é única (`having
-- count(distinct ...) = 1`). Se um dia um segundo número aparecer na mesma
-- sessão, a migração não faz nada em vez de escolher errado em silêncio — e a
-- conversa continua sem dono, que é o estado honesto.
--
-- Reescrever a coluna, e não só derivar a posse: `conta_remetente` significa "a
-- nossa conta por onde isto passou", e o `sessionId` é o apelido do provedor para
-- essa mesma conta. Mantê-lo deixaria uma segunda grafia do mesmo fato no banco,
-- e a próxima consulta que agrupasse por número erraria de novo.
-- ============================================================================

-- A FILA VEM PRIMEIRO, e a ordem é a única coisa delicada aqui: a dedução se
-- apoia nas linhas de `comunicacoes` que ainda carregam o `sessionId`. Reescrevê-las
-- antes apagaria a evidência de que a fila depende, e a segunda atualização não
-- encontraria mais nada — silenciosamente, sem erro nenhum.
-- A reescrita na fila de identificação, que guarda a conta que recebeu.
with equivalencia as (
  select
    legado.sessao,
    min(w.numero) as numero
  from (
    select distinct nv.conta_recebedora as sessao
    from public.conversas_nao_vinculadas nv
    where nv.conta_recebedora is not null
      and not exists (select 1 from public.whatsapp_contas w where w.numero = nv.conta_recebedora)
  ) legado
  join public.comunicacoes c1 on c1.conta_remetente = legado.sessao and c1.conversa_id is not null
  join public.comunicacoes c2 on c2.conversa_id = c1.conversa_id
  join public.whatsapp_contas w on w.numero = c2.conta_remetente
  group by legado.sessao
  having count(distinct w.numero) = 1
)
update public.conversas_nao_vinculadas nv
set conta_recebedora = e.numero
from equivalencia e
where nv.conta_recebedora = e.sessao;

with equivalencia as (
  select
    legado.sessao,
    min(w.numero) as numero
  from (
    select distinct c.conta_remetente as sessao
    from public.comunicacoes c
    where c.conta_remetente is not null
      and not exists (select 1 from public.whatsapp_contas w where w.numero = c.conta_remetente)
  ) legado
  join public.comunicacoes c1 on c1.conta_remetente = legado.sessao and c1.conversa_id is not null
  join public.comunicacoes c2 on c2.conversa_id = c1.conversa_id
  join public.whatsapp_contas w on w.numero = c2.conta_remetente
  group by legado.sessao
  having count(distinct w.numero) = 1
)
update public.comunicacoes c
set conta_remetente = e.numero
from equivalencia e
where c.conta_remetente = e.sessao;

-- ─── E as três atribuições rodam de novo sobre o que acabou de ser corrigido ──
-- São as mesmas regras da 0169 e da 0171. Repeti-las aqui é mais barato que
-- pedir que alguém lembre de reexecutar duas migrações antigas na ordem certa.

update public.comunicacoes c
set vendedor_id = v.id
from public.whatsapp_contas w
join public.vendedores v on v.usuario_id = w.usuario_responsavel and v.ativo
where c.vendedor_id is null
  and c.conta_remetente = w.numero;

with dono as (
  select distinct on (c.conversa_id) c.conversa_id, v.id as vendedor_id
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
where dono.conversa_id = cv.id and cv.responsavel_vendedor_id is null;

with dono as (
  select distinct on (nv.id) nv.id, v.id as vendedor_id
  from public.conversas_nao_vinculadas nv
  join public.whatsapp_contas w on w.numero = nv.conta_recebedora
  join public.vendedores v on v.usuario_id = w.usuario_responsavel and v.ativo
  where nv.vendedor_sugerido_id is null
  order by nv.id, v.id
)
update public.conversas_nao_vinculadas nv
set vendedor_sugerido_id = dono.vendedor_id
from dono
where dono.id = nv.id and nv.vendedor_sugerido_id is null;
