-- =============================================================================
-- 0046 — Antecipação: RLS + views
--
-- Padrão do projeto: RLS ligada em tudo; gate por app_tem_modulo('antecipacao');
-- tabelas que só o worker escreve (service role bypassa RLS) ganham só policy de
-- select; config company-wide é admin-only; views com security_invoker.
--
-- A view `notas_funil` é o análogo de `mercado_explorador`: TODA variável do
-- catálogo de faixas (packages/core/src/antecipacao/faixas.ts) precisa ser uma
-- COLUNA real aqui, porque é isso que os compiladores do filter engine emitem.
-- =============================================================================

-- ─── notas_fiscais: worker escreve o sync, usuário move o estágio pelo RPC ────
alter table notas_fiscais enable row level security;
create policy notas_fiscais_select on notas_fiscais
  for select to authenticated using (app_tem_modulo('antecipacao'));

alter table nota_itens enable row level security;
create policy nota_itens_select on nota_itens
  for select to authenticated using (app_tem_modulo('antecipacao'));

alter table credito_snapshots enable row level security;
create policy credito_snapshots_select on credito_snapshots
  for select to authenticated using (app_tem_modulo('antecipacao'));

-- ─── faixa_regras: ler com o módulo, escrever só admin ───────────────────────
-- Uma regra de faixa reclassifica o funil inteiro. É alavanca da empresa, não
-- preferência pessoal — mesma decisão de camada_regras (0012).
alter table faixa_regras enable row level security;
create policy faixa_regras_select on faixa_regras
  for select to authenticated using (app_tem_modulo('antecipacao'));
create policy faixa_regras_admin on faixa_regras
  for all to authenticated using (app_is_admin()) with check (app_is_admin());

-- ─── faixa_disparos / whatsapp_contas / antecipacao_config: admin escreve ────
alter table faixa_disparos enable row level security;
create policy faixa_disparos_select on faixa_disparos
  for select to authenticated using (app_tem_modulo('antecipacao'));
create policy faixa_disparos_admin on faixa_disparos
  for all to authenticated using (app_is_admin()) with check (app_is_admin());

alter table whatsapp_contas enable row level security;
create policy whatsapp_contas_select on whatsapp_contas
  for select to authenticated using (app_tem_modulo('antecipacao'));
create policy whatsapp_contas_admin on whatsapp_contas
  for all to authenticated using (app_is_admin()) with check (app_is_admin());

alter table antecipacao_config enable row level security;
create policy antecipacao_config_select on antecipacao_config
  for select to authenticated using (app_tem_modulo('antecipacao'));
create policy antecipacao_config_admin on antecipacao_config
  for all to authenticated using (app_is_admin()) with check (app_is_admin());

-- ─── mensagens_outbox: worker gera, usuário lê e descarta (pelo RPC) ─────────
alter table mensagens_outbox enable row level security;
create policy mensagens_outbox_select on mensagens_outbox
  for select to authenticated using (app_tem_modulo('antecipacao'));

-- ─── cnpj_lookup_fila: worker consome, módulo lê (diagnóstico) ───────────────
alter table cnpj_lookup_fila enable row level security;
create policy cnpj_lookup_fila_select on cnpj_lookup_fila
  for select to authenticated using (app_tem_modulo('antecipacao'));

-- ─── Grants (RLS decide linhas, grants decidem verbos) ───────────────────────
-- Nenhum insert/update direto em notas_fiscais nem em mensagens_outbox: o sync é
-- do worker e as mutações do usuário passam pelos RPCs de 0047, que gravam evento
-- e audit_log na mesma transação.
grant select on notas_fiscais, nota_itens, credito_snapshots,
                mensagens_outbox, cnpj_lookup_fila to authenticated;
grant select on faixa_regras to authenticated;
grant insert, update, delete on faixa_regras to authenticated;   -- policy estreita para admin
grant select, insert, update, delete on faixa_disparos to authenticated;
grant select, insert, update, delete on whatsapp_contas to authenticated;
grant select, insert, update, delete on antecipacao_config to authenticated;

-- ATENÇÃO: este REVOKE por coluna NÃO tem efeito, porque o GRANT acima é de
-- TABELA — no Postgres o privilégio de tabela cobre todas as colunas, e revogar
-- uma coluna depois não o corta. Mantido aqui para preservar o histórico; a
-- correção (revogar o select da tabela e concedê-lo coluna a coluna, sem
-- token_secret_id) está na migration 0052.
revoke select (token_secret_id) on whatsapp_contas from authenticated;

-- ═══ A view do funil ═════════════════════════════════════════════════════════
--
-- Uma linha por NF, com o contexto de fornecedor e de sacado já resolvido. É a
-- superfície única: o Kanban lê daqui, o compilador PostgREST filtra aqui, e o
-- worker reclassifica varrendo isto uma vez.
--
-- `dias_para_vencimento` é CALCULADO na view (vencimento - hoje), não lido da
-- coluna: a coluna é atualizada pelo job diário e serve para ordenar/exibir, mas
-- uma regra que dependesse dela classificaria com o número de ontem sempre que o
-- job atrasasse. Aqui a conta é a de agora, por construção.
create view notas_funil with (security_invoker = true) as
  select
    nf.access_key,
    nf.nf_id_externo,
    nf.tipo as tipo_nf,
    nf.direction,
    nf.numero,
    nf.serie,
    nf.valor,
    nf.emitida_em,
    nf.vencimento,
    nf.vencimento_origem,
    nf.status_sync,
    nf.parcelas,
    nf.faixa,
    nf.faixa_regra_versao,
    nf.faixa_motivo,
    nf.faixa_alterada_em,
    nf.estagio_funil,
    nf.estagio_alterado_em,
    nf.perda_motivo,
    nf.receita_esperada,
    nf.taxa_usada,
    nf.sincronizada_em,
    (nf.vencimento - current_date)::int as dias_para_vencimento,

    -- ── Fornecedor ──────────────────────────────────────────────────────────
    nf.fornecedor_cnpj,
    nf.fornecedor_nome,
    coalesce(nf.fornecedor_cadastrado, false) as fornecedor_cadastrado,
    nf.fornecedor_empresa_id,
    coalesce(fe.uf, fu.uf) as fornecedor_uf,
    coalesce(fpa.tem_protesto, false) as fornecedor_tem_protesto,
    (fco.cnpj is not null) as fornecedor_e_cliente_onepay,
    (fco.last_anticipation is not null or fe.ultima_antecipacao is not null) as fornecedor_ja_antecipou,
    -- Tipagem ao vivo. `empresas.tipagem_antecipacao` é o cache que o worker
    -- mantém para a Company 360 e para o evento de mudança — a regra usa esta.
    case
      when not coalesce(nf.fornecedor_cadastrado, false) then 'aquisicao'
      when fco.last_anticipation is not null or fe.ultima_antecipacao is not null then 'recorrencia'
      else 'ativacao'
    end as fornecedor_tipagem,
    (fsup.valor is not null) as fornecedor_suprimido,

    -- ── Sacado ──────────────────────────────────────────────────────────────
    nf.sacado_cnpj,
    nf.sacado_nome,
    coalesce(nf.sacado_cadastrado, false) as sacado_cadastrado,
    nf.sacado_empresa_id,
    nf.contato_sacado,
    coalesce(se.uf, su.uf) as sacado_uf,
    nf.credit_status as sacado_credito_status,
    nf.credit_role as sacado_credito_role,
    nf.credit_limite as sacado_limite,
    nf.credit_disponivel as sacado_limite_disponivel,
    (coalesce(nf.credit_disponivel, 0) >= nf.valor) as sacado_limite_cobre_nota
  from notas_fiscais nf
    left join empresas fe on fe.id = nf.fornecedor_empresa_id
    left join empresas se on se.id = nf.sacado_empresa_id
    left join mercado_universo fu on fu.cnpj = nf.fornecedor_cnpj
    left join mercado_universo su on su.cnpj = nf.sacado_cnpj
    left join protestos_atual fpa on fpa.cnpj = nf.fornecedor_cnpj
    left join clientes_onepay fco on fco.cnpj = nf.fornecedor_cnpj
    left join supressao fsup
      on fsup.escopo = 'empresa'
     and fsup.valor = nf.fornecedor_cnpj
     and (fsup.expira_em is null or fsup.expira_em >= current_date);

grant select on notas_funil to authenticated;

comment on view notas_funil is
  'Uma linha por NF com o contexto de fornecedor e sacado resolvido. Superfície única do Kanban e alvo do compilador de filtros das faixas. security_invoker: as policies das tabelas de base decidem as linhas.';

-- ═══ Fornecedores vivos (agrupamento da abordagem) ═══════════════════════════
-- O card do funil é uma NOTA, mas fala de um FORNECEDOR ("+3 notas · R$ 180k").
-- Esta view responde isso em uma leitura em vez de N+1 no cliente. "Vivas" = em
-- faixa e ainda no funil de conversão.
create view antecipacao_fornecedores with (security_invoker = true) as
  select
    f.fornecedor_cnpj,
    max(f.fornecedor_nome) as fornecedor_nome,
    (array_agg(f.fornecedor_empresa_id) filter (where f.fornecedor_empresa_id is not null))[1]
      as fornecedor_empresa_id,
    max(f.fornecedor_tipagem) as fornecedor_tipagem,
    bool_or(f.fornecedor_suprimido) as fornecedor_suprimido,
    count(*)::int as notas_vivas,
    sum(f.valor) as valor_total,
    sum(f.receita_esperada) as receita_esperada_total,
    min(f.dias_para_vencimento) as dias_para_vencimento_min,
    -- A melhor faixa por ORDEM DE NEGÓCIO (alta > boa > media), escrita à mão. Um
    -- min() sobre o texto daria o mesmo resultado hoje por acidente alfabético, e
    -- deixaria de dar no dia em que alguém renomear uma faixa.
    (array_agg(f.faixa order by case f.faixa
       when 'alta' then 1 when 'boa' then 2 when 'media' then 3 else 9 end))[1] as melhor_faixa
  from notas_funil f
  where f.faixa is not null
    and f.estagio_funil in ('a_prospectar', 'em_prospeccao', 'em_negociacao', 'antecipacao_andamento')
  group by f.fornecedor_cnpj;

grant select on antecipacao_fornecedores to authenticated;

comment on view antecipacao_fornecedores is
  'Agregado por fornecedor das notas VIVAS (em faixa e ainda no funil). Alimenta o contexto do card ("+3 notas · R$ 180k") e o agrupamento da outbox.';

-- ═══ Capacidade por sacado (limite vs. demanda do pipeline) ══════════════════
create view antecipacao_sacados with (security_invoker = true) as
  select
    f.sacado_cnpj,
    max(f.sacado_nome) as sacado_nome,
    (array_agg(f.sacado_empresa_id) filter (where f.sacado_empresa_id is not null))[1]
      as sacado_empresa_id,
    max(f.sacado_credito_status) as credito_status,
    max(f.sacado_limite) as credit_limit,
    max(f.sacado_limite_disponivel) as available_limit,
    count(*)::int as notas_em_faixa,
    sum(f.valor) as demanda_pipeline,
    sum(f.receita_esperada) as receita_esperada_total,
    count(distinct f.fornecedor_cnpj)::int as fornecedores
  from notas_funil f
  where f.faixa is not null
    and f.estagio_funil in ('a_prospectar', 'em_prospeccao', 'em_negociacao', 'antecipacao_andamento')
  group by f.sacado_cnpj;

grant select on antecipacao_sacados to authenticated;

comment on view antecipacao_sacados is
  'Por construtora: limite disponível vs. demanda do pipeline (soma das NFs em faixa contra ela). A barra de contenção da aba "Por sacado" sai daqui.';

-- ═══ Sacados a prospectar (o flywheel inverso) ═══════════════════════════════
-- Construtoras NÃO cadastradas que recebem notas de fornecedores que JÁ operam.
-- Cada uma é uma porta aberta por um fornecedor que já confia na plataforma.
create view antecipacao_sacados_a_prospectar with (security_invoker = true) as
  select
    f.sacado_cnpj,
    max(f.sacado_nome) as sacado_nome,
    (array_agg(f.sacado_empresa_id) filter (where f.sacado_empresa_id is not null))[1]
      as sacado_empresa_id,
    max(f.sacado_uf) as sacado_uf,
    count(*)::int as notas,
    sum(f.valor) as valor_agregado,
    count(distinct f.fornecedor_cnpj)::int as fornecedores_operando,
    max(f.emitida_em) as ultima_nota_em
  from notas_funil f
  where not f.sacado_cadastrado
    and f.fornecedor_ja_antecipou
  group by f.sacado_cnpj;

grant select on antecipacao_sacados_a_prospectar to authenticated;

comment on view antecipacao_sacados_a_prospectar is
  'Sacados fora da plataforma que recebem NFs de fornecedores que já antecipam. Ranqueados por volume agregado — é o funil rodando ao contrário.';
