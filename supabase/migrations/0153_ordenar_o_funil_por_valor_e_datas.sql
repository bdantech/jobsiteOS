-- ═════════════════════════════════════════════════════════════════════════════
-- 0153 — Os índices das ordenações novas do funil de NFs
--
-- O Kanban passou a ordenar por VALOR, EMISSÃO e VENCIMENTO além da receita
-- esperada, e a carregar coluna por coluna até o fim em vez de parar nas 40
-- primeiras. As duas coisas juntas mudam o perfil da consulta: antes havia uma
-- ordenação só, com índice (`notas_fiscais_receita_idx`), e uma página por
-- coluna; agora há quatro ordenações e páginas sucessivas com OFFSET crescente.
--
-- Medido antes: ordenar as encerradas (41.088 notas) por `emitida_em` custava
-- 101 ms com Seq Scan sobre 41 mil linhas e top-N heapsort — e o custo é por
-- PÁGINA, então rolar a coluna multiplica a varredura. A tabela cresce a cada
-- sincronização e nunca encolhe: o que hoje é aceitável é o que daqui a um ano
-- não é.
--
-- ─── POR QUE COMPOSTO, E NESTA ORDEM ────────────────────────────────────────
-- `estagio_funil` primeiro porque é o filtro fixo — cada coluna do Kanban é uma
-- consulta por estágio, sempre. Depois a coluna da ordenação, na MESMA direção
-- que a tela usa por padrão (DESC NULLS LAST: "do maior para o menor" foi o
-- pedido). Por último `access_key`, que é o desempate que a paginação por OFFSET
-- exige — sem ele duas notas de mesmo valor podem trocar de lugar entre a página
-- 1 e a 2, e o efeito visível é um card duplicado e outro que nunca aparece.
--
-- A direção do índice não impede a ordem inversa: o Postgres percorre um btree
-- para trás sem custo extra, então o botão "crescente" da tela usa o mesmo
-- índice.
--
-- `receita_esperada` NÃO ganha índice novo: `notas_fiscais_receita_idx` já
-- resolve o caso com Incremental Sort (16 ms medidos na coluna de 41 mil), e um
-- quarto índice para ganhar milissegundos custaria escrita em toda sincronização
-- de nota.
--
-- ─── O QUE MELHOROU, E O QUE NÃO ────────────────────────────────────────────
-- Medido depois, na mesma base:
--
--   "A prospectar" (12.512 notas) por valor, página 6:  53 ms → 3,9 ms
--   "Encerradas"   (41.088 notas) por emissão:         101 ms → 101 ms
--
-- A segunda não melhorou e isso é esperado: "Encerradas" é UMA coluna que
-- agrupa TRÊS estágios, e o `IN` de três valores impede a varredura ordenada
-- única — o planejador prefere ler tudo e fazer top-N. Forçar o índice
-- (`enable_seqscan = off`) dá 207 ms, o dobro: a escolha dele está certa.
--
-- Não se persegue esse caso. As colunas abertas são onde se trabalha, e são elas
-- que ficaram 13 vezes mais rápidas; "Encerradas" ordenada por emissão custa o
-- mesmo que já custava antes desta versão, e a ordenação padrão dela (receita)
-- continua em 16 ms.
-- ═════════════════════════════════════════════════════════════════════════════

create index if not exists notas_fiscais_estagio_valor_idx
  on public.notas_fiscais (estagio_funil, valor desc nulls last, access_key);

create index if not exists notas_fiscais_estagio_emissao_idx
  on public.notas_fiscais (estagio_funil, emitida_em desc nulls last, access_key);

create index if not exists notas_fiscais_estagio_vencimento_idx
  on public.notas_fiscais (estagio_funil, vencimento desc nulls last, access_key);

/*
 * `notas_fiscais_vencimento_idx` (vencimento sozinho) FICA. Ele não é redundante
 * com o composto acima: quem o usa é a varredura por prazo do job de expiração,
 * que não filtra por estágio e não conseguiria usar um índice cujo primeiro
 * campo é `estagio_funil`.
 */

comment on index public.notas_fiscais_estagio_valor_idx is
  'Ordenação do Kanban por valor dentro de uma coluna. `access_key` no fim é o desempate '
  'que a paginação por OFFSET exige — sem ele a página 2 pode repetir cards da 1.';
comment on index public.notas_fiscais_estagio_emissao_idx is
  'Ordenação do Kanban por data de emissão dentro de uma coluna.';
comment on index public.notas_fiscais_estagio_vencimento_idx is
  'Ordenação do Kanban por vencimento dentro de uma coluna.';
