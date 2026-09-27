-- ============================================================================
-- 0269j — Cobrança: campanha exclui o grupo em cobrança (07 §11)
--
-- O motor de exclusão (packages/core/src/campanhas/exclusao.ts) ganhou o motivo
-- `em_cobranca`, logo depois de `processo_juridico`. Sem ele no CHECK, o primeiro
-- destinatário excluído por cobrança derrubaria a materialização da campanha inteira.
--
-- A lista abaixo foi lida de pg_constraint em 26/09/2026, não da 0147: é o estado vivo
-- mais o motivo novo, para não apagar o que migrações posteriores tivessem acrescentado.
-- ============================================================================

alter table public.campanha_destinatarios drop constraint campanha_dest_motivo_check;
alter table public.campanha_destinatarios add constraint campanha_dest_motivo_check
  check (motivo_exclusao is null or motivo_exclusao = any (array[
    'suprimido', 'sem_contato', 'contatado_recente', 'conversa_aberta', 'sem_base_legal',
    'teto_diario', 'duplicado', 'processo_juridico', 'em_cobranca', 'passivo',
    'outra_campanha', 'frequencia_90d', 'cancelada']));
