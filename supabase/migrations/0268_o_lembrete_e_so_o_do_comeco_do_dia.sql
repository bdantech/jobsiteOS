-- ─────────────────────────────────────────────────────────────────────────────
-- 0268 — O lembrete é só o do começo do dia
--
-- Decisão de 25/09/2026: sai o lembrete de uma hora antes (H-1, "nossa conversa é
-- daqui a pouco"). Fica um lembrete só, a confirmação do dia (D-0), às 9h — ou às
-- 8h para a reunião das 9h. O job deixou de gerar o H-1; o template é DESATIVADO, e
-- não apagado, porque o ledger aponta para ele nas mensagens que já saíram.
-- ─────────────────────────────────────────────────────────────────────────────

update public.templates_mensagem
set ativo = false
where nome = 'Lembrete H-1';
