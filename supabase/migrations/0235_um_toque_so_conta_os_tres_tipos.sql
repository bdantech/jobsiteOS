-- 0235 — O toque é um só, e agora ele conta os três tipos
--
-- O agrupamento da outbox sempre foi por FORNECEDOR, nunca por documento: ninguém
-- é abordado por nota. Com as duas fontes novas (04s §9), "as notas dele" passou a
-- ser "as oportunidades dele" — 2 NFs, 1 pré-autorização e 1 parcela do Sienge
-- viram UM toque, com o valor somado.
--
-- `access_keys` continua existindo e continua sendo o que sempre foi: a lista de
-- CHAVES DE ACESSO envolvidas. Ela não serve para as fontes novas, e forçá-la a
-- servir seria mentir sobre o que é uma chave de acesso — uma pré-autorização não
-- tem nenhuma, e a parcela tem a da nota que ela representa, quando tem.
--
-- Daí a coluna nova. `oportunidades` guarda o identificador do funil unificado
-- (`nf:<chave>`, `pre_autorizacao:<id>`, `titulo:<id>`), que é o que responde
-- "sobre o que exatamente foi esta mensagem?" quando alguém abre o histórico seis
-- meses depois. As duas convivem: quem já lê `access_keys` continua lendo.
alter table public.mensagens_outbox
  add column if not exists oportunidades text[];

comment on column public.mensagens_outbox.oportunidades is
  'Identificadores do funil unificado (04s) que esta mensagem agrupa: nf:<chave>, '
  'pre_autorizacao:<id>, titulo:<id>. `access_keys` continua sendo só as chaves de '
  'acesso, que as fontes novas nem sempre têm.';
