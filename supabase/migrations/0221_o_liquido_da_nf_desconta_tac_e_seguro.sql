-- ═════════════════════════════════════════════════════════════════════════════
-- 0221 — O líquido da NF desconta a TAC e o seguro
--
-- ─── O NÚMERO ESTAVA ALTO, E ELE É DITO EM VOZ ALTA ─────────────────────────
-- O card do funil de NFs mostra "Líquido estimado" — o que o fornecedor recebe se
-- antecipar hoje. A conta era `valor − receita_esperada`, e `receita_esperada` é
-- só o JUROS. Faltavam a TAC e o seguro.
--
-- Esse é o pior número para errar para cima: é o que o comercial fala na ligação.
-- Prometer R$ 80.900 e depositar R$ 80.546 não é arredondamento, é uma promessa
-- que a plataforma não cumpre.
--
-- ─── A COMPOSIÇÃO SAIU DAS OPERAÇÕES REAIS, NÃO DE UM COMBINADO ─────────────
-- `antecipacoes` guarda o que a plataforma efetivamente pagou. Sobre ela:
--
--   net_value = gross_value − total_spread − 125,00
--
-- Em 1.022 operações a diferença além do spread é exatamente 0,00; em 55 ela é
-- exatamente 125,00 — e essas 55 são TODAS de 15/09/2026 em diante, sem uma única
-- exceção antes. O seguro é tarifa nova e vale daqui para frente.
--
-- E o seguro é POR NOTA: o documento 251 foi antecipado em cinco parcelas
-- (251/1 a 251/5) e cada uma debitou os seus R$ 125.
--
-- A TAC está DENTRO de `total_spread`, junto do juros. Isolando-a numa amostra
-- homogênea (3,0% a.m., 31 dias, 57 operações), a regressão do spread contra o
-- valor da nota devolve r² = 0,995 e uma parcela fixa de R$ 226,20 — dentro da
-- faixa 150–300 da matriz de precificação, e longe de ser zero.
--
-- ─── DE ONDE VEM A TAC DE UMA NOTA ──────────────────────────────────────────
-- Da condição comercial publicada do SACADO quando ela existe — é o risco dele
-- que precifica, mesma lógica da taxa. Sem condição publicada, a régua da matriz
-- pelos padrões da config. A régua é a mesma de sempre (`calcularTac`, 04o §4):
--
--   tac = tac_min + (tac_max − tac_min) × min(valor / limiar, 1)
--
-- Nota pequena paga a proporcional, nota acima do limiar paga a cheia. Hoje UMA
-- empresa tem condição publicada; o resto cai no padrão e migra sozinho conforme
-- o Crédito publica as demais.
--
-- ─── POR QUE GRAVAR, E NÃO CALCULAR NA VIEW ─────────────────────────────────
-- Mesmo motivo de `taxa_usada` existir: a TAC de ontem tem de continuar
-- auditável depois que a matriz mudar. Uma view que recalcula reescreve o
-- passado toda vez que alguém edita a precificação.
--
-- O SEGURO também é gravado, e é redundante de propósito: é o registro de quanto
-- se cobrou naquela nota, não de quanto se cobra hoje.
--
-- ─── A INVARIANTE MUDOU ─────────────────────────────────────────────────────
-- Antes: `valor = receita_esperada + líquido`.
-- Agora: `valor = juros + tac + seguro + líquido`.
-- A receita da casa é juros + TAC; o seguro é repasse. Manter a invariante velha
-- exigiria esconder uma parcela — e foi a parcela escondida que gerou o erro.
-- ═════════════════════════════════════════════════════════════════════════════

alter table public.notas_fiscais
  add column if not exists tac_estimada numeric,
  add column if not exists seguro_estimado numeric;

comment on column public.notas_fiscais.tac_estimada is
  'TAC da nota (0221), pela condição publicada do sacado ou pela régua da matriz. '
  'Gravada, e não calculada na leitura, para que a estimativa de ontem continue '
  'auditável depois que a precificação mudar — mesma razão de `taxa_usada`.';

comment on column public.notas_fiscais.seguro_estimado is
  'Seguro da operação, POR NOTA (0221). Redundante com a config de propósito: é o '
  'registro de quanto se cobrou nesta nota, não de quanto se cobra hoje.';

-- O padrão do seguro e da TAC entram na config de economia, junto da taxa.
-- `jsonb_set` em vez de sobrescrever: `taxa_mensal_padrao` já está calibrado.
update public.antecipacao_config
   set valor = valor
     || jsonb_build_object('seguro_por_nota', 125)
     || jsonb_build_object('tac_min_padrao', 150)
     || jsonb_build_object('tac_max_padrao', 300)
     || jsonb_build_object('tac_limiar_padrao', 10000)
 where chave = 'economia';

insert into public.antecipacao_config (chave, valor)
select 'economia', jsonb_build_object(
         'taxa_mensal_padrao', 2.6, 'seguro_por_nota', 125,
         'tac_min_padrao', 150, 'tac_max_padrao', 300, 'tac_limiar_padrao', 10000)
where not exists (select 1 from public.antecipacao_config where chave = 'economia');

-- ─── A view ganha as parcelas e o líquido ───────────────────────────────────
--
-- `create or replace view` acrescenta colunas no FIM da lista, e é o que isto faz:
-- a definição VIVA é lida e as colunas novas entram logo antes do `FROM`. Recolar
-- a definição de um arquivo antigo perderia as colunas que migrações posteriores
-- acrescentaram — e esta view já foi estendida cinco vezes.
--
-- O líquido é derivado AQUI, e não no cliente, porque web e mobile mostravam o
-- mesmo card com a mesma conta duplicada. Uma conta só, num lugar só.

do $$
declare
  v_def text;
  v_ancora text := E'\n   FROM notas_fiscais nf';
  v_novas text;
begin
  select pg_get_viewdef('public.notas_funil'::regclass, true) into v_def;
  if position(v_ancora in v_def) = 0 then
    raise exception 'A âncora do FROM mudou em notas_funil — revise a 0221 à mão.';
  end if;

  v_novas :=
    ',' || E'\n' ||
    '    nf.tac_estimada,' || E'\n' ||
    '    nf.seguro_estimado,' || E'\n' ||
    '    GREATEST(0::numeric, nf.valor' || E'\n' ||
    '      - COALESCE(nf.receita_esperada, 0::numeric)' || E'\n' ||
    '      - COALESCE(nf.tac_estimada, 0::numeric)' || E'\n' ||
    '      - COALESCE(nf.seguro_estimado, 0::numeric)) AS liquido_estimado';

  execute 'create or replace view public.notas_funil as '
       || overlay(v_def placing v_novas || v_ancora
                  from position(v_ancora in v_def) for length(v_ancora));
end $$;

comment on view public.notas_funil is
  'O funil de NFs. `liquido_estimado` desconta juros, TAC e seguro (0221) — antes '
  'descontava só o juros, e o número ia alto justamente na tela de onde ele sai '
  'para a ligação. Nulo em `receita_esperada` NÃO anula o líquido aqui: quem trata '
  '"não sei" é o core, que devolve nulo e faz a tela mostrar um traço.';

-- ─── Backfill: as notas que já estão na esteira ─────────────────────────────
--
-- Sem isto o líquido continuaria errado até a próxima varredura tocar cada nota —
-- e o sync só reprocessa a janela recente. A régua aqui é a MESMA de
-- `calcularTac` no core, escrita em SQL uma vez; daqui para frente quem grava é o
-- worker, que é onde ela vive.
--
-- Só notas VIVAS: reescrever a estimativa de uma nota já convertida mudaria o
-- retrato de uma decisão que já foi tomada, e o valor real dessa está em
-- `antecipacoes.net_value`.

with regua as (
  select
    coalesce((c.valor ->> 'tac_min_padrao')::numeric, 150) as tac_min,
    coalesce((c.valor ->> 'tac_max_padrao')::numeric, 300) as tac_max,
    coalesce((c.valor ->> 'tac_limiar_padrao')::numeric, 10000) as limiar,
    coalesce((c.valor ->> 'seguro_por_nota')::numeric, 125) as seguro
  from public.antecipacao_config c where c.chave = 'economia'
),
-- A resolução vive num SELECT, e não no `from` do UPDATE: o `left join lateral`
-- de um UPDATE não enxerga a tabela-alvo, e a condição publicada precisa ser
-- correlacionada com o sacado de CADA nota.
alvo as (
  select nf.access_key, nf.valor, r.limiar, r.seguro,
         coalesce(cc.fee_min_d0, r.tac_min) as tac_min,
         coalesce(cc.fee_d0, r.tac_max) as tac_max
  from public.notas_fiscais nf
  cross join regua r
  left join lateral (
    select c2.fee_d0, c2.fee_min_d0
    from public.condicoes_comerciais c2
    where c2.cnpj = nf.sacado_cnpj and c2.status = 'publicada'
      and c2.fee_d0 is not null and c2.fee_min_d0 is not null
    order by c2.publicada_em desc nulls last
    limit 1
  ) cc on true
  where nf.tac_estimada is null
    and nf.valor is not null
    and nf.conversao_antecipacao_id is null
)
update public.notas_fiscais nf
   -- `calcularTac`, em SQL: min + (max − min) × min(valor/limiar, 1).
   set tac_estimada = round(
         a.tac_min + (a.tac_max - a.tac_min) * least(a.valor / nullif(a.limiar, 0), 1), 2),
       seguro_estimado = a.seguro
  from alvo a
 where a.access_key = nf.access_key;
