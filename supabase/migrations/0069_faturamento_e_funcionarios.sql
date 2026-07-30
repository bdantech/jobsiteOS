-- 0069 — Faturamento estimado e funcionários (Prompt 04c).
--
-- Duas métricas com o mesmo desenho: SÉRIE TEMPORAL em `empresa_metricas`, nunca
-- update, mais um cache do valor vigente em `empresas` para quem só quer o número.
--
-- Por que série e não coluna: faturamento e headcount mudam, e a pergunta comercial
-- quase sempre é sobre a DERIVADA ("essa empresa está crescendo?"), não sobre o
-- nível. Guardar só o último valor destrói exatamente o dado que interessa, e destrói
-- em silêncio — ninguém percebe a informação que não existe.
--
-- O cache existe porque o filtro do Explorador precisa de COLUNA (é o contrato do
-- catálogo), e uma lateral sobre a série em 740 mil linhas do universo seria paga em
-- toda varredura.

-- ─── §1 Tipo da empresa: quatro valores ─────────────────────────────────────
-- `construtora` continua válido e NADA é reclassificado. A distinção
-- incorporadora/subempreiteiro é refinada à mão: inferir por CNAE erraria
-- justamente nas empresas que fazem as duas coisas, que são as maiores.

alter table public.empresas drop constraint empresas_tipo_check;
alter table public.empresas add constraint empresas_tipo_check
  check (tipo in ('construtora', 'incorporadora', 'fornecedor', 'subempreiteiro'));

-- ─── §2 A série ─────────────────────────────────────────────────────────────

create table public.empresa_metricas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas (id) on delete set null,
  -- CNPJ é NOT NULL e a chave real de leitura: o snapshot pode nascer antes de a
  -- empresa existir (backfill do universo), e sobrevive a `on delete set null`.
  cnpj text not null
    constraint empresa_metricas_cnpj_check check (cnpj ~ '^[0-9]{14}$'),
  metrica text not null
    constraint empresa_metricas_metrica_check check (metrica in ('faturamento_anual', 'funcionarios')),
  valor numeric(16, 2) not null,
  origem text not null
    constraint empresa_metricas_origem_check check (origem in
      ('declarado_cliente', 'apollo', 'apollo_search', 'lista', 'modelo', 'bracket_simples')),
  confianca text
    constraint empresa_metricas_confianca_check
    check (confianca is null or confianca in ('alta', 'media', 'baixa')),
  detalhes jsonb not null default '{}'::jsonb,
  capturado_em timestamptz not null default now()
);

-- A leitura dominante é "a série desta empresa, mais recente primeiro".
create index empresa_metricas_serie_idx on public.empresa_metricas (cnpj, metrica, capturado_em desc);
create index empresa_metricas_empresa_idx on public.empresa_metricas (empresa_id) where empresa_id is not null;

comment on table public.empresa_metricas is
  'Série temporal de faturamento anual e headcount. APPEND-ONLY: cada leitura é um '
  'snapshot novo, nunca um update. O valor vigente fica cacheado em empresas.';

alter table public.empresa_metricas enable row level security;

-- Lê quem lê a empresa. Escrita só por RPC (declaração) ou service role (jobs):
-- sem grant de insert para `authenticated`, "gravar métrica sem passar pela
-- hierarquia de origem" fica inexprimível, não apenas desencorajado.
create policy empresa_metricas_select on public.empresa_metricas
  for select using (app_tem_modulo('empresas') or app_tem_modulo('mercado') or app_tem_modulo('radar'));

grant select on public.empresa_metricas to authenticated;

-- ─── §2 O cache do valor vigente ────────────────────────────────────────────

alter table public.empresas
  add column faturamento_anual numeric(16, 2),
  add column faturamento_origem text,
  add column faturamento_confianca text,
  add column faturamento_atualizado_em timestamptz,
  add column funcionarios int,
  add column funcionarios_origem text,
  add column funcionarios_atualizado_em timestamptz,
  -- Derivada guardada, e não calculada na view: o Explorador varre o universo
  -- inteiro, e uma lateral por linha sobre a série custaria em toda varredura. É
  -- recalculada quando um snapshot novo entra, que é a única hora em que muda.
  add column funcionarios_crescimento_12m numeric(6, 4),
  add column regime_tributario text;

alter table public.empresas
  add constraint empresas_regime_tributario_check
  check (regime_tributario is null or regime_tributario in ('simples', 'presumido', 'real'));

comment on column public.empresas.faturamento_anual is
  'Valor VIGENTE, cacheado de empresa_metricas. A série manda; isto é conveniência de leitura.';
comment on column public.empresas.funcionarios_crescimento_12m is
  'Variação do headcount entre o snapshot mais recente e o mais próximo de 12 meses '
  'atrás. NULL com menos de 2 pontos — e NULL não é zero.';

-- ─── §6.1 Coeficientes versionados ──────────────────────────────────────────
-- Mesmo padrão das regras da pirâmide: versão nova a cada calibração, nunca update.
-- Sem isso é impossível responder "por que a estimativa desta empresa mudou?", que é
-- a primeira pergunta que alguém faz quando o número muda.

create table public.estimador_versoes (
  id uuid primary key default gen_random_uuid(),
  versao int not null unique,
  coeficientes jsonb not null,
  n_amostras_por_tipo jsonb not null default '{}'::jsonb,
  erro_mediano_por_modelo jsonb not null default '{}'::jsonb,
  ativa boolean not null default true,
  calibrado_em timestamptz not null default now()
);

create index estimador_versoes_ativa_idx on public.estimador_versoes (calibrado_em desc) where ativa;

comment on table public.estimador_versoes is
  'Coeficientes e pesos do estimador de faturamento, versionados. A estimativa grava '
  'a versão usada, então dá para explicar um número de seis meses atrás.';

alter table public.estimador_versoes enable row level security;

create policy estimador_versoes_select on public.estimador_versoes
  for select using (app_tem_modulo('mercado') or app_tem_modulo('radar'));

grant select on public.estimador_versoes to authenticated;

-- ─── §4 Funcionários como tipo de enriquecimento ────────────────────────────

alter table public.enriquecimentos drop constraint enriquecimentos_tipo_check;
alter table public.enriquecimentos add constraint enriquecimentos_tipo_check
  check (tipo in ('dominio', 'contatos', 'protestos', 'funcionarios'));

-- `apollo_search` é fonte SEPARADA de `apollo` de propósito: o `total` do
-- mixed_people conta perfis indexados no LinkedIn, o que subconta canteiro de obra
-- de forma brutal. Misturar as duas na mesma fonte esconderia por que uma
-- construtora de 800 pessoas aparece com 40.
alter table public.enriquecimentos drop constraint enriquecimentos_fonte_check;
alter table public.enriquecimentos add constraint enriquecimentos_fonte_check
  check (fonte in ('rfb', 'contato', 'lista', 'heuristica', 'claude_busca', 'apollo',
                   'apollo_search', 'directd_sp', 'directd_nacional'));

alter table public.lotes_enriquecimento drop constraint lotes_tipo_check;
alter table public.lotes_enriquecimento add constraint lotes_tipo_check
  check (tipo in ('dominio', 'contatos', 'protestos', 'funcionarios'));

-- ─── §5 Declaração do cliente ───────────────────────────────────────────────
-- DEFINER porque a tabela não tem grant de insert para `authenticated` — e não tem
-- de propósito: este RPC é o único caminho de escrita humana, e ele grava métrica +
-- cache + evento + audit numa transação só.

create or replace function public.app_declarar_metrica(p jsonb)
returns public.empresa_metricas language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_empresa public.empresas;
  v_metrica text := p ->> 'metrica';
  v_valor numeric := (p ->> 'valor')::numeric;
  v_ano int := nullif(p ->> 'ano', '')::int;
  v_linha public.empresa_metricas;
begin
  if not public.app_tem_modulo('empresas') then
    raise exception 'Sem acesso ao módulo Empresas.' using errcode = '42501';
  end if;
  if v_metrica not in ('faturamento_anual', 'funcionarios') then
    raise exception 'Métrica inválida: %.', v_metrica using errcode = '22023';
  end if;
  if v_valor is null or v_valor < 0 then
    raise exception 'Valor inválido.' using errcode = '22023';
  end if;

  select * into v_empresa from public.empresas where id = (p ->> 'empresa_id')::uuid;
  if v_empresa.id is null then
    raise exception 'Empresa não encontrada.' using errcode = 'no_data_found';
  end if;

  insert into public.empresa_metricas (empresa_id, cnpj, metrica, valor, origem, confianca, detalhes)
  values (
    v_empresa.id, v_empresa.cnpj, v_metrica, v_valor, 'declarado_cliente', 'alta',
    jsonb_build_object('ano', v_ano, 'declarado_por', v_ator)
  )
  returning * into v_linha;

  -- `declarado_cliente` é o topo da hierarquia (§2), então sobrescreve sempre.
  if v_metrica = 'faturamento_anual' then
    update public.empresas set
      faturamento_anual = v_valor,
      faturamento_origem = 'declarado_cliente',
      faturamento_confianca = 'alta',
      faturamento_atualizado_em = now()
    where id = v_empresa.id;
  else
    update public.empresas set
      funcionarios = v_valor::int,
      funcionarios_origem = 'declarado_cliente',
      funcionarios_atualizado_em = now()
    where id = v_empresa.id;
  end if;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (
    v_empresa.id, 'metrica.declarada',
    jsonb_build_object(
      'resumo', case when v_metrica = 'faturamento_anual'
                     then 'Faturamento anual declarado: R$ ' || to_char(v_valor, 'FM999G999G999G990D00')
                          || coalesce(' (ref. ' || v_ano || ')', '')
                     else 'Funcionários declarados: ' || v_valor::int end,
      'metrica', v_metrica, 'valor', v_valor, 'ano', v_ano
    ),
    v_ator
  );

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'metrica.declarada', 'empresa_metricas', v_linha.id::text, p);

  return v_linha;
end; $$;

revoke execute on function public.app_declarar_metrica(jsonb) from public;
grant execute on function public.app_declarar_metrica(jsonb) to authenticated, service_role;

comment on function public.app_declarar_metrica is
  'Registra faturamento ou headcount DECLARADO pelo cliente (topo da hierarquia de '
  'origens). Snapshot + cache + evento + audit numa transação.';

-- ─── §7 As novas variáveis no Explorador ────────────────────────────────────
-- Colunas no FIM: `create or replace view` não deixa inserir no meio.

create or replace view public.mercado_explorador with (security_invoker = true) as
 SELECT u.cnpj,
    u.razao_social,
    u.nome_fantasia,
    u.situacao_cadastral,
    u.natureza_juridica,
    u.porte_rfb,
    u.cnae_principal,
    u.cnaes_todos,
    u.cnae_grupos,
    u.capital_social,
    u.data_inicio_atividade,
    u.uf,
    u.municipio,
    COALESCE(u.opcao_simples, false) AS opcao_simples,
    u.data_exclusao_simples,
    u.is_spe,
    u.grupo_id,
    u.grafo_sefaz,
    u.camada,
    u.camada_regra_versao,
    u.empresa_id,
    e.estagio,
    e.tipo,
    e.erp_atual,
    e.erp_mrr,
    e.erp_detalhes,
    e.churn_erp_concorrente,
    (e.erp_detalhes ->> 'qtd_usuarios'::text)::integer AS qtd_usuarios_erp,
    ((e.erp_detalhes ->> 'usuarios_ativos'::text)::numeric) / NULLIF((e.erp_detalhes ->> 'qtd_usuarios'::text)::numeric, 0::numeric) AS ratio_usuarios_ativos,
    COALESCE(m.qtd_filiais, 0) AS qtd_filiais,
    COALESCE(m.grupo_spes_total, 0) AS grupo_spes_total,
    COALESCE(m.grupo_spes_24m, 0) AS grupo_spes_24m,
    COALESCE(m.grupo_ufs, '{}'::text[]) AS grupo_ufs,
    COALESCE(m.obras_ativas, 0) AS obras_ativas,
    COALESCE(m.obras_iniciadas_24m, 0) AS obras_iniciadas_24m,
    COALESCE(m.m2_em_execucao, 0::numeric) AS m2_em_execucao,
    COALESCE(m.tem_contato, false) AS tem_contato,
    COALESCE(e.dominio, u.dominio) AS dominio,
    COALESCE(e.dominio_confianca, u.dominio_confianca) AS dominio_confianca,
    e.dominio_validado_em AS dominio_consultado_em,
    COALESCE(ct.qtd, 0) AS qtd_contatos,
    ct.ult AS contatos_enriquecidos_em,
    pa.tem_protesto,
    pa.consultado_em AS protestos_consultados_em,
    co.cnpj IS NOT NULL AS e_cliente_onepay,
    co.days_without_anticipation AS dias_sem_antecipar,
    co.consumed_pct,
    COALESCE(u.origem_ingestao, 'receita_dump'::text) AS origem_ingestao,
    COALESCE(u.fora_recorte_cnae, false) AS fora_recorte_cnae,

    -- ─── Novas (0069) ─────────────────────────────────────────────────────
    e.faturamento_anual AS faturamento_estimado,
    e.faturamento_origem,
    e.faturamento_confianca,
    e.funcionarios,
    e.funcionarios_origem,
    e.funcionarios_crescimento_12m,
    e.regime_tributario
   FROM mercado_universo u
     LEFT JOIN empresas e ON e.id = u.empresa_id
     LEFT JOIN mercado_metricas m ON m.cnpj = u.cnpj
     LEFT JOIN protestos_atual pa ON pa.cnpj = u.cnpj
     LEFT JOIN clientes_onepay co ON co.cnpj = u.cnpj
     LEFT JOIN LATERAL ( SELECT count(*)::integer AS qtd,
            max(c.enriquecido_em) AS ult
           FROM contatos c
          WHERE c.empresa_id = u.empresa_id) ct ON true;

-- ─── §3 Config ──────────────────────────────────────────────────────────────
-- Tetos do Simples e do presumido mudam por LEI. Ficam em config justamente porque
-- vão mudar, e no dia em que mudarem ninguém vai lembrar de procurá-los no código.

insert into public.radar_config (chave, valor) values
  ('faturamento', jsonb_build_object(
    'teto_simples', 4800000,
    'teto_presumido', 78000000,
    'pct_teto_simples_default', 0.5,
    'variacao_minima_snapshot', 0.10,
    'n_minimo_calibracao_por_tipo', 5
  )),
  ('funcionarios', jsonb_build_object(
    'ttl_dias', 180,
    'custo_unitario', 0
  ))
on conflict (chave) do nothing;
