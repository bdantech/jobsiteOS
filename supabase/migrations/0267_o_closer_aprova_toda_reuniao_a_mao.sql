-- ─────────────────────────────────────────────────────────────────────────────
-- 0267 — O closer aprova toda reunião à mão
--
-- A fila de aceite (04k §5) virava ACEITA a reunião que o closer não decidia dentro
-- do SLA (`sdr_sla_recusa_horas`, 48h): 8 das 36 aceitas até hoje foram "por prazo".
-- Decisão de 25/09/2026: ninguém aceita no lugar do closer.
--
-- O aceite por prazo virou o parâmetro `sdr_aceite_por_prazo` (BOOL) — o job só
-- expira como aceita com ele em 1, e AUSENTE conta como desligado. Esta migração
-- publica o 0 para a tela de parâmetros mostrar "desligado", e não "sem valor".
-- O SLA continua existindo: é o prazo que a fila mostra ao closer.
--
-- As 8 já aceitas por prazo ficam como estão (a comissão delas já foi lançada).
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.commission_params (chave, vendedor_id, valor, unidade, vigente_de)
select 'sdr_aceite_por_prazo', null, 0, 'BOOL', current_date
where not exists (
  select 1 from public.commission_params where chave = 'sdr_aceite_por_prazo'
);
