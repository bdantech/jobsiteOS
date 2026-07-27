-- =============================================================================
-- 0053 — Antecipação: a config do sync passa a refletir o CONTRATO do endpoint
--
-- O seed de 0048 assumiu um endpoint que não é o que existe. O real oferece dois
-- filtros MUTUAMENTE EXCLUSIVOS (mandar os dois → 400):
--
--   sync_hours=N          notas SINCRONIZADAS nas últimas N horas. N ∈ [1, 4].
--   start_date/end_date   notas EMITIDAS no intervalo. Máximo de 10 dias.
--
-- Duas consequências que os valores antigos não sobreviveriam:
--
--   `sobreposicao_horas: 6` era um colchão de 6h "desde o último sync". Não
--   existe: o teto de `sync_hours` é 4. Vira `sync_horas_max`, que é o teto do
--   endpoint e não uma preferência — subir de 4 não amplia a janela, só faz o
--   endpoint responder 400.
--
--   `janela_inicial_dias: 60` era mandado numa requisição só. O intervalo por
--   emissão é limitado a 10 dias, então a primeira corrida receberia 400. Os 60
--   dias continuam, agora FATIADOS em blocos de `intervalo_max_dias`.
--
-- E `varredura_dias` é novo: a rede de segurança. `sync_hours` enxerga 4 horas
-- para trás e o cron roda de 4 em 4 — uma corrida que falhe abre um buraco que
-- nenhum incremental posterior alcança. O job diário revarre a janela de emissão
-- e o fecha em até 24h. É de graça porque o upsert é idempotente por access_key.
-- =============================================================================

update antecipacao_config
   set valor = jsonb_build_object(
     'sync_horas_max', 4,
     'intervalo_max_dias', 10,
     'page_size', 200,
     'janela_inicial_dias', 60,
     'varredura_dias', 30
   )
 where chave = 'sync';

comment on table antecipacao_config is
  'Settings do módulo. Em `sync`, `sync_horas_max` (4) e `intervalo_max_dias` (10) são LIMITES DO ENDPOINT, não preferências: acima disso a API responde 400.';
