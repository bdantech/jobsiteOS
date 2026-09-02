-- ═════════════════════════════════════════════════════════════════════════════
-- 0158 — A varredura do Apollo parava antes de chegar na diretoria
--
-- `max_paginas_busca` era 3 (100 por página), com o comentário da 0030 dizendo
-- "acima disso é improvável achar sócio". Para construtora grande a premissa não
-- se sustenta: a MELNICK HERCULES tem ~980 funcionários, a busca leu 300 e parou —
-- menos de um terço da empresa, na ordem em que o Apollo devolveu, que não é por
-- senioridade. O resultado gravado foi "nenhuma pessoa nos cargos-alvo" com 300
-- pessoas vistas, e o job até loga o aviso de truncamento.
--
-- ─── SUBIR ISSO NÃO CUSTA DINHEIRO ──────────────────────────────────────────
-- O fluxo é: varre a empresa inteira (mixed_people/api_search, GRÁTIS) → seleciona
-- pelos cargos-alvo em memória → corta em `max_contatos_por_empresa` → e só o que
-- sobra do corte vai para o `bulk_match`, que é o passo que cobra. O corte continua
-- em 8. Ampliar a varredura muda quantas pessoas se OLHA, não quantas se paga.
--
-- O preço é tempo: 300ms de pacer entre páginas, então o pior caso sai de ~1s para
-- ~3s por empresa.
--
-- Esta migração existe porque o valor foi ajustado à mão em produção. Sem ela, um
-- ambiente novo nasceria com 3 de novo e o ajuste não estaria em lugar nenhum do
-- repositório. `jsonb_set` é idempotente: rodar de novo não muda nada.
-- ═════════════════════════════════════════════════════════════════════════════

update public.radar_config
   set valor = jsonb_set(valor, '{max_paginas_busca}', '10'::jsonb)
 where chave = 'cargos_alvo'
   and coalesce((valor ->> 'max_paginas_busca')::int, 0) < 10;
