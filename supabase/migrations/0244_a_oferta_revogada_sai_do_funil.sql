-- 0244 — A oferta revogada sai do funil
--
-- Expirar é o relógio: ninguém agiu, o fornecedor quase sempre nem viu a oferta, e
-- a construtora costuma reofertar. Um telefonema ainda vale, e por isso a expirada
-- continua entrando dentro da janela de recuperação.
--
-- Revogar é a CONSTRUTORA VOLTANDO ATRÁS. Ela tirou a oferta da mesa de propósito,
-- e não há o que recuperar do nosso lado: o crédito que existia deixou de existir
-- por decisão de quem o ofereceu. Pôr isso no funil é entregar ao originador um
-- card cujo desfecho já está decidido — e o custo não é só o tempo dele, é o funil
-- inteiro perder credibilidade quando uma parte dele é trabalho impossível.
--
-- A regra vive no core (`packages/core/src/funil/entrada.ts`, com teste). Esta
-- migração corrige o que o primeiro sync já tinha gravado antes dela: 83 ofertas,
-- R$ 3,1 milhões em cards mortos que alguém teria de descartar um a um.
--
-- Vai para `perdida` e não para `expirada` de propósito — o bloco de perdas (§9)
-- precisa distinguir "o relógio zerou" de "a construtora desistiu". E carrega o
-- motivo: sem ele o relatório vê uma perda sem causa.
update public.pre_autorizacoes
   set estagio_funil = 'perdida',
       estagio_alterado_em = now(),
       perda_motivo = coalesce(revoked_reason, 'Revogada pela construtora.')
 where status in ('REVOKED', 'AUTOMATICALLY_REVOKED')
   and estagio_funil not in ('perdida', 'convertida');
