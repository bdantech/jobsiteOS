-- 0231 — A nota que chega pelos dois lados, e as chaves numéricas que se cruzam.
--
-- Três consertos do mesmo cutover de 12/09/2026, todos da mesma família: ids que
-- a plataforma nova reaproveitou, e que agora colidem com os do sistema antigo.
--
-- ─── 1. A nota que aparece duas vezes ──────────────────────────────────────
--
-- Quando emitente e destinatário são AMBOS empresas da plataforma, a mesma nota
-- volta duas vezes: uma como `issued` e outra como `received`, com ids diferentes
-- e a MESMA `accessKey`. São 2.385 notas na base (3%), 145 desde o cutover.
--
-- A `accessKey` continua sendo a nossa chave, e isso é o certo para um funil:
-- um documento é um card, não dois. O que estava errado era o `direction` ficar
-- trocando a cada sync conforme qual das duas cópias chegasse por último —
-- instabilidade sem informação nenhuma.
--
-- A regra passa a ser: a PRIMEIRA direção observada fica, e `bilateral` registra
-- que a nota também existe do outro lado. "Primeira ganha" e não "received
-- sempre" porque privilegiar um valor seria inventar um fato; o que sabemos é
-- que ela é das duas pontas, e é isso que a coluna diz.
alter table notas_fiscais
  add column if not exists bilateral boolean not null default false;

comment on column notas_fiscais.bilateral is
  'Emitente e destinatario sao ambos empresas da plataforma, entao a nota chega '
  'pelos dois lados com ids diferentes e a mesma chave. O direction gravado e o '
  'da primeira observacao e nao muda mais.';

-- O que já está gravado: as duas pontas cadastradas é a condição necessária, e é
-- o melhor que dá para inferir sem reler a API. Pode marcar a mais (uma nota
-- entre duas empresas da plataforma que só veio por um lado), e isso é o erro
-- certo a cometer: a coluna existe para EXPLICAR uma direção, nunca para filtrar.
update notas_fiscais
   set bilateral = true
 where fornecedor_cadastrado is true
   and sacado_cadastrado is true
   and bilateral = false;

-- ─── 2. `analises_plataforma`: o id da análise não é único ─────────────────
--
-- A chave era `id_externo` (o `analysis.id` da plataforma). As análises migradas
-- mantiveram o id antigo e as nativas usam a numeração nova; as duas faixas se
-- cruzam, e duas análises de EMPRESAS DIFERENTES com o mesmo número viravam uma
-- linha só — a segunda sobrescrevendo a primeira, sem erro.
--
-- A identidade estável é `taxId` + `role`. Mas trocar a chave para esse par
-- perderia o histórico de propósito acumulado aqui: o sync faz DUAS passadas (a
-- foto de hoje e a foto de quando a porta fechou para o ex-cliente) e elas
-- gravam análises diferentes do mesmo par. Por isso a chave vira o TRIO —
-- identidade da empresa + o papel + qual análise é —, que impede a colisão sem
-- colapsar o histórico.
alter table analises_plataforma
  drop constraint if exists analises_plataforma_pkey cascade;

-- `cnpj` e `role` precisam existir na chave, então não podem ser nulos. Nenhuma
-- linha viola hoje (250 linhas, 245 pares distintos); se alguma violasse, o
-- alter falharia aqui em vez de deixar a chave frouxa.
alter table analises_plataforma
  add constraint analises_plataforma_pkey primary key (id_externo, cnpj, role);

-- ─── 3. `clientes_onepay`: o id da empresa também se cruza ─────────────────
--
-- A tabela já é chaveada por `cnpj`, que é o certo. Sobrava uma UNIQUE em
-- `onepay_company_id` — e é exatamente o id numérico que o cutover fez colidir.
-- Com ela, a primeira empresa nativa cujo id repetisse o de uma migrada faria o
-- upsert da OUTRA empresa falhar, e o sync do Radar perderia a linha inteira por
-- causa de um campo que é informativo.
-- `drop constraint` e NÃO `drop index`: a UNIQUE é uma constraint, e o índice é o
-- objeto que a implementa. Derrubar o índice direto o Postgres recusa, apontando
-- a constraint que depende dele.
alter table clientes_onepay
  drop constraint if exists clientes_onepay_onepay_company_id_key;

comment on column clientes_onepay.onepay_company_id is
  'Id da empresa na plataforma. INFORMATIVO: migradas e nativas usam numeracoes '
  'que se cruzam, entao ele nao identifica ninguem. A chave e o cnpj.';

-- ─── 4. Os cinco status de antecipação que deixaram de existir ─────────────
--
-- `DRAFT`, `DENY_BY_CONTRACTED`, `REVISION`, `PAYMENT_REPROVED` e
-- `PROGRAMED_PAYMENT` não voltam mais da API. Nenhuma linha de `antecipacoes` os
-- carrega hoje (conferido: os seis status vivos são BILLET_SWAPPED, REPROVED,
-- CONCLUDED, REQUESTED, EXPIRED_BILL_SWAPPED e PAY_OUT).
--
-- `status_conversores` é usada como ALLOWLIST por `app_casar_antecipacao`
-- (`v_cfg -> 'status_conversores' ? upper(status)`), então sobra ali é inofensivo
-- na prática e enganoso na leitura: quem abre a configuração vê como possível um
-- estado que a plataforma não produz mais.
update antecipacao_config
   set valor = jsonb_set(
         jsonb_set(
           valor,
           '{status_conversores}',
           (select jsonb_agg(v) from jsonb_array_elements_text(valor -> 'status_conversores') t(v)
             where v not in ('REVISION', 'PROGRAMED_PAYMENT'))
         ),
         '{status_nao_conversores}',
         (select jsonb_agg(v) from jsonb_array_elements_text(valor -> 'status_nao_conversores') t(v)
           where v not in ('DRAFT', 'DENY_BY_CONTRACTED', 'PAYMENT_REPROVED'))
       )
 where chave = 'conversao';

-- ─── 5. `bilateral` na view ────────────────────────────────────────────────
--
-- Mesma cirurgia da 0229/0230, com a âncora atualizada para a última coluna que a
-- 0230 acrescentou.
do $$
declare
  v_def text;
  v_fim_velho constant text := 'nf.xml_resumo
   FROM notas_fiscais nf';
  v_fim_novo constant text := 'nf.xml_resumo,
    nf.bilateral
   FROM notas_fiscais nf';
begin
  select pg_get_viewdef('public.notas_funil'::regclass, true) into v_def;
  if position(v_fim_velho in v_def) = 0 then
    raise exception 'A ultima coluna de notas_funil mudou — revise a 0231 a mao.';
  end if;
  v_def := replace(v_def, v_fim_velho, v_fim_novo);
  execute 'create or replace view public.notas_funil as ' || v_def;
end $$;

alter view public.notas_funil set (security_invoker = on);
