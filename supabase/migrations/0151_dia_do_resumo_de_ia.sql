-- ═════════════════════════════════════════════════════════════════════════════
-- 0151 — O dia em que os resumos de IA são regerados
--
-- O sync passou a regerar os resumos de IA dos processos que ficaram velhos. Um
-- dia da semana, e não todos: o resumo custa token POR PROCESSO, e ele muda
-- quando chega movimentação — não quando o relógio vira. Cinco vezes por semana
-- seria pagar cinco vezes pelo mesmo texto.
--
-- A escolha vive em `juridico_config.monitoramento`, junto dos dias de sync, pela
-- mesma razão que os dias de sync vivem lá: é a setting que decide o custo, e
-- mudá-la não pode exigir deploy. Sexta por padrão, que é quando alguém olha a
-- carteira para planejar a semana seguinte.
--
-- `null` desliga o automático; o botão de cada processo continua funcionando.
-- ═════════════════════════════════════════════════════════════════════════════

update public.juridico_config
   set valor = valor || jsonb_build_object('dia_resumo_ia', 5)
 where chave = 'monitoramento'
   and not (valor ? 'dia_resumo_ia');
