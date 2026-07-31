-- 0073 — Crédito: limite potencial, scorecard e esteira de análise (Prompt 04d).
--
-- Três coisas encadeadas, e a ordem importa:
--   faturamento estimado (04c) → limite potencial → receita prevista → valor esperado
--                                                  ×  chance de concessão (scorecard)
--
-- O valor esperado é o ponto: "R$ esperados por mês" é uma régua que substitui "parece
-- bom" na hora de ordenar a base. Mas ele só vale se cada elo declarar sua própria
-- ignorância — por isso a confiança PROPAGA do faturamento para o limite, o score se
-- recusa a sair quando a completude é baixa, e nada disto inventa número quando falta a
-- calibração. Ver §4 desta migração e docs/credito.md.
--
-- ESCOPO: SACADOS (tipo in ('construtora','incorporadora')). Fornecedor tem outra
-- pergunta (adesão), que não é esta.

-- ─── §1 Configuração ────────────────────────────────────────────────────────
-- Tabela própria, mesmo desenho de `radar_config`: chave/valor jsonb, uma linha por
-- assunto. Separada do Radar porque o dono é outro (perfil Crédito) e porque a tela de
-- ajuste é outra — misturar faria a mesma tabela precisar de duas RLS.

create table public.credito_config (
  chave text primary key,
  valor jsonb not null,
  atualizado_por uuid references public.usuarios (id),
  atualizado_em timestamptz not null default now()
);

alter table public.credito_config enable row level security;

create policy credito_config_select on public.credito_config
  for select using (public.app_tem_modulo('credito'));

grant select on public.credito_config to authenticated;

insert into public.credito_config (chave, valor) values
  ('economia', jsonb_build_object(
    'taxa_padrao_am', 1.9,
    'tac', 150.00,
    'valor_medio_nf', 25000.00,
    'prazo_medio_dias', 45,
    -- null = usar o calibrado da carteira (§2.1). Override manual continua possível.
    'giro_mensal', null
  )),
  ('limite', jsonb_build_object(
    'ratio_limite_manual', null,
    'cap_absoluto', 5000000,
    'cap_pct_faturamento', 0.15
  )),
  ('scorecard', jsonb_build_object(
    'corte_concessao', 40,
    'completude_minima', 0.5,
    'recencia_protesto_dias', 90,
    'knockout_negada_meses', 6,
    -- Faixa → probabilidade. É o que transforma um score numa multiplicação de R$.
    'chance_por_faixa', jsonb_build_object('alta', 0.8, 'media', 0.5, 'improvavel', 0.1),
    -- Sem score, o valor esperado usa isto E marca a flag `chance_presumida`.
    'chance_sem_score', 0.5
  )),
  ('docs', jsonb_build_object(
    'tipos', jsonb_build_array(
      jsonb_build_object('id', 'balanco', 'label', 'Balanço patrimonial', 'obrigatorio', true),
      jsonb_build_object('id', 'dre', 'label', 'DRE', 'obrigatorio', true),
      jsonb_build_object('id', 'faturamento_declarado', 'label', 'Faturamento declarado', 'obrigatorio', false),
      jsonb_build_object('id', 'contrato_social', 'label', 'Contrato social', 'obrigatorio', true),
      jsonb_build_object('id', 'outros', 'label', 'Outros', 'obrigatorio', false)
    )
  )),
  ('atradius', jsonb_build_object(
    'poll_intervalo_horas', 6,
    'validade_padrao_meses', 12
  ))
on conflict (chave) do nothing;

comment on table public.credito_config is
  'Parâmetros de economia, limite, scorecard e esteira. Editável pela tela de Crédito '
  '(perfil Crédito). Nada aqui é constante de código porque tudo aqui muda com o negócio.';

-- ─── §2 Calibração versionada do limite ─────────────────────────────────────
-- Mesmo padrão do estimador (04c) e das regras da pirâmide: versão nova a cada
-- calibração, nunca update. Sem isso não há como responder "por que o limite potencial
-- desta empresa mudou?", que é a primeira pergunta quando o número muda.

create table public.credito_versoes (
  id uuid primary key default gen_random_uuid(),
  versao int not null unique,
  -- { ratio_limite: { global, porTipo }, giro_mensal, n_amostras: {...} }
  coeficientes jsonb not null,
  n_amostras_por_tipo jsonb not null default '{}'::jsonb,
  ativa boolean not null default true,
  calibrado_em timestamptz not null default now()
);

create index credito_versoes_ativa_idx on public.credito_versoes (calibrado_em desc) where ativa;

alter table public.credito_versoes enable row level security;

create policy credito_versoes_select on public.credito_versoes
  for select using (public.app_tem_modulo('credito') or public.app_tem_modulo('radar'));

grant select on public.credito_versoes to authenticated;

comment on table public.credito_versoes is
  'ratio_limite (limite/faturamento declarado) e giro_mensal (volume/limite), medidos na '
  'carteira real. Versionado: a estimativa grava a versão que usou.';

-- ─── §3 Scorecard ───────────────────────────────────────────────────────────

create table public.scorecard_versoes (
  id uuid primary key default gen_random_uuid(),
  versao int not null unique,
  -- { fatores: { <id>: { peso, faixas|casos, ... } } }. A LÓGICA de cada fator mora no
  -- core (packages/core/src/credito/score.ts) e é fixa por id; o que é editável são os
  -- pesos, os limiares e os pontos. Um jsonb que carregasse a lógica seria uma
  -- linguagem de expressão dentro do banco — e nenhum teste alcançaria as versões que
  -- alguém salvar depois.
  definicao jsonb not null,
  nome text,
  ativa boolean not null default false,
  criada_por uuid references public.usuarios (id),
  criada_em timestamptz not null default now()
);

-- Uma só ativa por vez. O índice parcial único é o que torna "duas versões ativas"
-- inexprimível, em vez de apenas improvável.
create unique index scorecard_versoes_uma_ativa_idx on public.scorecard_versoes ((ativa)) where ativa;

create table public.empresa_scores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas (id) on delete set null,
  cnpj text not null
    constraint empresa_scores_cnpj_check check (cnpj ~ '^[0-9]{14}$'),
  -- NULL quando a completude não alcança o mínimo. NULL aqui é uma afirmação: "não sei",
  -- que é diferente de zero ("sei que é ruim").
  score numeric(5, 2),
  completude numeric(4, 3) not null,
  faixa text not null
    constraint empresa_scores_faixa_check
    check (faixa in ('alta', 'media', 'improvavel', 'dados_insuficientes')),
  knockout text
    constraint empresa_scores_knockout_check
    check (knockout is null or knockout in ('situacao_irregular', 'negada_recente')),
  breakdown jsonb not null default '{}'::jsonb,
  scorecard_versao int,
  calculado_em timestamptz not null default now()
);

create index empresa_scores_serie_idx on public.empresa_scores (cnpj, calculado_em desc);
create index empresa_scores_empresa_idx on public.empresa_scores (empresa_id) where empresa_id is not null;

comment on table public.empresa_scores is
  'Série de scores, append-only. O breakdown guarda fator a fator o valor observado, a '
  'faixa e os pontos — é o que permite explicar um score de seis meses atrás.';

alter table public.scorecard_versoes enable row level security;
alter table public.empresa_scores enable row level security;

create policy scorecard_versoes_select on public.scorecard_versoes
  for select using (public.app_tem_modulo('credito'));

-- O score é lido por quem trabalha a empresa, não só por Crédito: ele existe para
-- ordenar a prospecção. Escrita é só por RPC/service role.
create policy empresa_scores_select on public.empresa_scores
  for select using (
    public.app_tem_modulo('credito') or public.app_tem_modulo('empresas')
    or public.app_tem_modulo('mercado') or public.app_tem_modulo('antecipacao')
  );

grant select on public.scorecard_versoes, public.empresa_scores to authenticated;

-- ─── §4 Esteira de análise ──────────────────────────────────────────────────

create table public.analises_credito (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas (id) on delete set null,
  cnpj text not null
    constraint analises_credito_cnpj_check check (cnpj ~ '^[0-9]{14}$'),
  estagio text not null default 'rascunho'
    constraint analises_credito_estagio_check check (estagio in (
      'rascunho', 'solicitada', 'docs_pendentes', 'enviada_seguradora', 'em_analise',
      'aprovada', 'aprovada_parcial', 'negada', 'expirada', 'cancelada'
    )),
  limite_solicitado numeric(14, 2),
  limite_aprovado numeric(14, 2),
  moeda text not null default 'BRL',
  seguradora text not null default 'atradius',
  atradius_buyer_id text,
  atradius_case_id text,
  rating_seguradora text,
  observacoes text,
  decidida_em timestamptz,
  expira_em date,
  motivo text,
  origem text not null default 'jobsiteos'
    constraint analises_credito_origem_check check (origem in ('jobsiteos', 'atradius_backfill')),
  solicitada_por uuid references public.usuarios (id),
  criada_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now()
);

create index analises_credito_cnpj_idx on public.analises_credito (cnpj, criada_em desc);
create index analises_credito_estagio_idx on public.analises_credito (estagio);
-- O poll do worker varre por case aberto; sem isto ele varreria a tabela inteira.
create index analises_credito_case_idx on public.analises_credito (atradius_case_id)
  where atradius_case_id is not null;

create table public.analise_docs (
  id uuid primary key default gen_random_uuid(),
  analise_id uuid not null references public.analises_credito (id) on delete cascade,
  tipo text not null,
  arquivo_url text not null,
  nome_arquivo text,
  enviado_por uuid references public.usuarios (id),
  enviado_em timestamptz not null default now()
);

create index analise_docs_analise_idx on public.analise_docs (analise_id);

alter table public.analises_credito enable row level security;
alter table public.analise_docs enable row level security;

create policy analises_credito_select on public.analises_credito
  for select using (public.app_tem_modulo('credito') or public.app_tem_modulo('empresas'));

create policy analise_docs_select on public.analise_docs
  for select using (public.app_tem_modulo('credito'));

grant select on public.analises_credito, public.analise_docs to authenticated;

comment on table public.analises_credito is
  'Esteira de análise de crédito. `origem = atradius_backfill` marca o que veio da '
  'apólice e não foi pedido por aqui — a distinção importa para não creditar à esteira '
  'decisões que ela não tomou.';

-- ─── §4 Bucket privado dos documentos ───────────────────────────────────────
-- Balanço e DRE são dados financeiros de terceiro. Bucket privado, e o caminho começa
-- pelo id da análise para a policy conseguir amarrar o objeto ao módulo.

insert into storage.buckets (id, name, public)
values ('analise-docs', 'analise-docs', false)
on conflict (id) do nothing;

create policy analise_docs_storage_select on storage.objects
  for select to authenticated
  using (bucket_id = 'analise-docs' and public.app_tem_modulo('credito'));

create policy analise_docs_storage_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'analise-docs' and public.app_tem_modulo('credito'));

create policy analise_docs_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'analise-docs' and public.app_tem_modulo('credito'));

-- ─── §2/§3 Cache em `empresas` ──────────────────────────────────────────────
-- O catálogo de filtros exige COLUNA (é o contrato), e o Explorador varre o universo
-- inteiro: uma lateral por linha sobre as séries seria paga em toda varredura.

alter table public.empresas
  add column limite_potencial numeric(16, 2),
  -- HERDA a confiança do faturamento. Um limite derivado de uma estimativa `baixa` não
  -- vira `alta` por passar por uma multiplicação — propagar é a única leitura honesta.
  add column limite_confianca text,
  add column receita_mensal_prevista numeric(14, 2),
  add column valor_esperado_mensal numeric(14, 2),
  add column credito_calculado_em timestamptz,
  add column credito_versao int,
  add column score_credito numeric(5, 2),
  add column score_completude numeric(4, 3),
  add column score_faixa text,
  add column chance_concessao numeric(4, 3),
  add column score_calculado_em timestamptz;

comment on column public.empresas.limite_confianca is
  'Herdada de faturamento_confianca. Uma multiplicação não cria informação: se o '
  'faturamento é chute, o limite é chute com outra unidade.';
comment on column public.empresas.valor_esperado_mensal is
  'receita_mensal_prevista × chance_concessao. É a régua de ordenação do Explorador e '
  'do SOM — R$ esperados por mês no lugar de "parece bom".';

-- Ordenação default do Explorador (§5). NULLS LAST no índice para casar com a query.
create index empresas_valor_esperado_idx on public.empresas (valor_esperado_mensal desc nulls last)
  where valor_esperado_mensal is not null;

-- As duas novas métricas entram na MESMA série do 04c: mesma regra de variação mínima,
-- mesma tela de histórico, mesma pergunta ("está crescendo?").
alter table public.empresa_metricas drop constraint empresa_metricas_metrica_check;
alter table public.empresa_metricas add constraint empresa_metricas_metrica_check
  check (metrica in ('faturamento_anual', 'funcionarios', 'limite_potencial', 'receita_prevista'));

-- ─── §4 A análise vigente, por CNPJ ─────────────────────────────────────────
-- Mesmo padrão de `protestos_atual`: uma linha por CNPJ, para o Explorador fazer LEFT
-- JOIN em vez de uma lateral com `order by ... limit 1` sobre 740 mil linhas.

create or replace view public.analise_vigente with (security_invoker = true) as
select distinct on (a.cnpj)
  a.cnpj,
  a.id as analise_id,
  a.estagio as analise_estagio,
  a.limite_aprovado,
  a.expira_em,
  a.decidida_em,
  -- "Vigente" = aprovada e ainda dentro da validade. É o que o fator "histórico de
  -- análises" do scorecard lê, e o que a esteira usa para não pedir duas vezes.
  (a.estagio in ('aprovada', 'aprovada_parcial')
   and (a.expira_em is null or a.expira_em >= current_date)) as tem_analise_vigente
from public.analises_credito a
order by a.cnpj, a.criada_em desc;

grant select on public.analise_vigente to authenticated;

comment on view public.analise_vigente is
  'A análise mais recente de cada CNPJ. Existe para o Explorador não pagar uma lateral '
  'por linha do universo.';

-- ─── §5 As novas variáveis no Explorador ────────────────────────────────────
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
    e.faturamento_anual AS faturamento_estimado,
    e.faturamento_origem,
    e.faturamento_confianca,
    e.funcionarios,
    e.funcionarios_origem,
    e.funcionarios_crescimento_12m,
    e.regime_tributario,

    -- ─── Novas (0073) ─────────────────────────────────────────────────────
    e.limite_potencial,
    e.receita_mensal_prevista,
    e.valor_esperado_mensal,
    e.score_credito,
    e.chance_concessao,
    e.score_faixa AS faixa_score,
    COALESCE(av.tem_analise_vigente, false) AS tem_analise_vigente,
    av.analise_estagio
   FROM mercado_universo u
     LEFT JOIN empresas e ON e.id = u.empresa_id
     LEFT JOIN mercado_metricas m ON m.cnpj = u.cnpj
     LEFT JOIN protestos_atual pa ON pa.cnpj = u.cnpj
     LEFT JOIN clientes_onepay co ON co.cnpj = u.cnpj
     LEFT JOIN analise_vigente av ON av.cnpj = u.cnpj
     LEFT JOIN LATERAL ( SELECT count(*)::integer AS qtd,
            max(c.enriquecido_em) AS ult
           FROM contatos c
          WHERE c.empresa_id = u.empresa_id) ct ON true;

-- ─── §4.2 Escrita da esteira ────────────────────────────────────────────────
-- DEFINER e um RPC por transição, e não grant de update na tabela: a esteira tem regras
-- (só Crédito envia à seguradora; a decisão vem do worker, nunca da tela) e uma tabela
-- com update aberto tornaria "pular de rascunho para aprovada" apenas improvável em vez
-- de impossível.

create or replace function public.app_solicitar_analise(p jsonb)
returns public.analises_credito language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_empresa public.empresas;
  v_linha public.analises_credito;
  v_limite numeric := nullif(p ->> 'limite_solicitado', '')::numeric;
begin
  if not (public.app_tem_modulo('credito') or public.app_tem_modulo('empresas')) then
    raise exception 'Sem acesso para solicitar análise de crédito.' using errcode = '42501';
  end if;

  select * into v_empresa from public.empresas where id = (p ->> 'empresa_id')::uuid;
  if v_empresa.id is null then
    raise exception 'Empresa não encontrada.' using errcode = 'no_data_found';
  end if;

  -- Escopo do prompt: a pergunta "quanto de limite" só existe para sacado. Fornecedor
  -- tem outra pergunta (adesão) e deixá-lo entrar aqui encheria a esteira de análises
  -- que ninguém vai submeter.
  if v_empresa.tipo not in ('construtora', 'incorporadora') then
    raise exception 'Análise de crédito é para sacados (construtora/incorporadora).'
      using errcode = '22023';
  end if;

  -- Uma análise aberta por vez. Duas em paralelo viram duas submissões à seguradora
  -- para o mesmo buyer — e a segunda pode ser cobrada.
  if exists (
    select 1 from public.analises_credito a
    where a.cnpj = v_empresa.cnpj
      and a.estagio in ('rascunho', 'solicitada', 'docs_pendentes', 'enviada_seguradora', 'em_analise')
  ) then
    raise exception 'Já existe uma análise em andamento para este CNPJ.' using errcode = '23505';
  end if;

  insert into public.analises_credito (
    empresa_id, cnpj, estagio, limite_solicitado, observacoes, solicitada_por
  )
  values (
    v_empresa.id, v_empresa.cnpj, 'solicitada',
    coalesce(v_limite, v_empresa.limite_potencial),
    nullif(p ->> 'observacoes', ''),
    v_ator
  )
  returning * into v_linha;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (
    v_empresa.id, 'analise.solicitada',
    jsonb_build_object(
      'titulo', 'Análise de crédito solicitada',
      'resumo', 'Limite solicitado: R$ ' ||
                to_char(coalesce(v_linha.limite_solicitado, 0), 'FM999G999G999G990D00') || '.',
      'url', '/credito/analises/' || v_linha.id,
      'analise_id', v_linha.id
    ),
    v_ator
  );

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'analise.solicitada', 'analises_credito', v_linha.id::text, p);

  return v_linha;
end; $$;

/**
 * Transições feitas por HUMANO. As que vêm da seguradora (enviada → em análise →
 * decidida) são do worker, com service role, e não passam por aqui de propósito: um
 * atalho de tela para "aprovada" produziria um limite que a apólice não conhece.
 */
create or replace function public.app_mover_analise(p jsonb)
returns public.analises_credito language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_linha public.analises_credito;
  v_novo text := p ->> 'estagio';
begin
  if not public.app_tem_modulo('credito') then
    raise exception 'Sem acesso ao módulo Crédito.' using errcode = '42501';
  end if;
  if v_novo not in ('rascunho', 'solicitada', 'docs_pendentes', 'cancelada') then
    raise exception 'Estágio % não pode ser definido à mão.', v_novo using errcode = '22023';
  end if;

  select * into v_linha from public.analises_credito where id = (p ->> 'id')::uuid;
  if v_linha.id is null then
    raise exception 'Análise não encontrada.' using errcode = 'no_data_found';
  end if;
  if v_linha.estagio in ('aprovada', 'aprovada_parcial', 'negada', 'expirada') then
    raise exception 'Análise já decidida não volta para a esteira.' using errcode = '22023';
  end if;

  update public.analises_credito set
    estagio = v_novo,
    limite_solicitado = coalesce(nullif(p ->> 'limite_solicitado', '')::numeric, limite_solicitado),
    observacoes = coalesce(nullif(p ->> 'observacoes', ''), observacoes),
    atualizada_em = now()
  where id = v_linha.id
  returning * into v_linha;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (
    v_linha.empresa_id, 'analise.movida',
    jsonb_build_object(
      'titulo', 'Análise de crédito movida',
      'resumo', 'Estágio: ' || v_novo || '.',
      'url', '/credito/analises/' || v_linha.id,
      'analise_id', v_linha.id, 'estagio', v_novo
    ),
    v_ator
  );

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'analise.movida', 'analises_credito', v_linha.id::text, p);

  return v_linha;
end; $$;

create or replace function public.app_registrar_doc_analise(p jsonb)
returns public.analise_docs language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_analise public.analises_credito;
  v_doc public.analise_docs;
begin
  if not public.app_tem_modulo('credito') then
    raise exception 'Sem acesso ao módulo Crédito.' using errcode = '42501';
  end if;

  select * into v_analise from public.analises_credito where id = (p ->> 'analise_id')::uuid;
  if v_analise.id is null then
    raise exception 'Análise não encontrada.' using errcode = 'no_data_found';
  end if;

  insert into public.analise_docs (analise_id, tipo, arquivo_url, nome_arquivo, enviado_por)
  values (
    v_analise.id, p ->> 'tipo', p ->> 'arquivo_url', nullif(p ->> 'nome_arquivo', ''), v_ator
  )
  returning * into v_doc;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'analise.doc_enviado', 'analise_docs', v_doc.id::text, p);

  return v_doc;
end; $$;

-- ─── §3.1 Escrita do scorecard ──────────────────────────────────────────────

create or replace function public.app_salvar_scorecard_versao(p jsonb)
returns public.scorecard_versoes language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_linha public.scorecard_versoes;
  v_versao int;
begin
  if not public.app_tem_modulo('credito') then
    raise exception 'Sem acesso ao módulo Crédito.' using errcode = '42501';
  end if;

  select coalesce(max(versao), 0) + 1 into v_versao from public.scorecard_versoes;

  insert into public.scorecard_versoes (versao, definicao, nome, ativa, criada_por)
  values (v_versao, p -> 'definicao', nullif(p ->> 'nome', ''), false, v_ator)
  returning * into v_linha;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'scorecard.versao_criada', 'scorecard_versoes', v_linha.id::text, p);

  return v_linha;
end; $$;

create or replace function public.app_ativar_scorecard_versao(p jsonb)
returns public.scorecard_versoes language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_linha public.scorecard_versoes;
begin
  if not public.app_tem_modulo('credito') then
    raise exception 'Sem acesso ao módulo Crédito.' using errcode = '42501';
  end if;

  -- Desativa TODAS antes de ativar: o índice único parcial recusaria a segunda ativa,
  -- e recusar com erro de constraint seria uma mensagem que ninguém entende.
  update public.scorecard_versoes set ativa = false where ativa;

  update public.scorecard_versoes set ativa = true where id = (p ->> 'id')::uuid
  returning * into v_linha;

  if v_linha.id is null then
    raise exception 'Versão não encontrada.' using errcode = 'no_data_found';
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'scorecard.versao_ativada', 'scorecard_versoes', v_linha.id::text, p);

  return v_linha;
end; $$;

create or replace function public.app_salvar_credito_config(p jsonb)
returns public.credito_config language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_linha public.credito_config;
begin
  if not public.app_tem_modulo('credito') then
    raise exception 'Sem acesso ao módulo Crédito.' using errcode = '42501';
  end if;

  insert into public.credito_config (chave, valor, atualizado_por, atualizado_em)
  values (p ->> 'chave', p -> 'valor', v_ator, now())
  on conflict (chave) do update
    set valor = excluded.valor, atualizado_por = excluded.atualizado_por, atualizado_em = now()
  returning * into v_linha;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'credito.config_salva', 'credito_config', v_linha.chave, p);

  return v_linha;
end; $$;

revoke execute on function public.app_solicitar_analise(jsonb) from public;
revoke execute on function public.app_mover_analise(jsonb) from public;
revoke execute on function public.app_registrar_doc_analise(jsonb) from public;
revoke execute on function public.app_salvar_scorecard_versao(jsonb) from public;
revoke execute on function public.app_ativar_scorecard_versao(jsonb) from public;
revoke execute on function public.app_salvar_credito_config(jsonb) from public;

grant execute on function public.app_solicitar_analise(jsonb) to authenticated, service_role;
grant execute on function public.app_mover_analise(jsonb) to authenticated, service_role;
grant execute on function public.app_registrar_doc_analise(jsonb) to authenticated, service_role;
grant execute on function public.app_salvar_scorecard_versao(jsonb) to authenticated, service_role;
grant execute on function public.app_ativar_scorecard_versao(jsonb) to authenticated, service_role;
grant execute on function public.app_salvar_credito_config(jsonb) to authenticated, service_role;

-- ─── §3.3 Scorecard versão 1 (seed) ─────────────────────────────────────────
-- `faixas` são limiares por LIMITE SUPERIOR inclusive, com `ate: null` fechando o
-- intervalo aberto. `casos` são baldes nomeados. A escolha entre os dois é fixa por
-- fator no core; a UI edita peso, limiares e pontos.

insert into public.scorecard_versoes (versao, definicao, nome, ativa)
values (1, jsonb_build_object(
  'fatores', jsonb_build_object(
    'protestos', jsonb_build_object(
      'peso', 25,
      -- ratio = valor de protestos ÷ faturamento estimado (fallback: ÷ capital social).
      'faixas', jsonb_build_array(
        jsonb_build_object('ate', 0,      'pontos', 25),
        jsonb_build_object('ate', 0.005,  'pontos', 15),
        jsonb_build_object('ate', 0.02,   'pontos', 5),
        jsonb_build_object('ate', null,   'pontos', 0)
      ),
      -- Protesto recente vale metade dos pontos: dívida velha e dívida de ontem não
      -- dizem a mesma coisa sobre pagar amanhã.
      'recencia_divisor', 2
    ),
    'faturamento', jsonb_build_object(
      'peso', 15,
      'faixas', jsonb_build_array(
        jsonb_build_object('ate', 1000000,  'pontos', 2),
        jsonb_build_object('ate', 4800000,  'pontos', 5),
        jsonb_build_object('ate', 10000000, 'pontos', 8),
        jsonb_build_object('ate', 50000000, 'pontos', 12),
        jsonb_build_object('ate', null,     'pontos', 15)
      )
    ),
    'atividade_grupo', jsonb_build_object(
      'peso', 15,
      'casos', jsonb_build_object('forte', 15, 'fraca', 8, 'zerada', 3)
    ),
    'idade', jsonb_build_object(
      'peso', 10,
      'faixas', jsonb_build_array(
        jsonb_build_object('ate', 2,    'pontos', 0),
        jsonb_build_object('ate', 5,    'pontos', 4),
        jsonb_build_object('ate', 10,   'pontos', 7),
        jsonb_build_object('ate', null, 'pontos', 10)
      )
    ),
    'regularidade', jsonb_build_object(
      'peso', 10,
      'casos', jsonb_build_object('limpa', 10, 'com_historico', 4)
    ),
    'historico_analises', jsonb_build_object(
      'peso', 10,
      'casos', jsonb_build_object(
        'aprovada_vigente', 10, 'aprovada_expirada', 7, 'nunca', 5, 'aprovada_parcial', 4
      )
    ),
    'crescimento_headcount', jsonb_build_object(
      'peso', 5,
      'faixas', jsonb_build_array(
        jsonb_build_object('ate', -0.15, 'pontos', 0),
        jsonb_build_object('ate', 0.15,  'pontos', 3),
        jsonb_build_object('ate', null,  'pontos', 5)
      )
    ),
    'capital_social', jsonb_build_object(
      'peso', 5,
      'faixas', jsonb_build_array(
        jsonb_build_object('ate', 1000000, 'pontos', 1),
        jsonb_build_object('ate', 5000000, 'pontos', 3),
        jsonb_build_object('ate', null,    'pontos', 5)
      )
    ),
    'certificado_digital', jsonb_build_object(
      'peso', 5,
      'casos', jsonb_build_object('ativo', 5, 'vencido', 2, 'nunca', 0)
    )
  )
), 'Seed 04d', true)
on conflict (versao) do nothing;

-- ─── §6 Regras de notificação ───────────────────────────────────────────────
-- Decisões vão para o perfil Crédito; limite reduzido vai para Admin também, porque é
-- sinal de risco de primeira grandeza e não pode depender de alguém estar olhando.

insert into public.notificacao_regras (tipo_evento, perfil_id, ativo)
select t.tipo, p.id, true
from (values
  ('analise.aprovada'), ('analise.aprovada_parcial'), ('analise.negada'),
  ('analise.expirada'), ('analise.limite_reduzido')
) as t(tipo)
cross join public.perfis p
where p.nome = 'Crédito'
on conflict do nothing;

insert into public.notificacao_regras (tipo_evento, perfil_id, ativo)
select 'analise.limite_reduzido', p.id, true
from public.perfis p where p.nome = 'Admin'
on conflict do nothing;

-- ─── Módulo `credito` para o perfil que já existe ───────────────────────────

insert into public.perfil_modulos (perfil_id, modulo_id)
select p.id, 'credito' from public.perfis p where p.nome in ('Admin', 'Crédito')
on conflict do nothing;
