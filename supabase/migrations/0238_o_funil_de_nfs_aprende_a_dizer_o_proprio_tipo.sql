-- 0238 — `notas_funil` aprende a dizer o próprio tipo
--
-- §6 pede `tipo` no catálogo de variáveis do filter engine, para permitir regra e
-- filtro por ORIGEM. O catálogo é uma whitelist de COLUNAS REAIS, e as regras que
-- ele compila rodam sobre DUAS superfícies: `notas_funil` (o motor de faixas das
-- NFs, que não muda) e `funil_oportunidades` (as fontes novas).
--
-- Adicionar `tipo` só na projeção quebraria a primeira: uma regra salva com essa
-- variável faria a reclassificação noturna estourar com "column does not exist",
-- à meia-noite, sobre o funil inteiro. A variável só pode existir se as duas
-- superfícies souberem respondê-la.
--
-- ── POR QUE ISTO NÃO VIOLA O §1 ─────────────────────────────────────────────
-- `notas_fiscais` não muda: nenhuma coluna, nenhum dado, nenhum comportamento. O
-- que ganha uma coluna é a VIEW de leitura, e a coluna é a constante `'nf'` — a
-- resposta que ela sempre teve e nunca precisou dizer em voz alta. Nada que lê
-- `notas_funil` hoje é afetado: a coluna entra no FIM da lista.
--
-- ── A CIRURGIA ─────────────────────────────────────────────────────────────
-- A definição é lida do banco VIVO e emendada num ponto único e verificado, em
-- vez de reescrita à mão. Reescrever uma view de 80 colunas para acrescentar uma
-- é como se perde uma das outras 79 sem ninguém notar.
do $$
declare
  v_def text;
  v_ancora constant text := 'FROM notas_fiscais nf';
begin
  select pg_get_viewdef('public.notas_funil'::regclass, true) into v_def;

  -- A âncora tem de ser ÚNICA. O `FROM notas_fiscais n2` do lateral que calcula
  -- `ultimo_numero_nf` é outro texto de propósito — se um dia os dois coincidirem,
  -- esta migração falha alto em vez de emendar no lugar errado.
  if (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora) <> 1 then
    raise exception 'Âncora % não aparece exatamente uma vez em notas_funil.', v_ancora;
  end if;

  v_def := replace(
    v_def,
    v_ancora,
    ', ''nf''::text AS tipo' || chr(10) || '   ' || v_ancora
  );

  execute 'create or replace view public.notas_funil as ' || v_def;
end $$;

-- `create or replace view` PERDE `security_invoker`, e sem ela a view ignora a RLS
-- das tabelas de base e entrega o funil inteiro a qualquer usuário logado. Toda
-- migração que recria uma view do funil reafirma isto — já custou caro uma vez.
alter view public.notas_funil set (security_invoker = on);
