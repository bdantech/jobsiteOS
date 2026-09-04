-- 0178 — A cessão é a antecipação, não a nota.
--
-- `comissao_lancamentos_v2.origem_id` guardava a `access_key` da NF, e a unicidade é
-- `(papel, origem_tipo, origem_id, vendedor_id)`. Isso quebrava de dois jeitos, e os dois
-- em silêncio:
--
--   NF CEDIDA EM PARCELAS. Uma nota pode ser antecipada em várias operações — cada uma
--   com valor e prazo próprios, cada uma imobilizando capital próprio. Contra a mesma
--   chave, a segunda em diante entrava como reprocesso e o `ignoreDuplicates` a
--   descartava. Medido em 04/09/2026: 10 NFs, 39 antecipações, R$ 456.369 cedidos dos
--   quais o motor enxergava R$ 117.199. Em VOP — que é a unidade que paga — 74% sumia.
--
--   CESSÃO SEM NOTA. Uma antecipação sem NF casada não tinha chave nenhuma. O fallback
--   `antecipacao:<id>` existia no código e nunca era alcançado, porque o backfill exigia
--   `access_key_casada is not null` e o handler live só rodava dentro da conversão da
--   nota.
--
-- `id_externo` é o id da plataforma para a operação: estável, único por cessão, e existe
-- sempre — inclusive quando o cedente nunca subiu certificado.
--
-- A reescrita abaixo é obrigatória e não cosmética: sem ela o backfill procuraria por
-- `antecipacao:<id>`, não acharia os lançamentos que já existem sob a access_key, e
-- pagaria todos de novo.

update public.comissao_lancamentos_v2 l
   set origem_id = 'antecipacao:' || (l.params_snapshot ->> 'antecipacao_id')
 where l.origem_tipo = 'nf_convertida'
   and l.origem_id not like 'antecipacao:%'
   and (l.params_snapshot ->> 'antecipacao_id') is not null;

/*
 * O estorno espelha o `origem_id` do original no dele (`estorno:<origem_id>` ou similar),
 * então qualquer linha de estorno que aponte para a chave antiga é reescrita junto. Hoje
 * não há nenhuma; a query existe para que a migração continue correta quando houver.
 */
update public.comissao_lancamentos_v2 e
   set origem_id = 'antecipacao:' || (e.params_snapshot ->> 'antecipacao_id')
 where e.origem_tipo = 'estorno'
   and e.origem_id not like 'antecipacao:%'
   and (e.params_snapshot ->> 'antecipacao_id') is not null;

comment on column public.comissao_lancamentos_v2.origem_id is
  'Identidade do fato gerador. Para `nf_convertida` e `estorno` é `antecipacao:<id_externo>` '
  '— a CESSÃO, não a nota: uma NF cedida em parcelas gera várias cessões, e uma cessão pode '
  'não ter nota nenhuma. Para os eventos de SDR é o id do aceite ou do lead.';
