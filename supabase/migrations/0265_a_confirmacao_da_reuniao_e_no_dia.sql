-- ─────────────────────────────────────────────────────────────────────────────
-- 0265 — A confirmação da reunião é no dia, não na véspera
--
-- O lembrete D-1 ("nossa conversa amanhã, 25/09. Segue de pé?") saiu da régua: a
-- confirmação passa a ser o D-0, entregue na abertura da janela do DIA da reunião.
-- A regra de quando mora no core (`tipoDeLembrete`) e o job segue no worker
-- (`lembretes-reuniao.ts`); aqui só o que é dado — o texto e o template aposentado.
--
-- O D-1 é DESATIVADO, e não apagado: o ledger aponta para ele (template_id) nas
-- mensagens que já saíram, e a pergunta "o que dizia o lembrete de agosto?" tem de
-- continuar tendo resposta.
-- ─────────────────────────────────────────────────────────────────────────────

update public.templates_mensagem
set corpo = $txt$Olá, {contato_nome}! Bom dia. Tudo bem?

Passando para confirmar nossa reunião de hoje às {hora_reuniao}.

Se surgir algum imprevisto, me avise o quanto antes para remarcarmos, combinado? Obrigado!$txt$,
    variaveis = array['contato_nome', 'hora_reuniao']
where nome = 'Lembrete D-0';

update public.templates_mensagem
set ativo = false
where nome = 'Lembrete D-1';
