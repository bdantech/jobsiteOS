-- ═════════════════════════════════════════════════════════════════════════════
-- 0218 — O comercial vê o preço que foi aprovado
--
-- ─── O QUE FALTAVA ──────────────────────────────────────────────────────────
-- A aba "Crédito e documentos" do card do funil já mostra a esteira e a pasta da
-- análise (0129). O que ela não mostrava era o PREÇO: juros, TAC, cashback, teto por
-- nota, prazo, validade. Aprovado o limite, quem fala com o cliente é o comercial — e
-- ele estava indo perguntar a alguém do Crédito quanto é que a gente cobra desta conta.
--
-- Pior que perguntar: enquanto a resposta não vinha, a conversa com o cliente
-- acontecia sobre a taxa PADRÃO, que é a única que o comercial sabia de cabeça. A
-- precificação por risco existe justamente para essa conta NÃO ser a padrão; uma
-- condição publicada que o vendedor não lê é uma matriz que não chega ao cliente.
--
-- ─── A MESMA PORTA ESTREITA DA 0129, E NÃO O MÓDULO ─────────────────────────
-- `app_ve_analise_pela_venda` é a régua que já libera a análise e os documentos: a
-- linha é visível porque está amarrada a uma VENDA que a pessoa é dona, não porque
-- ela virou usuária do Crédito. Esteira, scorecard, matriz e configurações continuam
-- fora — inclusive o editor de precificação, que é onde o preço se DECIDE.
--
-- Ler o preço da própria conta e decidir o preço de qualquer conta são coisas
-- diferentes, e é a segunda que o módulo guarda.
--
-- ─── POR QUE TODA A LINHA, E NÃO SÓ OS CAMPOS "SEGUROS" ─────────────────────
-- A tabela tem `sugestao` e `ajustes` — o que a matriz sugeriu e o que alguém mudou à
-- mão. Seria possível esconder os dois e mostrar só os números finais.
--
-- Não escondo: o vendedor que vai defender a taxa na frente do cliente é quem mais
-- precisa saber que ela foi ajustada e por quê. Esconder o ajuste faz o número
-- parecer tabelado — e um número tabelado não se defende, se repassa. O que não
-- aparece na tela dele é a MATRIZ inteira, que é outra coisa: essa continua no módulo.
-- ═════════════════════════════════════════════════════════════════════════════

drop policy if exists condicoes_comerciais_select_pela_venda on public.condicoes_comerciais;
create policy condicoes_comerciais_select_pela_venda on public.condicoes_comerciais
  for select using (
    -- `analise_credito_id` é a mesma chave que a política de `analise_docs` usa. Uma
    -- condição sem análise (não existe hoje) não seria visível por aqui, e é o certo:
    -- sem análise não há venda a que ela pertença.
    (select public.app_ve_analise_pela_venda(analise_credito_id))
  );

comment on policy condicoes_comerciais_select_pela_venda on public.condicoes_comerciais is
  'O dono da venda lê o preço da conta dele (0218), pela mesma porta estreita que já lhe '
  'dá a análise e os documentos (0129). Decidir preço continua sendo do módulo Crédito.';
