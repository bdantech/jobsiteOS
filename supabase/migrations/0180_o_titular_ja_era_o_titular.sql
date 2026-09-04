-- 0180 — O titular já era o titular.
--
-- Em 04/09/2026 a gestão organizou a carteira: 14 contas classificadas como passivas (que
-- pelo espelho da 0175 abriram `vendedor` junto) e 12 titularidades postas à mão em contas
-- de prospecção ativa. Todas nasceram com `desde` entre 13h33 e 13h58, porque é quando
-- foram gravadas.
--
-- Só que as 179 cessões de setembro converteram ANTES disso — a última às 21h36 do dia 3.
-- `titularesNaData` exige `desde <= convertida_em`, então o mês inteiro de trabalho ficava
-- sem dono, e a folha de setembro pagaria só o que convertesse depois das duas da tarde do
-- dia 4.
--
-- O registro é de hoje; a relação não é. Estas contas já eram dele quando aquelas cessões
-- converteram — o que aconteceu em 04/09 foi o sistema passar a saber, não a carteira
-- mudar de mãos. Datar pela hora do cadastro faria a comissão depender de quando alguém
-- abriu a tela.
--
-- `2026-09-01T03:00Z` é a meia-noite de São Paulo do dia 1º: exatamente o início da
-- competência corrente, e nem um minuto antes. Agosto está fechado e não é para ser
-- alcançado — se fosse, o trigger da 0175 recusaria de qualquer forma.
--
-- NÃO toca as titularidades de `originador`: as duas que existem foram datadas pela cessão
-- que as criou (§4 — quem trouxe o sacado leva o cedente na primeira NF que ele converte),
-- e essa data é a correta. Recuá-las daria ao originador cedentes que ele não trouxe.

update public.vendedor_carteira c
   set desde = timestamptz '2026-09-01 03:00:00+00'
 where c.papel = 'vendedor'
   and c.ate is null
   and c.desde > timestamptz '2026-09-01 03:00:00+00'
   and c.desde >= timestamptz '2026-09-04 00:00:00+00';
