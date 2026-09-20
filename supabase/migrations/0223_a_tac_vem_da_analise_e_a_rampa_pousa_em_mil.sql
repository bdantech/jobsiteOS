-- 0223 — A TAC vem da análise de crédito, e a rampa pousa em mil reais.
--
-- Duas correções sobre a 0221, as duas apontadas pela mesa depois de ver o número.
--
-- ─── 1. A FONTE DA TAC ESTAVA ERRADA ────────────────────────────────────────
-- A 0221 leu a tarifa de `condicoes_comerciais` — a nossa tabela, o que o Crédito
-- publicou. Parece a fonte óbvia e é a fonte quase vazia: condição publicada só
-- existe para as empresas NOVAS que estamos mandando agora. A base que já operava
-- antes desta tela existir não tem nenhuma, e todas elas caíram na régua padrão da
-- config (300/150) como se ninguém tivesse preço próprio.
--
-- A tarifa real dessas empresas chega pelo sync da análise de crédito, em
-- `analises_plataforma.fee_d0` / `min_fee_d0` — 245 CNPJs contra 1, e é ela que a
-- plataforma debita de fato. Os valores lá dentro desmentem a régua padrão com
-- folga: KINAROS cobra 500/100, COSAMPA 400/200, CONSTRUPOWER 25/25, PLANOVA
-- 150/75. Nenhum desses é 300/150.
--
-- Quando as duas existem, vale a da plataforma: quem cobra é ela. Uma condição
-- recém-publicada que ela ainda não ingeriu fica atrás por uma janela de sync, e é
-- melhor errar para o que SERÁ cobrado hoje do que para o que passará a valer
-- quando o outro lado processar.
--
-- ─── 2. A RAMPA NÃO COMEÇAVA ONDE DEVIA ─────────────────────────────────────
-- A conta da 0221 era `min + (max − min) × min(valor / limiar, 1)`: uma reta que
-- sai do ZERO. Com ela o `fee_min` era o nome de um número que nunca acontecia —
-- a nota de mil reais pagava 165, a de cem pagava 151,50, e só uma nota de valor
-- zero chegaria aos 150.
--
-- A régua real, confirmada pela mesa: a TAC máxima vale da NF de R$ 10.000 para
-- cima; abaixo disso ela DECRESCE em linha reta até a mínima, que é atingida na
-- nota de R$ 1.000 ou menor. A rampa tem dois pontos de parada, não um:
--
--     TAC = min + (max − min) × clamp((valor − piso) ÷ (limiar − piso), 0, 1)
--
-- Com max 300, min 150, piso 1.000 e limiar 10.000: NF de 10.000+ paga 300, de
-- 5.500 paga 225, de 1.000 ou menos paga 150.

-- ─── O piso entra na config e na matriz ─────────────────────────────────────

update public.antecipacao_config
   set valor = valor || jsonb_build_object('tac_piso_padrao', 1000)
 where chave = 'economia';

-- Em TODAS as versões da matriz, e não só na ativa: o piso não é preço novo, é uma
-- regra que sempre valeu e que a matriz nunca registrou. Gravá-lo só na ativa faria
-- a simulação de uma condição antiga mostrar uma tarifa que jamais foi cobrada.
update public.precificacao_matriz
   set definicao = jsonb_set(
         definicao, '{faixas,piso_proporcionalidade_tac}', to_jsonb(1000), true)
 where not coalesce(definicao -> 'faixas' ? 'piso_proporcionalidade_tac', false);

-- ─── Rebackfill ─────────────────────────────────────────────────────────────
--
-- Diferente da 0221, aqui NÃO há `where tac_estimada is null`: as notas que a 0221
-- preencheu são justamente as que estão erradas, nas duas pontas. Reescrever é o
-- ponto.
--
-- Só notas VIVAS: mexer na estimativa de uma nota já convertida mudaria o retrato
-- de uma decisão já tomada, e o valor real dessa está em `antecipacoes.net_value`.

with regua as (
  select
    coalesce((c.valor ->> 'tac_min_padrao')::numeric, 150) as tac_min,
    coalesce((c.valor ->> 'tac_max_padrao')::numeric, 300) as tac_max,
    coalesce((c.valor ->> 'tac_limiar_padrao')::numeric, 10000) as limiar,
    coalesce((c.valor ->> 'tac_piso_padrao')::numeric, 1000) as piso,
    coalesce((c.valor ->> 'seguro_por_nota')::numeric, 125) as seguro
  from public.antecipacao_config c where c.chave = 'economia'
),
-- A resolução vive num SELECT, e não no `from` do UPDATE: o `left join lateral` de
-- um UPDATE não enxerga a tabela-alvo, e a tarifa precisa ser correlacionada com o
-- sacado de CADA nota.
alvo as (
  select nf.access_key, nf.valor, r.limiar, r.piso, r.seguro,
         -- Plataforma primeiro, condição publicada depois, régua padrão por último.
         coalesce(ap.min_fee_d0, cc.fee_min_d0, r.tac_min) as tac_min,
         coalesce(ap.fee_d0,     cc.fee_d0,     r.tac_max) as tac_max
  from public.notas_fiscais nf
  cross join regua r
  left join lateral (
    select a2.fee_d0, a2.min_fee_d0
    from public.analises_plataforma a2
    where a2.cnpj = nf.sacado_cnpj
      and a2.fee_d0 is not null and a2.min_fee_d0 is not null
    order by a2.sincronizada_em desc nulls last
    limit 1
  ) ap on true
  left join lateral (
    select c2.fee_d0, c2.fee_min_d0
    from public.condicoes_comerciais c2
    where c2.cnpj = nf.sacado_cnpj and c2.status = 'publicada'
      and c2.fee_d0 is not null and c2.fee_min_d0 is not null
    order by c2.publicada_em desc nulls last
    limit 1
  ) cc on true
  where nf.valor is not null
    and nf.conversao_antecipacao_id is null
)
update public.notas_fiscais nf
   -- `calcularTac`, em SQL. O `greatest(..., 0)` guarda a nota abaixo do piso: sem
   -- ele a proporção ficaria negativa e a tarifa cairia ABAIXO da mínima.
   set tac_estimada = round(
         a.tac_min + (a.tac_max - a.tac_min) * greatest(
           least((a.valor - a.piso) / nullif(a.limiar - a.piso, 0), 1), 0), 2),
       seguro_estimado = a.seguro
  from alvo a
 where a.access_key = nf.access_key;

comment on column public.notas_fiscais.tac_estimada is
  'TAC da nota (0221, fonte corrigida na 0223). Vem da tarifa do SACADO: primeiro '
  '`analises_plataforma` (o que a plataforma cobra de fato), depois a condição '
  'publicada, e só então a régua padrão da config. Gravada, e não calculada na '
  'leitura, para que a estimativa de ontem continue auditável depois que a '
  'precificação mudar — mesma razão de `taxa_usada`.';
