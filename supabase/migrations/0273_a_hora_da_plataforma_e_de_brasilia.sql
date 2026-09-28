-- 0273 — A hora da plataforma é de Brasília, e a NF vem sempre na frente.
--
-- 1. FUSO. Os endpoints de pré-autorizações e de títulos Sienge mandam timestamps
--    SEM fuso (`2026-09-28T14:17:00`), em hora de Brasília. Gravados crus, o
--    Postgres os leu como UTC: toda oferta aparecia criada três horas antes, e o
--    `expiresAt` de fim de dia (23:59:59) virava 20:59 daqui — o relógio vencia três
--    horas antes do que a plataforma diz. O código passou a carimbar `-03:00`
--    (`funil/instante.ts`); aqui as linhas já gravadas são refeitas A PARTIR DO RAW,
--    o valor que a plataforma mandou. Refazer do raw, e não somar três horas, é o que
--    torna isto idempotente: rodar duas vezes não desloca duas vezes.
--
--    Só o que casa com "data e hora sem fuso" é tocado. Os triggers destas tabelas
--    só olham `estagio_funil`, que não muda aqui.
--
-- 2. A PRIORIDADE NF × TÍTULO deixa de ser configurável: a hierarquia NF >
--    pré-autorização > título é fixa (`funil/dedup.ts`). A chave sai da config para
--    ninguém procurar o botão que não faz mais nada.

-- ── 1a. Pré-autorizações ─────────────────────────────────────────────────────

update public.pre_autorizacoes set
  criada_em = case
    when raw->>'createdAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$'
      then (raw->>'createdAt')::timestamp at time zone 'America/Sao_Paulo'
    else criada_em end,
  expira_em = case
    when raw->>'expiresAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$'
      then (raw->>'expiresAt')::timestamp at time zone 'America/Sao_Paulo'
    else expira_em end,
  solicitada_em = case
    when raw->>'requestedAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$'
      then (raw->>'requestedAt')::timestamp at time zone 'America/Sao_Paulo'
    else solicitada_em end
where raw->>'createdAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$'
   or raw->>'expiresAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$'
   or raw->>'requestedAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$';

-- ── 1b. Títulos Sienge ───────────────────────────────────────────────────────

update public.sienge_titulos set
  primeira_vez_visto = case
    when raw->>'firstSeenAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$'
      then (raw->>'firstSeenAt')::timestamp at time zone 'America/Sao_Paulo'
    else primeira_vez_visto end,
  hidratado_em = case
    when raw->>'hydratedAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$'
      then (raw->>'hydratedAt')::timestamp at time zone 'America/Sao_Paulo'
    else hidratado_em end,
  erp_pago_em = case
    when raw->>'erpPaidAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$'
      then (raw->>'erpPaidAt')::timestamp at time zone 'America/Sao_Paulo'
    else erp_pago_em end,
  erp_removido_em = case
    when raw->>'erpRemovedAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$'
      then (raw->>'erpRemovedAt')::timestamp at time zone 'America/Sao_Paulo'
    else erp_removido_em end,
  write_back_repointed_em = case
    when raw->'writeBack'->>'repointedAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$'
      then (raw->'writeBack'->>'repointedAt')::timestamp at time zone 'America/Sao_Paulo'
    else write_back_repointed_em end
where raw->>'firstSeenAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$'
   or raw->>'hydratedAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$'
   or raw->>'erpPaidAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$'
   or raw->>'erpRemovedAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$'
   or raw->'writeBack'->>'repointedAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$';

-- ── 2. A prioridade que não é mais config ────────────────────────────────────

update public.antecipacao_config
   set valor = valor - 'prioridade_nf_vs_titulo'
 where chave = 'funil_oportunidades'
   and valor ? 'prioridade_nf_vs_titulo';
