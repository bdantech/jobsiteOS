-- =============================================================================
-- 0052 — Antecipação: o ponteiro do token de WhatsApp deixa de ser legível
--
-- 0046 tentou esconder `whatsapp_contas.token_secret_id` com
--
--   grant select, insert, update, delete on whatsapp_contas to authenticated;
--   revoke select (token_secret_id) on whatsapp_contas from authenticated;
--
-- e isso NÃO funciona. No Postgres, um privilégio de tabela cobre todas as
-- colunas, e revogar a coluna depois não o corta: `has_column_privilege` continua
-- respondendo true. O REVOKE por coluna só tem efeito sobre um GRANT por coluna.
--
-- A correção é inverter: revogar o SELECT da TABELA e concedê-lo COLUNA A COLUNA,
-- deixando `token_secret_id` de fora. As leituras do app já pedem colunas
-- explícitas (`COLUNAS_CONTA` em components/antecipacao/queries.ts), então nada
-- quebra — e um `select *` passa a falhar, que é exatamente o comportamento
-- desejado para uma tabela com uma coluna secreta.
--
-- O ponteiro sozinho não abre o segredo (o valor mora no Vault, e
-- `vault.decrypted_secrets` não é legível por `authenticated`). Mas um id de
-- segredo não tem por que trafegar até o browser, e um comentário de migration
-- afirmando que ele não trafega precisa ser verdade.
-- =============================================================================

revoke select on whatsapp_contas from authenticated;

grant select (
  id, apelido, numero, provedor, token_definido_em,
  usuario_responsavel, ativo, criada_em, atualizada_em
) on whatsapp_contas to authenticated;

-- insert/update/delete continuam de tabela: a policy `whatsapp_contas_admin` já
-- os restringe a app_is_admin(), e escrever o ponteiro à mão não revela nada —
-- quem grava o segredo de verdade é o RPC app_salvar_whatsapp_conta.

comment on column whatsapp_contas.token_secret_id is
  'Id do segredo no Supabase Vault (pgsodium). NÃO tem grant de select para `authenticated` — nem por PostgREST direto. A UI só sabe SE existe e QUANDO foi definido (token_definido_em); substituir grava um novo segredo.';
