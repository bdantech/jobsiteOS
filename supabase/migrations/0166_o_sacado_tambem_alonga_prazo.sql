-- ============================================================================
-- 0166 — O lado sacado não é só antecipação: é também prazo.
--
-- A 0165 encurtou o rótulo para "Deixar meus fornecedores antecipar" e, ao fazê-lo,
-- jogou fora metade da proposta. Quem recebe a nota tem dois motivos para
-- estar ali: liberar o fornecedor para antecipar e ALONGAR o próprio prazo de
-- pagamento. São o mesmo produto visto da tesouraria, e é o segundo que costuma
-- fechar a conversa com uma construtora.
--
-- Só o rótulo muda. O `valor` continua `sacado` — o que a pessoa marca alimenta
-- `papelDaIntencao`, a tipagem na Antecipação e o alerta de divergência contra o
-- CNAE, e mexer nele reescreveria o papel de quem já respondeu.
-- ============================================================================

update public.formularios set
  pergunta_intencao = jsonb_set(
    pergunta_intencao,
    '{opcoes}',
    jsonb_build_array(
      jsonb_build_object(
        'valor', 'cedente',
        'label', 'Antecipar as notas que eu emito',
        'tag',   'Fornecedor'
      ),
      jsonb_build_object(
        'valor', 'sacado',
        'label', 'Deixar meus fornecedores anteciparem e/ou alongar meus prazos de pagamento',
        'tag',   'Construtora / Incorporadora'
      )
    )
  ),
  atualizado_em = now()
where pergunta_intencao is not null
  and pergunta_intencao -> 'opcoes' is not null;
