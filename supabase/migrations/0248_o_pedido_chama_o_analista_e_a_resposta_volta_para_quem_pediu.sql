-- ═════════════════════════════════════════════════════════════════════════════
-- 0248 — O pedido chama o analista, e a resposta volta para quem pediu
--
-- ─── O QUE ESTAVA ACONTECENDO ───────────────────────────────────────────────
-- Uma análise pedida pela Company 360, pelo celular ou pela barra de IA emite
-- `analise.solicitada` — e **não havia regra nenhuma** para esse tipo. O evento entrava
-- na timeline da empresa e não acendia o sino de ninguém: o time de Crédito só descobria
-- o pedido abrindo a esteira e reparando numa coluna a mais.
--
-- Havia uma regra para `credito.analise_solicitada`, que é OUTRO evento — o que o
-- `app_solicitar_analise_da_venda` emite quando o pedido nasce no funil comercial (0129).
-- Ou seja: pedido vindo da venda avisava; pedido vindo de qualquer outro lugar, não. A
-- semelhança dos dois nomes é exatamente o tipo de coisa que esconde um buraco desses por
-- meses.
--
-- ─── POR QUE A REGRA, E NÃO SÓ CÓDIGO ───────────────────────────────────────
-- O sino tem de tocar em TODOS os caminhos, inclusive os que nunca passam por Node: o
-- app mobile chama `app_solicitar_analise` direto no Postgres, e a ferramenta de IA
-- também. Só o gatilho de fan-out alcança os três; um `notificar()` na server action
-- alcançaria um.
--
-- O push é a outra metade, e essa o Postgres não tem como fazer — não há chave VAPID nem
-- cliente Expo dentro do banco. Os caminhos que rodam no servidor chamam `enviarPush()`
-- depois, que manda só o push justamente porque o sino já veio daqui.
-- ═════════════════════════════════════════════════════════════════════════════

insert into public.notificacao_regras (tipo_evento, perfil_id, ativo)
select 'analise.solicitada', p.id, true
from public.perfis p
where p.nome = 'Crédito'
  and not exists (
    select 1 from public.notificacao_regras r
    where r.tipo_evento = 'analise.solicitada' and r.perfil_id = p.id
  );

-- ─── A decisão volta para quem pediu ────────────────────────────────────────
--
-- `analise.aprovada` / `.negada` / `.aprovada_parcial` já têm regra para o perfil Crédito,
-- e ela continua certa: é o time que trabalha a esteira.
--
-- Quem NÃO recebia nada era o vendedor que pediu a análise — e ele é a pessoa cuja
-- próxima ação depende da resposta. Isso não vira regra aqui porque não é uma assinatura
-- por papel: o destinatário sai do DADO (`analises_credito.solicitada_por`), muda a cada
-- linha, e nenhuma tabela de regras sabe expressá-lo. Quem resolve é `notificarNomeados()`
-- no worker e na web, que manda sino + push para o solicitante e só push para quem o
-- fan-out já alcançou.
--
-- Esta migração não mexe nessas três regras. Fica registrada aqui porque a pergunta
-- "por que o solicitante não está em `notificacao_regras`?" merece resposta no lugar onde
-- alguém vai procurá-la.
