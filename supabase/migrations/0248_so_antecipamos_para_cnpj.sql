-- 0248 — Só antecipamos para CNPJ, e a dedup alcança o que já entrou
--
-- Três retroativos do primeiro sync completo. A regra dos três já está corrigida no
-- código; isto aqui é o dado que entrou antes dela.

-- ─── 1. Credor pessoa física sai do funil ──────────────────────────────────
--
-- Só antecipamos para CNPJ. Não é preferência comercial: a operação é cessão de
-- recebível entre pessoas jurídicas, e não há como analisar crédito, emitir cessão
-- ou cadastrar cedente para um CPF. O card seria trabalho impossível.
--
-- Vai para `expirada` e não `perdida`, junto com os outros "não há o que fazer
-- aqui": perda é o que poderíamos ter ganhado e não ganhamos, e inflar a métrica
-- com o que nunca foi ganhável apaga justamente o que ela mede.
--
-- Continua GRAVADO: a parcela existe no ERP da construtora e conta para o volume.
update public.sienge_titulos
   set estagio_funil = 'expirada', estagio_alterado_em = now()
 where credor_pessoa_fisica
   and estagio_funil in ('a_prospectar', 'em_prospeccao', 'em_negociacao', 'antecipacao_andamento');

-- ─── 2. `SUPPLIER_CONTACT_MISSING` volta para o funil ──────────────────────
--
-- 26 parcelas, R$ 277 mil, 21 credores distintos — todos com CNPJ, faltando só o
-- contato. Foram filtradas para fora porque a lista de motivos recuperáveis (0247)
-- saiu do exemplo do Prompt em vez dos dados reais.
--
-- Só volta o que saiu por ESTA razão e continua sem ser trabalhado. Quem já foi
-- movido à mão não é tocado — o sync não desfaz trabalho humano, e nem este
-- retroativo.
update public.sienge_titulos
   set estagio_funil = 'a_prospectar', estagio_alterado_em = now()
 where situation = 'not_eligible'
   and guard_reason = 'SUPPLIER_CONTACT_MISSING'
   and not credor_pessoa_fisica
   and estagio_funil = 'expirada';

-- ─── 3. A deduplicação alcança os 92 pares que já entraram ─────────────────
--
-- A dedup estourava num SQL inválido (`update ... from ... left join` referenciando
-- a tabela alvo). O `rollback` mantinha tudo consistente, mas o resultado era zero:
-- 92 pares vivos ficaram duplicados na tela — a oferta E a parcela dela, lado a
-- lado, como se fossem dois recebíveis.
--
-- O casamento aqui é o do §5 por ID, o caminho sem ambiguidade: a parcela traz
-- `anticipation.preAuthorizationId`. O ORIGINAL é o TÍTULO — a parcela é a unidade
-- que vira oferta e é antecipada —, e a oferta vira SELO nela.
--
-- Reconciliação, não substituição: o job recompõe tudo do zero a cada corrida, e a
-- próxima passada refaz este cálculo inteiro — inclusive os casamentos por número e
-- por chave de acesso, que este retroativo não faz.
insert into public.funil_ocultacoes (tipo, referencia_id, motivo, original_tipo, original_id)
select 'pre_autorizacao', pa.id_externo::text, 'tem_original', 'titulo', st.id_externo::text
  from public.pre_autorizacoes pa
  join public.sienge_titulos st on st.pre_autorizacao_id_externo = pa.id_externo
 where pa.estagio_funil not in ('convertida', 'perdida')
   and st.estagio_funil not in ('convertida', 'perdida')
on conflict (tipo, referencia_id) do nothing;

insert into public.funil_selos_preauth (tipo, referencia_id, pre_autorizacao_id, status, criada_em)
select 'titulo', st.id_externo::text, pa.id_externo, pa.status, pa.criada_em
  from public.pre_autorizacoes pa
  join public.sienge_titulos st on st.pre_autorizacao_id_externo = pa.id_externo
 where pa.estagio_funil not in ('convertida', 'perdida')
   and st.estagio_funil not in ('convertida', 'perdida')
on conflict (tipo, referencia_id, pre_autorizacao_id)
  do update set status = excluded.status, atualizado_em = now();

-- `origem_exibida` espelha `funil_ocultacoes`. DUAS instruções, e não um `left join`
-- sobre a tabela alvo — que é exatamente o SQL que o Postgres recusa e que derrubou
-- a dedup.
update public.pre_autorizacoes t
   set origem_exibida = false, original_tipo = o.original_tipo, original_id = o.original_id
  from public.funil_ocultacoes o
 where o.tipo = 'pre_autorizacao' and o.referencia_id = t.id_externo::text
   and (t.origem_exibida
        or t.original_tipo is distinct from o.original_tipo
        or t.original_id is distinct from o.original_id);

update public.pre_autorizacoes t
   set origem_exibida = true, original_tipo = null, original_id = null
 where not t.origem_exibida
   and not exists (select 1 from public.funil_ocultacoes o
                    where o.tipo = 'pre_autorizacao' and o.referencia_id = t.id_externo::text);
