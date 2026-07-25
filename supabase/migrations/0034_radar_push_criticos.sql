-- 0034 — Radar: eventos críticos vão por notify() (sino + push), não pelo fan-out.
-- Remove as regras de notificacao_regras desses eventos para o sino não duplicar —
-- o worker chama notify() diretamente para orcamento.estourado e protesto.detectado.
delete from notificacao_regras
where tipo_evento in ('orcamento.estourado', 'protesto.detectado');
