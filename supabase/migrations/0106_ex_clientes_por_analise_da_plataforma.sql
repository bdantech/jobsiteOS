-- =============================================================================
-- 0106 — Ex-clientes pelas análises de crédito da plataforma (04h)
--
-- Até aqui o sistema sabia quem É cliente (temperature report, 03) e quem nunca
-- foi. Não sabia quem FOI: a saída de um cliente não gera evento nenhum na Onepay,
-- ela simplesmente para de aparecer. O sinal existe, e está no endpoint de análises
-- de crédito — uma análise `approved` que venceu e não foi renovada é a marca que a
-- saída deixa.
--
-- POR QUE UMA TABELA DE ANÁLISES E NÃO SÓ UM FLAG. Porque o "desde quando" e o
-- "quanto ele tinha" moram na análise, e é o que faz a lista de ex-clientes servir
-- para reativação: quem saiu há dois meses com R$ 2 mi de limite aprovado e 80% de
-- consumo é uma conversa; quem saiu há três anos sem nunca consumir é outra. Guardar
-- só `ex_cliente_desde` em `empresas` responderia "quando" e perderia o resto.
--
-- A REGRA DE OURO DA FONTE está em `empresa_cadastrada`: `company.id`/`company.name`
-- nulos querem dizer que houve análise e NUNCA houve cadastro. Não é ex-cliente
-- (nunca foi cliente) — é uma terceira categoria, e a mais quente que existe:
-- análise paga, aprovada, e ninguém operou.
--
-- O MOTIVO DA SAÍDA É HUMANO. O sync detecta o fato e grava "Motivo desconhecido";
-- o porquê alguém preenche. Um default vazio viraria "sem motivo" na contagem, que é
-- indistinguível de "ninguém classificou ainda" — e a pergunta que esta tela existe
-- para responder ("por que perdemos clientes?") morre nessa ambiguidade.
-- =============================================================================

-- ─── As análises da plataforma ──────────────────────────────────────────────

create table public.analises_plataforma (
  id_externo int primary key,          -- analysis.id: a chave natural, idempotente
  cnpj text not null
    constraint analises_plataforma_cnpj_check check (cnpj ~ '^[0-9]{14}$'),

  -- company.id E company.name presentes. É o que separa ex-cliente de
  -- "analisada e nunca cadastrada", e por isso é NOT NULL: um nulo aqui seria
  -- um terceiro estado que a classificação não sabe ler.
  empresa_cadastrada boolean not null,
  onepay_company_id int,
  company_name text,

  status text not null,                -- approved | expired | ... (cru, como vem)
  expiration_date date,

  credit_limit numeric(14,2),
  consumed_limit numeric(14,2),
  available_limit numeric(14,2),
  commission_percent numeric(6,3),
  fee_d0 numeric(6,3),
  min_fee_d0 numeric(6,3),
  fee_d1 numeric(6,3),
  min_fee_d1 numeric(6,3),
  monthly_rate_d0 numeric(6,3),
  monthly_rate_d1 numeric(6,3),
  max_invoice_deadline_days int,
  max_anticipation_value numeric(14,2),
  bill_fine numeric(6,3),
  invest_back jsonb,
  has_insurance boolean,
  has_referral boolean,
  fidc_ready boolean,

  -- O payload inteiro. O endpoint tem mais campos do que as colunas acima, e o
  -- que hoje é "mais um número" pode virar variável de régua amanhã.
  raw jsonb,
  sincronizada_em timestamptz not null default now()
);

comment on table public.analises_plataforma is
  'Análises de crédito da plataforma (role=drawee), aprovadas e expiradas. A fonte de '
  '"quem foi cliente e saiu": uma approved que venceu e não foi renovada é a marca da '
  'saída. Chave natural = analysis.id, então o sync é idempotente.';

comment on column public.analises_plataforma.empresa_cadastrada is
  'company.id E company.name presentes no payload. False = teve análise e NUNCA foi '
  'cadastrada na plataforma: não é ex-cliente, é lead de altíssima temperatura.';

create index analises_plataforma_cnpj_idx on public.analises_plataforma (cnpj, expiration_date desc);
-- A lista "aprovada e nunca cadastrada" e a classificação varrem por status.
create index analises_plataforma_status_idx on public.analises_plataforma (status, expiration_date desc);

alter table public.analises_plataforma enable row level security;

-- Mesma régua de `credito_snapshots`: quem decide crédito e quem prospecta precisam
-- ler; ninguém escreve pela API (só o worker, com service role).
create policy analises_plataforma_select on public.analises_plataforma
  for select to authenticated
  using (public.app_tem_modulo('credito') or public.app_tem_modulo('radar') or public.app_tem_modulo('comercial'));

grant select on public.analises_plataforma to authenticated;

-- ─── O que a empresa passa a carregar ───────────────────────────────────────

alter table public.empresas add column ex_cliente_desde date;
alter table public.empresas add column ex_cliente_motivo uuid references public.motivos_perda (id);
alter table public.empresas add column ex_cliente_motivo_obs text;
alter table public.empresas add column teve_analise_sem_cadastro boolean not null default false;

comment on column public.empresas.ex_cliente_desde is
  'Data de expiração da última análise aprovada. É o dia em que a última porta se '
  'fechou — a menor expiração diria a data de uma análise que foi substituída.';
comment on column public.empresas.ex_cliente_motivo is
  'motivos_perda de contexto `ex_cliente`. Nasce "Motivo desconhecido": o sistema '
  'detecta o fato, o porquê é conhecimento humano.';
comment on column public.empresas.teve_analise_sem_cadastro is
  'Teve análise aprovada e nunca foi cadastrada na plataforma. NÃO mexe no estágio: '
  'não é ex-cliente, nunca foi cliente.';

create index empresas_ex_cliente_desde_idx on public.empresas (ex_cliente_desde desc)
  where ex_cliente_desde is not null;

-- ─── Motivos de churn ───────────────────────────────────────────────────────

alter table public.motivos_perda drop constraint motivos_perda_contexto_check;
alter table public.motivos_perda add constraint motivos_perda_contexto_check
  check (contexto in ('funil_vendedor', 'sdr_sem_fit', 'ex_cliente'));

-- Lista fechada, pela mesma razão da 0091: "outro" com texto livre não vira gráfico,
-- e o motivo da saída é o insumo mais barato que existe para decidir preço e produto.
-- "Motivo desconhecido" é EXPLÍCITO e tem ordem 999 junto com o resto do fim da fila:
-- é o default do detector, e precisa ser contável como tal.
insert into public.motivos_perda (contexto, motivo, ordem) values
  ('ex_cliente', 'Taxa alta / preço', 10),
  ('ex_cliente', 'Inadimplência / default', 20),
  ('ex_cliente', 'Limite insuficiente', 30),
  ('ex_cliente', 'Migrou para concorrente', 40),
  ('ex_cliente', 'Conseguiu crédito mais barato', 50),
  ('ex_cliente', 'Fluxo de caixa melhorou', 60),
  ('ex_cliente', 'Redução de atividade / obras encerradas', 70),
  ('ex_cliente', 'Encerrou atividades / recuperação judicial', 80),
  ('ex_cliente', 'Problemas operacionais / atendimento', 90),
  ('ex_cliente', 'Certificado / cadastro vencido e não renovado', 100),
  ('ex_cliente', 'Relacionamento (troca de gestão)', 110),
  ('ex_cliente', 'Análise não renovada pela plataforma', 120),
  ('ex_cliente', 'Motivo desconhecido', 999)
on conflict (contexto, motivo) do nothing;

-- ─── A fonte de ingestão nova ───────────────────────────────────────────────

alter table public.mercado_ingestoes drop constraint mercado_ingestoes_fonte_check;
alter table public.mercado_ingestoes add constraint mercado_ingestoes_fonte_check
  check (fonte in ('receita_cnpj', 'cno', 'lista', 'onepay_nf', 'onepay_certificados',
                   'onepay_antecipacoes', 'onepay_credit_analyses'));

-- ─── A última análise de cada CNPJ ──────────────────────────────────────────
--
-- `distinct on` pela mesma razão de `protestos_atual`: a pergunta da tela é sempre
-- "qual é o estado hoje", e resolvê-la com um `max()` agregado em cada consulta
-- espalharia a mesma janela por cinco lugares.
--
-- A ordem é por APROVADA primeiro, depois por expiração: entre uma expired de ontem
-- e uma approved de três meses atrás, é a approved que descreve a relação que
-- existiu — e é o limite dela que interessa a quem vai reativar.

create view public.analises_plataforma_atual
with (security_invoker = true) as
  select distinct on (cnpj)
    cnpj,
    id_externo,
    empresa_cadastrada,
    onepay_company_id,
    company_name,
    status,
    expiration_date,
    credit_limit,
    consumed_limit,
    available_limit,
    monthly_rate_d0,
    monthly_rate_d1,
    fee_d0,
    fee_d1,
    max_anticipation_value,
    has_insurance,
    fidc_ready,
    sincronizada_em
  from public.analises_plataforma
  order by cnpj, (status = 'approved') desc, expiration_date desc nulls last, id_externo desc;

grant select on public.analises_plataforma_atual to authenticated;

comment on view public.analises_plataforma_atual is
  'A análise que descreve o CNPJ hoje: aprovada ganha de expirada, depois a mais '
  'recente. É de onde saem "último limite aprovado" e "taxa da última análise" na '
  'lista de ex-clientes.';

-- ─── A lista de ex-clientes ─────────────────────────────────────────────────

create view public.ex_clientes
with (security_invoker = true) as
  select
    e.id as empresa_id,
    e.cnpj,
    coalesce(e.razao_social, e.nome_fantasia, a.company_name) as nome,
    e.ex_cliente_desde,
    -- Meses inteiros: o mês só fecha quando o DIA passa, igual ao `mesesDesde` do
    -- core. Um "há 1 mês" que aparece no dia 20 para quem saiu no dia 25 é errado
    -- nos dois lugares, e aqui é a versão que a ordenação usa.
    case
      when e.ex_cliente_desde is null then null
      else greatest(0, (extract(year from age(current_date, e.ex_cliente_desde)) * 12
                        + extract(month from age(current_date, e.ex_cliente_desde)))::int)
    end as meses_desde,
    e.ex_cliente_motivo,
    m.motivo as ex_cliente_motivo_label,
    e.ex_cliente_motivo_obs,
    e.gestao_operacao,
    e.uf,
    e.municipio,
    a.credit_limit as ultimo_limite,
    a.consumed_limit as consumo_historico,
    a.monthly_rate_d0 as ultima_taxa_d0,
    a.expiration_date as ultima_analise_expirou_em,
    a.status as ultima_analise_status
  from public.empresas e
    left join public.analises_plataforma_atual a on a.cnpj = e.cnpj
    left join public.motivos_perda m on m.id = e.ex_cliente_motivo
  where e.estagio = 'ex_cliente';

grant select on public.ex_clientes to authenticated;

comment on view public.ex_clientes is
  'Quem foi cliente e saiu, com desde quando, último limite, consumo histórico e a '
  'taxa que tinha. Ordenar por ex_cliente_desde desc é o padrão da tela: quem saiu '
  'ontem é mais quente para reativação do que quem saiu em 2023.';

-- ─── Analisadas e nunca cadastradas ─────────────────────────────────────────
--
-- Parte de `analises_plataforma`, não de `empresas`: a empresa pode nem existir
-- ainda (o sync enfileira o lookup, que leva tempo), e a lista não pode esperar o
-- cadastro para mostrar o lead — o valor dela é justamente a antecedência.

create view public.analises_sem_cadastro
with (security_invoker = true) as
  select
    a.cnpj,
    coalesce(mu.razao_social, a.company_name) as nome,
    e.id as empresa_id,
    a.status,
    a.expiration_date,
    a.expiration_date >= current_date as vigente,
    a.credit_limit,
    a.monthly_rate_d0,
    mu.uf,
    mu.municipio,
    a.sincronizada_em
  from public.analises_plataforma_atual a
    left join public.mercado_universo mu on mu.cnpj = a.cnpj
    left join public.empresas e on e.cnpj = a.cnpj
  where not a.empresa_cadastrada
    and a.status = 'approved';

grant select on public.analises_sem_cadastro to authenticated;

comment on view public.analises_sem_cadastro is
  'Análise aprovada e nunca cadastrada na plataforma: alguém pagou a análise, o '
  'crédito saiu, e a empresa nunca operou. Não é ex-cliente — é a prospecção mais '
  'quente que existe.';

-- ─── O motivo, definido à mão ───────────────────────────────────────────────

create or replace function public.app_definir_ex_cliente_motivo(p jsonb)
returns public.empresas
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_emp public.empresas;
  v_ator uuid := auth.uid();
  v_empresa uuid := (p ->> 'empresa_id')::uuid;
  v_motivo uuid := nullif(p ->> 'motivo_id', '')::uuid;
  v_obs text := nullif(btrim(coalesce(p ->> 'observacao', '')), '');
  v_label text;
begin
  -- Comercial e Crédito classificam a saída; é conhecimento dos dois lados.
  if not (public.app_tem_modulo('comercial') or public.app_tem_modulo('credito')
          or public.app_tem_modulo('radar')) then
    raise exception 'Sem acesso para classificar a saída deste cliente.' using errcode = '42501';
  end if;

  if v_motivo is null then
    raise exception 'Informe o motivo.' using errcode = '23514';
  end if;

  -- O motivo TEM de ser do contexto certo. Sem esta checagem, um id de
  -- 'funil_vendedor' entraria e o gráfico de churn passaria a somar "Sem
  -- documentação" — um motivo de venda perdida, não de cliente que saiu.
  select m.motivo into v_label
    from public.motivos_perda m
   where m.id = v_motivo and m.contexto = 'ex_cliente' and m.ativo;
  if v_label is null then
    raise exception 'Motivo inválido para saída de cliente.' using errcode = '23514';
  end if;

  update public.empresas
     set ex_cliente_motivo = v_motivo,
         ex_cliente_motivo_obs = v_obs
   where id = v_empresa
  returning * into v_emp;

  if v_emp.id is null then
    raise exception 'Empresa não encontrada.' using errcode = 'P0002';
  end if;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (
    v_emp.id, 'excliente.motivo_definido',
    jsonb_build_object(
      'titulo', 'Motivo de saída definido',
      'resumo', coalesce(v_emp.razao_social, v_emp.cnpj) || ' saiu por: ' || v_label
                || coalesce(' — ' || v_obs, ''),
      'url', '/empresas/' || v_emp.id::text,
      'motivo', v_label
    ),
    v_ator
  );

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'excliente.motivo_definido', 'empresas', v_emp.id::text, p);

  return v_emp;
end; $$;

comment on function public.app_definir_ex_cliente_motivo(jsonb) is
  'Classifica POR QUE o cliente saiu. Exige um motivo do contexto ex_cliente — um id '
  'de outro contexto envenenaria o gráfico de churn com motivos de venda perdida.';

revoke all on function public.app_definir_ex_cliente_motivo(jsonb) from public;
grant execute on function public.app_definir_ex_cliente_motivo(jsonb) to authenticated;

-- ─── A distribuição de motivos ──────────────────────────────────────────────
--
-- RPC e não view porque a tela pede um recorte de período, e um filtro de data sobre
-- uma view agregada obrigaria a agregar tudo para depois jogar fora.

create or replace function public.ex_clientes_por_motivo(p_meses int default 12)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(t order by t.total desc), '[]'::jsonb)
  from (
    select
      coalesce(m.motivo, 'Não classificado') as motivo,
      count(*)::int as total
    from public.empresas e
      left join public.motivos_perda m on m.id = e.ex_cliente_motivo
    where e.estagio = 'ex_cliente'
      and (p_meses is null
           or e.ex_cliente_desde is null
           or e.ex_cliente_desde >= (current_date - make_interval(months => p_meses)))
    group by 1
  ) t;
$$;

comment on function public.ex_clientes_por_motivo(int) is
  'Contagem de ex-clientes por motivo de saída na janela. "Não classificado" aparece '
  'como categoria própria: é diferente de "Motivo desconhecido", que é uma resposta.';

grant execute on function public.ex_clientes_por_motivo(int) to authenticated;

-- ─── O explorador ganha as variáveis ────────────────────────────────────────
--
-- `create or replace` com as colunas NO FIM. São o que permite o segmento "saíram
-- por taxa alta", que é o alvo de campanha de reativação com proposta recalibrada.

create or replace view public.mercado_explorador
with (security_invoker = true) as
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
    e.limite_potencial,
    e.receita_mensal_prevista,
    e.valor_esperado_mensal,
    e.score_credito,
    e.chance_concessao,
    e.score_faixa AS faixa_score,
    COALESCE(av.tem_analise_vigente, false) AS tem_analise_vigente,
    av.analise_estagio,
    -- 04h: o estágio já diz `ex_cliente`, mas um booleano dedicado é o que permite
    -- combinar "é ex-cliente E tem obra ativa" sem gastar o filtro de estágio.
    COALESCE(e.estagio = 'ex_cliente', false) AS e_ex_cliente,
    e.ex_cliente_desde,
    -- Em MESES, e não a data: a pergunta de campanha é "saiu há menos de 6 meses",
    -- e escrever isso com uma data obriga a pessoa a fazer a conta de cabeça.
    CASE
      WHEN e.ex_cliente_desde IS NULL THEN NULL::int
      ELSE GREATEST(0, (extract(year from age(current_date, e.ex_cliente_desde)) * 12
                        + extract(month from age(current_date, e.ex_cliente_desde)))::int)
    END AS ex_cliente_meses,
    mp.motivo AS ex_cliente_motivo,
    COALESCE(e.teve_analise_sem_cadastro, false) AS teve_analise_sem_cadastro,
    apa.credit_limit AS ultima_analise_limite,
    apa.expiration_date AS ultima_analise_expirou_em
   FROM mercado_universo u
     LEFT JOIN empresas e ON e.id = u.empresa_id
     LEFT JOIN mercado_metricas m ON m.cnpj = u.cnpj
     LEFT JOIN protestos_atual pa ON pa.cnpj = u.cnpj
     LEFT JOIN clientes_onepay co ON co.cnpj = u.cnpj
     LEFT JOIN analise_vigente av ON av.cnpj = u.cnpj
     LEFT JOIN motivos_perda mp ON mp.id = e.ex_cliente_motivo
     LEFT JOIN analises_plataforma_atual apa ON apa.cnpj = u.cnpj
     LEFT JOIN LATERAL ( SELECT count(*)::integer AS qtd,
            max(c.enriquecido_em) AS ult
           FROM contatos c
          WHERE c.empresa_id = u.empresa_id) ct ON true;

-- ─── Notificações ───────────────────────────────────────────────────────────

insert into public.notificacao_regras (tipo_evento, perfil_id, ativo)
select 'cliente.tornou_ex', p.id, true
from public.perfis p where p.nome in ('Admin', 'Comercial')
on conflict do nothing;

-- Conflito é problema de DADO, não de venda: quem resolve é quem administra as
-- fontes, e mandar para o Comercial só produziria um alerta que ninguém aciona.
insert into public.notificacao_regras (tipo_evento, perfil_id, ativo)
select 'excliente.conflito_dados', p.id, true
from public.perfis p where p.nome = 'Admin'
on conflict do nothing;
