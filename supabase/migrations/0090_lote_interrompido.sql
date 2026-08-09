-- ─────────────────────────────────────────────────────────────────────────────
-- Um lote que parou no meio não é um lote concluído
--
-- O executor lia os itens pendentes com um `.select()` sem paginação. O PostgREST
-- corta a resposta em `db-max-rows` (mil, no padrão do Supabase) e NÃO AVISA: não há
-- erro, não há flag, a resposta simplesmente vem menor. O lote "Domínio em 100% do
-- SOM" tinha 1.614 itens, processou exatamente 1.000, marcou-se como CONCLUÍDO e
-- deixou 614 pendentes.
--
-- O corte já era ruim; o rótulo era pior. Um número errado alguém confere — um lote
-- marcado como concluído ninguém volta a olhar, e a tela não oferece "Executar" para
-- lote concluído, então os 614 ficaram inalcançáveis.
--
-- A paginação foi corrigida no worker (apps/worker/src/paginar.ts). Aqui entra o
-- estado que faltava para o caso legítimo de parada no meio — o teto de orçamento, que
-- corta de propósito — e que agora também descreve o lote do SOM.
--
-- O CHECK abaixo é a lista LIDA do banco (pg_get_constraintdef) mais o valor novo.
-- Reescrever a lista a partir da migração original já apagou valor aqui antes.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.lotes_enriquecimento drop constraint lotes_status_check;

alter table public.lotes_enriquecimento add constraint lotes_status_check
  check (status in ('rascunho', 'aguardando_aprovacao', 'aprovado', 'executando',
                    'concluido', 'cancelado', 'falhou', 'interrompido'));

comment on column public.lotes_enriquecimento.status is
  'rascunho → aguardando_aprovacao → aprovado → executando → concluido. '
  '`interrompido` é execução parcial (teto de orçamento, ou corte de paginação): '
  'sobraram itens pendentes e a tela oferece executar de novo, retomando de onde parou.';

-- O lote do SOM: concluído no papel, 614 pendentes no banco. Vira interrompido para
-- reaparecer como executável. Vale para qualquer outro lote no mesmo estado.
update public.lotes_enriquecimento l set
  status = 'interrompido',
  concluido_em = null
where l.status = 'concluido'
  and exists (select 1 from public.lote_itens i where i.lote_id = l.id and i.status = 'pendente');

-- `total_itens` guardava a ESTIMATIVA da tela, feita antes de o TTL entrar na conta —
-- por isso "1617" para 1.614 itens materializados. O executor passa a gravar o número
-- real; isto acerta o que já existe.
update public.lotes_enriquecimento l set
  total_itens = c.n
from (select lote_id, count(*)::int as n from public.lote_itens group by 1) c
where c.lote_id = l.id and l.total_itens is distinct from c.n;
