-- =============================================================================
-- 0050 — Antecipação: o sync de NFs registra execução em `mercado_ingestoes`
--
-- §3 pede a MESMA política de retry/alerta dos demais syncs, e essa política
-- inteira (abrir/concluir/falhar, notificar admins, tela de Ingestões, botão de
-- reexecutar) mora em torno de `mercado_ingestoes`. Uma tabela de log paralela
-- só para NFs daria dois lugares para responder "por que o funil está parado?".
--
-- Só falta a fonte existir no check constraint.
-- =============================================================================

alter table mercado_ingestoes drop constraint mercado_ingestoes_fonte_check;
alter table mercado_ingestoes add constraint mercado_ingestoes_fonte_check
  check (fonte in ('receita_cnpj', 'cno', 'lista', 'onepay_nf'));

comment on column mercado_ingestoes.fonte is
  'receita_cnpj | cno | lista | onepay_nf. A janela do sync de NFs é derivada daqui: buscamos desde o último `onepay_nf` concluído menos o colchão de sobreposição.';

-- Índice para a pergunta que o próprio sync faz a cada execução ("quando foi o
-- último sync bem-sucedido desta fonte?"), hoje um seq scan sobre a tabela toda.
create index mercado_ingestoes_fonte_status_idx
  on mercado_ingestoes (fonte, status, terminado_em desc);
