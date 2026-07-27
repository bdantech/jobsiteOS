-- =============================================================================
-- 0051 — Antecipação: `nf.faixa_alterada` sai do fan-out
--
-- §7 pede push para o Comercial quando uma nota entra na faixa ALTA. Duas coisas
-- impedem que isso seja uma regra de notificacao_regras:
--
--   1. O gatilho de fan-out (0003/0014) casa apenas `tipo`, não o PAYLOAD. Uma
--      regra em `nf.faixa_alterada` dispararia para toda mudança de faixa —
--      incluindo sair da faixa e entrar em média — o que em um sync de 6× ao dia
--      é ruído suficiente para o time desligar as notificações.
--   2. O gatilho NÃO faz push. Ele grava `notificacoes` (o sino) e nada mais.
--      Push é Web Push + Expo, e isso mora no notify() de packages/core.
--
-- Então o worker chama notify() diretamente, só para as notas que ENTRARAM em
-- alta, com deep link para o card. E a regra de fan-out tem de sair — se ficasse,
-- o sino mostraria a mesma notícia duas vezes.
-- =============================================================================

delete from notificacao_regras
where tipo_evento = 'nf.faixa_alterada';

comment on table notificacao_regras is
  'Roteamento evento→perfil do sino. O gatilho de fan-out casa só `tipo`: eventos que precisam de filtro por payload (nf.faixa_alterada para faixa alta) ou de PUSH são notificados pelo worker via notify(), e por isso NÃO devem ter regra aqui — teriam sino em dobro.';
