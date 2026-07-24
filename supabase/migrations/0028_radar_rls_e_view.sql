-- =============================================================================
-- 0028 — Radar: RLS + views
--
-- Padrão do projeto: RLS ligada em tudo; gate por app_tem_modulo('radar'); tabelas
-- que só o worker escreve (service role bypassa RLS) ganham só policy de select;
-- config company-wide é admin-only; view de estado atual com security_invoker.
-- =============================================================================

-- ─── enriquecimentos: worker escreve, módulo lê ─────────────────────────────
alter table enriquecimentos enable row level security;
create policy enriquecimentos_select on enriquecimentos
  for select to authenticated using (app_tem_modulo('radar'));

-- ─── lotes_enriquecimento: usuário cria/lê/aprova ───────────────────────────
alter table lotes_enriquecimento enable row level security;
create policy lotes_select on lotes_enriquecimento
  for select to authenticated using (app_tem_modulo('radar'));
create policy lotes_insert on lotes_enriquecimento
  for insert to authenticated
  with check (app_tem_modulo('radar') and (criado_por = auth.uid() or criado_por is null));
create policy lotes_update on lotes_enriquecimento
  for update to authenticated
  using (app_tem_modulo('radar')) with check (app_tem_modulo('radar'));
create policy lotes_delete on lotes_enriquecimento
  for delete to authenticated
  using (criado_por = auth.uid() or app_is_admin());

-- ─── lote_itens: worker escreve, módulo lê ──────────────────────────────────
alter table lote_itens enable row level security;
create policy lote_itens_select on lote_itens
  for select to authenticated using (app_tem_modulo('radar'));

-- ─── protestos_consultas: worker escreve, módulo lê ─────────────────────────
alter table protestos_consultas enable row level security;
create policy protestos_select on protestos_consultas
  for select to authenticated using (app_tem_modulo('radar'));

-- ─── clientes_onepay (+ snapshots): worker escreve, módulo lê ────────────────
alter table clientes_onepay enable row level security;
create policy clientes_onepay_select on clientes_onepay
  for select to authenticated using (app_tem_modulo('radar'));

alter table clientes_onepay_snapshots enable row level security;
create policy clientes_onepay_snapshots_select on clientes_onepay_snapshots
  for select to authenticated using (app_tem_modulo('radar'));

-- ─── supressao: módulo gerencia (add/remove), leitura por módulo ─────────────
alter table supressao enable row level security;
create policy supressao_select on supressao
  for select to authenticated using (app_tem_modulo('radar'));
create policy supressao_insert on supressao
  for insert to authenticated
  with check (app_tem_modulo('radar') and (criado_por = auth.uid() or criado_por is null));
create policy supressao_delete on supressao
  for delete to authenticated
  using (app_tem_modulo('radar'));

-- ─── radar_config: leitura por módulo, escrita só admin ─────────────────────
alter table radar_config enable row level security;
create policy radar_config_select on radar_config
  for select to authenticated using (app_tem_modulo('radar'));
create policy radar_config_admin on radar_config
  for all to authenticated using (app_is_admin()) with check (app_is_admin());

-- ─── View de estado atual: último snapshot de protesto por CNPJ ──────────────
create view protestos_atual with (security_invoker = true) as
  select distinct on (cnpj) *
  from protestos_consultas
  order by cnpj, consultado_em desc;

comment on view protestos_atual is 'Último snapshot de protesto por CNPJ. security_invoker: a RLS de protestos_consultas decide as linhas.';

-- ─── Grants (RLS decide linhas, grants decidem verbos) ──────────────────────
grant select on enriquecimentos, lote_itens, protestos_consultas,
  clientes_onepay, clientes_onepay_snapshots to authenticated;
grant select, insert, update, delete on lotes_enriquecimento to authenticated;
grant select, insert, delete on supressao to authenticated;
grant select, insert, update, delete on radar_config to authenticated;
grant select on protestos_atual to authenticated;
