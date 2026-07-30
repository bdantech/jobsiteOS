-- =============================================================================
-- 0062 — Certificados digitais (Prompt 04b)
--
-- Certificado vencido = cegueira de NF-e naquela empresa. A tabela guarda TODOS os
-- certificados que o endpoint devolve, inclusive de fornecedores (§1): o grid mostra
-- só construtoras clientes e suas SPEs, mas o KPI de "total ativos" conta tudo, e
-- guardar o resto agora evita um re-sync quando alguém quiser usá-lo.
--
-- `cnpj` é a PK, e não um id serial, porque a granularidade real do dado é uma linha
-- por CNPJ: o endpoint pode mandar dois certificados do mesmo `taxId` numa renovação,
-- e a regra (§2) é manter o de maior `expires_at`. Com PK no CNPJ isso é um upsert
-- condicional, e não um "escolha uma entre N" na leitura, toda leitura, para sempre.
-- =============================================================================

create table if not exists certificados (
  cnpj text primary key check (cnpj ~ '^[0-9]{14}$'),
  company_name text,
  expires_at timestamptz,
  status text,
  sincronizado_em timestamptz not null default now()
);

comment on table certificados is
  'Certificados digitais de TODAS as empresas da plataforma (inclui fornecedores). '
  'Uma linha por CNPJ: numa renovação, fica o de maior expires_at.';

-- Estado ANTERIOR do vencimento, para o evento `certificado.renovado` poder existir
-- e para o dedupe dos alertas: sem isto, "renovou" é indistinguível de "sempre foi
-- assim", e `certificado.vencendo` seria reemitido todo dia até alguém agir.
alter table certificados
  add column if not exists expires_at_anterior timestamptz,
  add column if not exists ultimo_alerta text
    check (ultimo_alerta is null or ultimo_alerta in ('vencendo', 'vencido', 'renovado'));

comment on column certificados.ultimo_alerta is
  'Último evento emitido para este CNPJ. O sync só emite de novo quando o estado MUDA — '
  'sem isso o alerta de "vencendo" viraria spam diário durante 30 dias.';

create index if not exists certificados_expires_at_idx on certificados (expires_at);

-- ─── SPEs ocultadas do grid ─────────────────────────────────────────────────
-- Preferência GLOBAL, não por usuário (§2): quem esconde uma SPE do grid está
-- dizendo "esta não opera", e isso vale para o time inteiro. Por usuário, cada um
-- veria um grid diferente e a conversa sobre cobertura ficaria impossível.

create table if not exists certificados_spe_ocultas (
  cnpj text primary key check (cnpj ~ '^[0-9]{14}$'),
  oculto_por uuid references usuarios(id) on delete set null,
  oculto_em timestamptz not null default now()
);

comment on table certificados_spe_ocultas is
  'SPEs escondidas do grid de certificados. Preferência global do time, não por usuário.';

-- ─── RLS ────────────────────────────────────────────────────────────────────
-- `certificados` é escrita SÓ pelo worker (service role bypassa RLS), então leva
-- apenas policy de select — mesmo padrão de clientes_onepay/enriquecimentos (0028).
-- O gate é `empresas`, e não `radar`: o painel de Clientes Onepay mora na aba
-- Empresas, e é de lá que a página de certificados é aberta.

alter table certificados enable row level security;
create policy certificados_select on certificados
  for select to authenticated using (app_tem_modulo('empresas'));

-- As ocultas SÃO escritas pelo usuário (clicar no quadrado), então tem write.
alter table certificados_spe_ocultas enable row level security;
create policy certificados_spe_ocultas_select on certificados_spe_ocultas
  for select to authenticated using (app_tem_modulo('empresas'));
create policy certificados_spe_ocultas_insert on certificados_spe_ocultas
  for insert to authenticated
  with check (app_tem_modulo('empresas') and (oculto_por = auth.uid() or oculto_por is null));
create policy certificados_spe_ocultas_delete on certificados_spe_ocultas
  for delete to authenticated using (app_tem_modulo('empresas'));

-- ─── mercado_ingestoes aceita a nova fonte ──────────────────────────────────
alter table mercado_ingestoes drop constraint if exists mercado_ingestoes_fonte_check;
alter table mercado_ingestoes add constraint mercado_ingestoes_fonte_check
  check (fonte in ('receita_cnpj', 'cno', 'lista', 'onepay_nf', 'onepay_certificados'));

-- ─── Roteamento de notificação (§3) ─────────────────────────────────────────
-- Crédito já existe desde 0033; o `join` cobre "se existir" sem falhar se não.
insert into notificacao_regras (tipo_evento, perfil_id, ativo)
select v.tipo, p.id, true
from (values
  ('certificado.vencendo', 'Admin'),
  ('certificado.vencendo', 'Crédito'),
  ('certificado.vencido',  'Admin'),
  ('certificado.vencido',  'Crédito')
) as v(tipo, perfil)
join perfis p on p.nome = v.perfil
where not exists (
  select 1 from notificacao_regras r where r.tipo_evento = v.tipo and r.perfil_id = p.id
);
