-- 0122 — Análise de crédito proprietária (Prompt 04j).
--
-- APLICADA EM QUATRO PARTES no banco (`0122a_analise_propria_tabelas` …
-- `0122d_analise_propria_painel`), para localizar a falha caso alguma parte fosse
-- recusada. Este arquivo é o conteúdo completo, na mesma ordem.
--
-- ─── O QUE ESTA MIGRAÇÃO ACRESCENTA À ESTEIRA DO 04d ────────────────────────
-- A esteira (0073) responde "o que a SEGURADORA disse". Esta migração acrescenta a
-- segunda leitura: "o que NÓS dizemos", a partir dos documentos contábeis do sacado.
--
-- Três camadas, e elas não se misturam:
--   IA LÊ os documentos  →  a MATEMÁTICA decide  →  IA ESCREVE a narrativa
-- Nenhuma delas aprova crédito: quem aprova é gente, no perfil Crédito, com motivo
-- escrito quando diverge.
--
-- ─── A DECISÃO NÃO SOBRESCREVE O NÚMERO DA SEGURADORA ───────────────────────
-- `analises_credito.limite_aprovado` continua sendo o que a Atradius concedeu, e nada
-- aqui o toca. O que decidimos vai para `limite_operacional`, um campo NOVO e com nome
-- próprio. Duas verdades diferentes precisam de dois campos: o fator "histórico de
-- análises" do scorecard e a view `analise_vigente` leem a seguradora, e passariam a se
-- alimentar da nossa própria decisão se ela ocupasse o mesmo lugar.

-- ─── §1 Parâmetros versionados ──────────────────────────────────────────────
-- Mesmo padrão de `scorecard_versoes` (0073): versão nova a cada mudança, nunca update.
-- Sem isto, uma análise de dezoito meses atrás deixa de ser reproduzível no dia em que
-- alguém mexer no percentual da capacidade financeira — e é justamente a análise antiga
-- que alguém vai querer defender num comitê.

create table public.analise_parametros (
  versao int primary key,
  -- A LÓGICA das fórmulas mora no core (packages/core/src/credito/analise.ts) e é fixa.
  -- O que é editável aqui são os percentuais, os fatores, os limiares e os pontos de
  -- corte. Pela mesma razão do scorecard: um jsonb que carregasse a lógica seria uma
  -- linguagem de expressão dentro do banco, e nenhum teste alcançaria as versões que
  -- alguém salvar depois.
  definicao jsonb not null,
  nome text,
  ativa boolean not null default false,
  criada_por uuid references public.usuarios (id),
  criada_em timestamptz not null default now()
);

-- Uma só ativa. O índice parcial único torna "duas versões ativas" inexprimível.
create unique index analise_parametros_uma_ativa_idx on public.analise_parametros ((ativa)) where ativa;

comment on table public.analise_parametros is
  'Parâmetros versionados do cálculo determinístico (04j §4). A análise grava a versão '
  'que usou, e é por ela que uma análise antiga continua reproduzível.';

-- A v1 é o `PARAMETROS_PADRAO` de packages/core/src/credito/analise.ts, palavra por
-- palavra. Os dois precisam andar juntos: o core é quem calcula, este seed é só o ponto
-- de partida gravado.
insert into public.analise_parametros (versao, definicao, nome, ativa) values (
  1,
  jsonb_build_object(
    'indicadores', jsonb_build_object(
      'liquidez_corrente',     jsonb_build_object('direcao', 'maior_melhor', 'verde', 1.3,  'amarelo', 1.0),
      'liquidez_seca',         jsonb_build_object('direcao', 'maior_melhor', 'verde', 1.0,  'amarelo', 0.8),
      'endividamento_geral',   jsonb_build_object('direcao', 'menor_melhor', 'verde', 0.6,  'amarelo', 0.75),
      'divida_liquida_ebitda', jsonb_build_object('direcao', 'menor_melhor', 'verde', 2,    'amarelo', 3.5),
      'margem_ebitda',         jsonb_build_object('direcao', 'maior_melhor', 'verde', 0.1,  'amarelo', 0.05),
      'margem_liquida',        jsonb_build_object('direcao', 'maior_melhor', 'verde', 0.05, 'amarelo', 0.01),
      'roe',                   jsonb_build_object('direcao', 'maior_melhor', 'verde', 0.1,  'amarelo', 0.03),
      'giro_ativo',            jsonb_build_object('direcao', 'maior_melhor', 'verde', 0.8,  'amarelo', 0.4),
      -- Construção recebe por medição: 90 dias é rotina, não sintoma.
      'pmr',                   jsonb_build_object('direcao', 'menor_melhor', 'verde', 90,   'amarelo', 150),
      'crescimento_receita',   jsonb_build_object('direcao', 'maior_melhor', 'verde', 0.1,  'amarelo', 0),
      'cobertura_juros',       jsonb_build_object('direcao', 'maior_melhor', 'verde', 3,    'amarelo', 1.5)
    ),
    'capacidade_financeira', jsonb_build_object(
      'base_pct', 0.1,
      'penalidade_alavancagem', jsonb_build_object('acima_de', 3, 'fator', 0.6),
      'penalidade_liquidez', jsonb_build_object('abaixo_de', 1, 'fator', 0.7)
    ),
    'capacidade_operacional', jsonb_build_object('fator', 1.5, 'janela_meses', 6),
    -- pl_fundo NULO de propósito: o teto de concentração fica NÃO APLICÁVEL e fora do
    -- mínimo até alguém configurar o PL. Um número inventado aqui apertaria todo limite
    -- da casa sem ninguém perceber de onde veio.
    'concentracao_portfolio', jsonb_build_object('pl_fundo', null, 'pct_max_por_sacado', 0.1),
    'scorecard', jsonb_build_object('banda_por_faixa', jsonb_build_object(
      'alta', 5000000, 'media', 2000000, 'improvavel', 500000,
      -- Sem score não há banda — e não há banda ZERO. O teto sai da conta.
      'dados_insuficientes', null
    )),
    'cenarios', jsonb_build_object(
      'fator_conservador', 0.7,
      'fator_agressivo', 1.3,
      'condicionantes_agressivo', jsonb_build_array(
        'mediante garantia adicional (aval dos sócios ou cessão fiduciária)',
        'revisão obrigatória em 90 dias'
      )
    ),
    'knockouts', jsonb_build_object(
      'minimo_operacional', 100000,
      'pl_negativo', true,
      'divida_liquida_ebitda_acima_de', 5,
      'liquidez_corrente_abaixo_de', 0.6
    ),
    'parecer', jsonb_build_object('instrucoes_extras', '')
  ),
  'Padrão inicial (04j)',
  true
) on conflict (versao) do nothing;

-- ─── §2 O registro da análise ───────────────────────────────────────────────

create table public.analises_proprietarias (
  id uuid primary key default gen_random_uuid(),
  -- Nulável no esquema, exigido pelo RPC: os documentos moram em `analise_docs`, que
  -- pendura na esteira. Uma análise proprietária sem esteira seria uma análise sem
  -- documento para ler. Fica nulável porque a esteira pode ser apagada depois e o
  -- parecer continua valendo como registro histórico.
  analise_credito_id uuid references public.analises_credito (id) on delete set null,
  empresa_id uuid references public.empresas (id) on delete set null,
  cnpj text not null
    constraint analises_proprietarias_cnpj_check check (cnpj ~ '^[0-9]{14}$'),
  tipo text not null default 'inicial'
    constraint analises_proprietarias_tipo_check check (tipo in ('inicial', 'reanalise')),
  gatilho text not null default 'manual'
    constraint analises_proprietarias_gatilho_check
    check (gatilho in ('manual', 'automatico_envio_atradius')),
  status text not null default 'processando'
    constraint analises_proprietarias_status_check
    check (status in ('processando', 'aguardando_revisao', 'concluida', 'falhou')),
  -- Falha em qualquer etapa vira status `falhou` COM texto legível. Nunca um resultado
  -- parcial em silêncio: meio balanço extraído e nenhum aviso é pior que erro nenhum.
  erro text,
  etapa text,

  -- extração (§3)
  dados_extraidos jsonb,
  extracao_revisada_por uuid references public.usuarios (id),
  extracao_revisada_em timestamptz,

  -- cálculo (§4) — determinístico, sem IA
  indicadores jsonb,
  tetos jsonb,
  cenarios jsonb,
  recomendacao text
    constraint analises_proprietarias_recomendacao_check
    check (recomendacao is null or recomendacao in ('operar', 'nao_operar')),
  limite_recomendado numeric(14, 2),
  motivos_nao_operar jsonb not null default '[]'::jsonb,
  lacunas_calculo jsonb not null default '[]'::jsonb,

  -- parecer (§5) — IA escreve sobre números já calculados
  parecer_markdown text,
  -- O analista edita; o original fica. Sem os dois campos, "a IA escreveu isso?" vira
  -- uma pergunta sem resposta no dia em que o parecer for questionado.
  parecer_editado text,
  parecer_editado_por uuid references public.usuarios (id),
  parecer_editado_em timestamptz,
  parecer_modelo text,
  parecer_tokens int,

  -- confronto e decisão (§7)
  atradius_status text,
  atradius_limite numeric(14, 2),
  quadrante text
    constraint analises_proprietarias_quadrante_check
    check (quadrante is null or quadrante in ('ambos_aprovam', 'ambos_negam', 'so_nos', 'so_seguradora')),
  decisao_final text
    constraint analises_proprietarias_decisao_check
    check (decisao_final is null or decisao_final in (
      'operar_com_cobertura', 'operar_sem_cobertura', 'operar_limite_reduzido', 'nao_operar'
    )),
  decisao_limite numeric(14, 2),
  decisao_motivo text,
  decidida_por uuid references public.usuarios (id),
  decidida_em timestamptz,

  parametros_versao int not null references public.analise_parametros (versao),
  criada_por uuid references public.usuarios (id),
  criada_em timestamptz not null default now(),
  concluida_em timestamptz,

  -- O gêmeo de `motivoObrigatorio()` em packages/core/src/credito/analise.ts. Está
  -- duplicado de propósito: o core dá a mensagem antes do clique, o banco é a última
  -- linha. Os dois mudam juntos — divergência aqui é uma decisão sem motivo passando.
  constraint analises_proprietarias_motivo_da_divergencia_check check (
    decisao_final is null
    or nullif(btrim(coalesce(decisao_motivo, '')), '') is not null
    or (quadrante = 'ambos_aprovam' and decisao_final = 'operar_com_cobertura')
    or (quadrante = 'ambos_negam' and decisao_final = 'nao_operar')
  )
);

create index analises_proprietarias_cnpj_idx on public.analises_proprietarias (cnpj, criada_em desc);
create index analises_proprietarias_esteira_idx on public.analises_proprietarias (analise_credito_id)
  where analise_credito_id is not null;
create index analises_proprietarias_status_idx on public.analises_proprietarias (status)
  where status in ('processando', 'aguardando_revisao');

comment on table public.analises_proprietarias is
  'Análise de crédito proprietária (04j): extração por IA, cálculo determinístico, '
  'parecer narrativo e a decisão humana. A decisão NÃO escreve em '
  'analises_credito.limite_aprovado — esse número é da seguradora.';

comment on column public.analises_proprietarias.dados_extraidos is
  'Por exercício, por campo: { valor, origem: { documento_id, pagina, trecho_curto }, '
  'revisado, valor_original }. Mais lacunas[] e conflitos[]. A origem é o que permite '
  'conferir cada número contra o documento sem abrir o PDF inteiro.';

-- ─── §3 O catálogo de documentos, estendido ─────────────────────────────────
-- `analise_docs.tipo` é texto livre (0073) — o catálogo vive em `credito_config`, que é
-- editável pela tela. Aqui ele passa a conhecer os tipos contábeis do 04j.
--
-- `essencial` é diferente de `obrigatorio`: obrigatório é o que a SEGURADORA cobra;
-- essencial é o que a NOSSA análise precisa para sair de pé. A análise roda com o que
-- houver, sinalizando as lacunas — travar por documento faltando produziria zero
-- análises numa base onde ninguém manda balanço de dois exercícios de primeira.

update public.credito_config
set valor = jsonb_build_object('tipos', jsonb_build_array(
      jsonb_build_object('id', 'balanco_patrimonial',        'label', 'Balanço patrimonial',              'obrigatorio', true,  'essencial', true,  'extraivel', true),
      jsonb_build_object('id', 'dre',                        'label', 'DRE',                              'obrigatorio', true,  'essencial', true,  'extraivel', true),
      jsonb_build_object('id', 'faturamento_declarado',      'label', 'Faturamento declarado',            'obrigatorio', false, 'essencial', true,  'extraivel', true),
      jsonb_build_object('id', 'balancete',                  'label', 'Balancete',                        'obrigatorio', false, 'essencial', false, 'extraivel', true),
      jsonb_build_object('id', 'dfc',                        'label', 'Demonstração de fluxo de caixa',   'obrigatorio', false, 'essencial', false, 'extraivel', true),
      jsonb_build_object('id', 'dmpl',                       'label', 'DMPL',                             'obrigatorio', false, 'essencial', false, 'extraivel', true),
      jsonb_build_object('id', 'notas_explicativas',         'label', 'Notas explicativas',               'obrigatorio', false, 'essencial', false, 'extraivel', true),
      jsonb_build_object('id', 'relacao_faturamento_mensal', 'label', 'Relação de faturamento mensal',    'obrigatorio', false, 'essencial', false, 'extraivel', true),
      jsonb_build_object('id', 'imposto_renda_pj',           'label', 'Imposto de renda PJ',              'obrigatorio', false, 'essencial', false, 'extraivel', true),
      jsonb_build_object('id', 'sped_ecd',                   'label', 'SPED ECD',                         'obrigatorio', false, 'essencial', false, 'extraivel', true),
      -- Os de baixo não vão ao modelo: não têm número a extrair.
      jsonb_build_object('id', 'contrato_social',            'label', 'Contrato social',                  'obrigatorio', true,  'essencial', false, 'extraivel', false),
      jsonb_build_object('id', 'certidoes',                  'label', 'Certidões (CND, FGTS, trabalhista)','obrigatorio', false,'essencial', false, 'extraivel', false),
      jsonb_build_object('id', 'parecer_auditoria',          'label', 'Parecer de auditoria',             'obrigatorio', false, 'essencial', false, 'extraivel', false),
      jsonb_build_object('id', 'outros',                     'label', 'Outros',                           'obrigatorio', false, 'essencial', false, 'extraivel', false)
    )),
    atualizado_em = now()
where chave = 'docs';

-- Um documento pode ter sido lido por uma extração, e é dele que sai `origem.pagina`.
-- Guardar a contagem de páginas evita reabrir o PDF só para dizer "3 de 40" na tela.
alter table public.analise_docs
  add column if not exists paginas int,
  add column if not exists extraido_em timestamptz;

-- ─── §4 O limite que NÓS operamos, na esteira ───────────────────────────────

alter table public.analises_credito
  add column if not exists limite_operacional numeric(14, 2),
  add column if not exists decisao_interna text,
  add column if not exists decisao_interna_em timestamptz,
  add column if not exists analise_propria_id uuid references public.analises_proprietarias (id) on delete set null;

alter table public.analises_credito
  drop constraint if exists analises_credito_decisao_interna_check;
alter table public.analises_credito
  add constraint analises_credito_decisao_interna_check check (
    decisao_interna is null or decisao_interna in (
      'operar_com_cobertura', 'operar_sem_cobertura', 'operar_limite_reduzido', 'nao_operar'
    )
  );

comment on column public.analises_credito.limite_operacional is
  'O limite com que a casa DECIDIU operar (04j §7). Distinto de limite_aprovado, que é '
  'o da seguradora: em "só nós aprovamos" existe operacional sem aprovado, e em '
  '"só a seguradora" existe aprovado sem operacional. A antecipação lê este; o '
  'scorecard e a view analise_vigente continuam lendo o da seguradora.';

-- ─── §5 RLS ─────────────────────────────────────────────────────────────────
-- Documento contábil de terceiro é o dado mais sensível da base. Leitura só para quem
-- tem o módulo Crédito — nem Empresas, nem Comercial, nem o dono da carteira.

alter table public.analise_parametros enable row level security;
alter table public.analises_proprietarias enable row level security;

create policy analise_parametros_select on public.analise_parametros
  for select using (public.app_tem_modulo('credito'));

create policy analises_proprietarias_select on public.analises_proprietarias
  for select using (public.app_tem_modulo('credito'));

grant select on public.analise_parametros, public.analises_proprietarias to authenticated;

-- ─── §6 Escrita, sempre por RPC ─────────────────────────────────────────────

/**
 * Abre uma análise. Não calcula nada: devolve a linha em `processando` e quem a executa
 * é o worker, porque ler dez PDFs num modelo leva minutos e nenhum request de tela
 * espera por isso.
 */
create or replace function public.app_rodar_analise_propria(p jsonb)
returns public.analises_proprietarias
language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_esteira public.analises_credito;
  v_linha public.analises_proprietarias;
  v_versao int;
  v_tipo text := coalesce(nullif(p ->> 'tipo', ''), 'inicial');
  v_gatilho text := coalesce(nullif(p ->> 'gatilho', ''), 'manual');
  v_aberta uuid;
begin
  if not public.app_tem_modulo('credito') then
    raise exception 'Somente o perfil Crédito roda análise proprietária.' using errcode = '42501';
  end if;

  select * into v_esteira from public.analises_credito where id = (p ->> 'analise_credito_id')::uuid;
  if v_esteira.id is null then
    raise exception 'Análise da esteira não encontrada. Os documentos ficam nela.' using errcode = '23503';
  end if;

  select versao into v_versao from public.analise_parametros where ativa;
  if v_versao is null then
    raise exception 'Não há versão ativa de parâmetros de análise.' using errcode = '23502';
  end if;

  -- Duas análises da mesma esteira ao mesmo tempo gastariam o dobro de tokens sobre os
  -- mesmos PDFs e produziriam dois pareceres divergentes para a mesma pergunta.
  select id into v_aberta
  from public.analises_proprietarias
  where analise_credito_id = v_esteira.id and status in ('processando', 'aguardando_revisao')
  limit 1;
  if v_aberta is not null then
    raise exception 'Já existe uma análise em andamento para este sacado.' using errcode = '23505';
  end if;

  insert into public.analises_proprietarias (
    analise_credito_id, empresa_id, cnpj, tipo, gatilho, status, etapa, parametros_versao, criada_por
  ) values (
    v_esteira.id, v_esteira.empresa_id, v_esteira.cnpj, v_tipo, v_gatilho,
    'processando', 'extracao', v_versao, v_ator
  )
  returning * into v_linha;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_esteira.empresa_id, 'analise_propria.iniciada',
          jsonb_build_object('analise_propria_id', v_linha.id, 'cnpj', v_esteira.cnpj, 'tipo', v_tipo, 'gatilho', v_gatilho),
          v_ator);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'analise_propria.rodar', 'analises_proprietarias', v_linha.id::text,
          jsonb_build_object('analise_credito_id', v_esteira.id, 'tipo', v_tipo));

  return v_linha;
end;
$$;

/**
 * A revisão humana da extração (§3).
 *
 * Cada correção sobrescreve o valor E preserva o que o modelo tinha lido em
 * `valor_original`. Sem isso não há como medir a qualidade da extração depois — e a
 * primeira pergunta que se faz de um extrator é "com que frequência ele erra".
 *
 * `p.correcoes = [{ exercicio, campo, valor }]`. Campo confirmado sem correção entra
 * com o mesmo valor: confirmar é um ato, e ele precisa ficar gravado.
 */
create or replace function public.app_revisar_extracao(p jsonb)
returns public.analises_proprietarias
language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_linha public.analises_proprietarias;
  v_dados jsonb;
  v_correcao jsonb;
  v_idx int;
  v_campo text;
  v_novo numeric;
  v_antigo jsonb;
begin
  if not public.app_tem_modulo('credito') then
    raise exception 'Somente o perfil Crédito revisa extração.' using errcode = '42501';
  end if;

  select * into v_linha from public.analises_proprietarias where id = (p ->> 'id')::uuid for update;
  if v_linha.id is null then
    raise exception 'Análise não encontrada.' using errcode = '23503';
  end if;
  if v_linha.status <> 'aguardando_revisao' then
    raise exception 'Esta análise não está aguardando revisão.' using errcode = '23514';
  end if;

  v_dados := coalesce(v_linha.dados_extraidos, jsonb_build_object('exercicios', '[]'::jsonb));

  for v_correcao in select * from jsonb_array_elements(coalesce(p -> 'correcoes', '[]'::jsonb))
  loop
    v_campo := v_correcao ->> 'campo';
    v_novo := nullif(v_correcao ->> 'valor', '')::numeric;

    -- O índice do exercício dentro do array. jsonb não tem "update where", então o
    -- caminho é localizar a posição e reescrever por jsonb_set.
    select ord - 1 into v_idx
    from jsonb_array_elements(v_dados -> 'exercicios') with ordinality as t(bloco, ord)
    where (t.bloco ->> 'exercicio')::int = (v_correcao ->> 'exercicio')::int;

    if v_idx is null then continue; end if;

    v_antigo := v_dados #> array['exercicios', v_idx::text, 'campos', v_campo];

    v_dados := jsonb_set(
      v_dados,
      array['exercicios', v_idx::text, 'campos', v_campo],
      coalesce(v_antigo, '{}'::jsonb)
        || jsonb_build_object('valor', v_novo, 'revisado', true)
        -- Só grava o original quando o número mudou de fato: marcar "original" num
        -- campo apenas confirmado sujaria a medida de qualidade da extração.
        || case
             when v_antigo is not null and (v_antigo ->> 'valor') is distinct from (v_novo::text)
             then jsonb_build_object('valor_original', v_antigo -> 'valor')
             else '{}'::jsonb
           end,
      true
    );
  end loop;

  update public.analises_proprietarias
  set dados_extraidos = v_dados,
      extracao_revisada_por = v_ator,
      extracao_revisada_em = now(),
      -- Volta para `processando`: o cálculo e o parecer são do worker, e é a mudança de
      -- status que ele varre.
      status = 'processando',
      etapa = 'calculo'
  where id = v_linha.id
  returning * into v_linha;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'analise_propria.revisar_extracao', 'analises_proprietarias', v_linha.id::text,
          jsonb_build_object('correcoes', coalesce(p -> 'correcoes', '[]'::jsonb)));

  return v_linha;
end;
$$;

/** O analista edita o parecer. O original nunca é tocado. */
create or replace function public.app_editar_parecer(p jsonb)
returns public.analises_proprietarias
language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_linha public.analises_proprietarias;
begin
  if not public.app_tem_modulo('credito') then
    raise exception 'Somente o perfil Crédito edita o parecer.' using errcode = '42501';
  end if;

  update public.analises_proprietarias
  set parecer_editado = nullif(btrim(coalesce(p ->> 'texto', '')), ''),
      parecer_editado_por = v_ator,
      parecer_editado_em = now()
  where id = (p ->> 'id')::uuid
  returning * into v_linha;

  if v_linha.id is null then
    raise exception 'Análise não encontrada.' using errcode = '23503';
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'analise_propria.editar_parecer', 'analises_proprietarias', v_linha.id::text, '{}'::jsonb);

  return v_linha;
end;
$$;

/**
 * A decisão (§7). Só perfil Crédito, nunca automática, nunca pela IA.
 *
 * O motivo é obrigatório em tudo que não seja o caminho trivial do quadrante — o CHECK
 * da tabela é quem garante, e aqui a mensagem é traduzida para quem clicou.
 */
create or replace function public.app_registrar_decisao_credito(p jsonb)
returns public.analises_proprietarias
language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_linha public.analises_proprietarias;
  v_decisao text := p ->> 'decisao_final';
  v_limite numeric := nullif(p ->> 'decisao_limite', '')::numeric;
  v_motivo text := nullif(btrim(coalesce(p ->> 'decisao_motivo', '')), '');
  v_trivial boolean;
begin
  if not public.app_tem_modulo('credito') then
    raise exception 'Somente o perfil Crédito registra decisão de crédito.' using errcode = '42501';
  end if;

  select * into v_linha from public.analises_proprietarias where id = (p ->> 'id')::uuid for update;
  if v_linha.id is null then
    raise exception 'Análise não encontrada.' using errcode = '23503';
  end if;
  if v_linha.status <> 'concluida' then
    raise exception 'A análise precisa estar concluída para receber decisão.' using errcode = '23514';
  end if;

  v_trivial := (v_linha.quadrante = 'ambos_aprovam' and v_decisao = 'operar_com_cobertura')
            or (v_linha.quadrante = 'ambos_negam' and v_decisao = 'nao_operar');

  if v_motivo is null and not v_trivial then
    raise exception 'Esta decisão diverge do caminho trivial do quadrante: o motivo é obrigatório.'
      using errcode = '23514';
  end if;

  -- Não operar não tem limite. Aceitar um número aqui deixaria um limite órfão pronto
  -- para ser lido por engano pela antecipação.
  if v_decisao = 'nao_operar' then v_limite := null; end if;

  update public.analises_proprietarias
  set decisao_final = v_decisao,
      decisao_limite = v_limite,
      decisao_motivo = v_motivo,
      decidida_por = v_ator,
      decidida_em = now()
  where id = v_linha.id
  returning * into v_linha;

  -- Aplica na esteira, em campos PRÓPRIOS: `limite_aprovado` continua sendo da
  -- seguradora e não é tocado aqui.
  if v_linha.analise_credito_id is not null then
    update public.analises_credito
    set limite_operacional = v_limite,
        decisao_interna = v_decisao,
        decisao_interna_em = now(),
        analise_propria_id = v_linha.id
    where id = v_linha.analise_credito_id;
  end if;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_linha.empresa_id, 'credito.decisao_registrada',
          jsonb_build_object(
            'analise_propria_id', v_linha.id, 'cnpj', v_linha.cnpj,
            'quadrante', v_linha.quadrante, 'decisao', v_decisao, 'limite', v_limite,
            'motivo', v_motivo
          ), v_ator);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'credito.decisao', 'analises_proprietarias', v_linha.id::text,
          jsonb_build_object('decisao', v_decisao, 'limite', v_limite, 'quadrante', v_linha.quadrante));

  return v_linha;
end;
$$;

/** Nova versão de parâmetros. Nunca update: a análise antiga aponta para a sua. */
create or replace function public.app_salvar_parametros_analise(p jsonb)
returns public.analise_parametros
language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_linha public.analise_parametros;
  v_versao int;
begin
  if not public.app_tem_modulo('credito') then
    raise exception 'Somente o perfil Crédito altera parâmetros de análise.' using errcode = '42501';
  end if;

  select coalesce(max(versao), 0) + 1 into v_versao from public.analise_parametros;

  if coalesce((p ->> 'ativar')::boolean, true) then
    update public.analise_parametros set ativa = false where ativa;
  end if;

  insert into public.analise_parametros (versao, definicao, nome, ativa, criada_por)
  values (v_versao, p -> 'definicao', nullif(p ->> 'nome', ''),
          coalesce((p ->> 'ativar')::boolean, true), v_ator)
  returning * into v_linha;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'analise_propria.parametros', 'analise_parametros', v_versao::text,
          jsonb_build_object('nome', p ->> 'nome'));

  return v_linha;
end;
$$;

revoke execute on function public.app_rodar_analise_propria(jsonb) from public, anon;
revoke execute on function public.app_revisar_extracao(jsonb) from public, anon;
revoke execute on function public.app_editar_parecer(jsonb) from public, anon;
revoke execute on function public.app_registrar_decisao_credito(jsonb) from public, anon;
revoke execute on function public.app_salvar_parametros_analise(jsonb) from public, anon;

grant execute on function public.app_rodar_analise_propria(jsonb) to authenticated;
grant execute on function public.app_revisar_extracao(jsonb) to authenticated;
grant execute on function public.app_editar_parecer(jsonb) to authenticated;
grant execute on function public.app_registrar_decisao_credito(jsonb) to authenticated;
grant execute on function public.app_salvar_parametros_analise(jsonb) to authenticated;

-- ─── §8 O painel do sacado ──────────────────────────────────────────────────
/**
 * Tudo que se sabe de um sacado, numa chamada.
 *
 * SECURITY DEFINER e uma chamada só porque o painel cruza sete origens (esteira, score,
 * análise própria, protestos, NF-e observada, grupo/obras, certificado) e montá-lo no
 * cliente seria sete idas ao banco com sete latências — em cima de tabelas que o módulo
 * Crédito lê, mas o app mobile não deveria precisar conhecer uma a uma.
 */
create or replace function public.analise_propria_painel(p_analise_credito_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_esteira public.analises_credito;
  v_empresa public.empresas;
  v_score public.empresa_scores;
  v_propria public.analises_proprietarias;
  v_protesto jsonb;
  v_nfe jsonb;
  v_docs jsonb;
  v_certificado jsonb;
  v_opera boolean;
  v_janela int := 6;
begin
  if not public.app_tem_modulo('credito') then
    raise exception 'Sem acesso ao módulo Crédito.' using errcode = '42501';
  end if;

  select * into v_esteira from public.analises_credito where id = p_analise_credito_id;
  if v_esteira.id is null then
    return jsonb_build_object('encontrado', false);
  end if;

  select * into v_empresa from public.empresas where id = v_esteira.empresa_id;

  select * into v_score from public.empresa_scores
  where cnpj = v_esteira.cnpj order by calculado_em desc limit 1;

  select * into v_propria from public.analises_proprietarias
  where analise_credito_id = v_esteira.id order by criada_em desc limit 1;

  select to_jsonb(pa) into v_protesto from public.protestos_atual pa where pa.cnpj = v_esteira.cnpj;

  select exists (select 1 from public.clientes_onepay c where c.cnpj = v_esteira.cnpj) into v_opera;

  -- A média mensal de NF-e observada: o insumo do teto operacional. Divide pela JANELA
  -- inteira, não pelos meses em que houve nota — quem emitiu em dois dos seis meses tem
  -- média baixa, e é isso mesmo que o teto deve enxergar.
  select jsonb_build_object(
           'janela_meses', v_janela,
           'total', coalesce(sum(n.valor), 0),
           'qtd', count(*),
           'media_mensal', coalesce(sum(n.valor), 0) / v_janela
         )
  into v_nfe
  from public.notas_fiscais n
  where n.sacado_cnpj = v_esteira.cnpj
    and n.emitida_em >= (now() - make_interval(months => v_janela));

  select jsonb_agg(to_jsonb(d) order by d.enviado_em desc) into v_docs
  from public.analise_docs d where d.analise_id = v_esteira.id;

  select jsonb_build_object('expires_at', c.expires_at, 'status', c.status)
  into v_certificado
  from public.certificados c where c.cnpj = v_esteira.cnpj;

  return jsonb_build_object(
    'encontrado', true,
    'esteira', to_jsonb(v_esteira),
    'empresa', case when v_empresa.id is null then null else jsonb_build_object(
      'id', v_empresa.id, 'cnpj', v_empresa.cnpj, 'razao_social', v_empresa.razao_social,
      'nome_fantasia', v_empresa.nome_fantasia, 'tipo', v_empresa.tipo, 'estagio', v_empresa.estagio,
      'uf', v_empresa.uf, 'municipio', v_empresa.municipio,
      'faturamento_anual', v_empresa.faturamento_anual, 'faturamento_origem', v_empresa.faturamento_origem,
      'faturamento_confianca', v_empresa.faturamento_confianca,
      'funcionarios', v_empresa.funcionarios, 'funcionarios_crescimento_12m', v_empresa.funcionarios_crescimento_12m,
      'limite_potencial', v_empresa.limite_potencial, 'valor_esperado_mensal', v_empresa.valor_esperado_mensal,
      'patrimonio_liquido', v_empresa.patrimonio_liquido
    ) end,
    'metricas', (
      select jsonb_build_object(
               'qtd_filiais', m.qtd_filiais, 'grupo_spes_total', m.grupo_spes_total,
               'grupo_spes_24m', m.grupo_spes_24m, 'obras_ativas', m.obras_ativas,
               'm2_em_execucao', m.m2_em_execucao)
      from public.mercado_metricas m where m.cnpj = v_esteira.cnpj
    ),
    'score', case when v_score.id is null then null else to_jsonb(v_score) end,
    'propria', case when v_propria.id is null then null else to_jsonb(v_propria) end,
    'protestos', v_protesto,
    'certificado', v_certificado,
    'opera_na_plataforma', coalesce(v_opera, false),
    'nfe_observada', v_nfe,
    'docs', coalesce(v_docs, '[]'::jsonb),
    'parametros_ativos', (select definicao from public.analise_parametros where ativa)
  );
end;
$$;

revoke execute on function public.analise_propria_painel(uuid) from public, anon;
grant execute on function public.analise_propria_painel(uuid) to authenticated;

-- ─── §9 Notificações ────────────────────────────────────────────────────────
-- `aguardando_revisao` avisa Crédito (o solicitante é notificado nominalmente pelo
-- worker, que sabe quem pediu). Divergência e reanálise avisam Crédito e Admin.

insert into public.notificacao_regras (tipo_evento, perfil_id, ativo)
select v.tipo, p.id, true
from (values
  ('analise_propria.aguardando_revisao', 'Crédito'),
  ('analise_propria.divergencia_seguradora', 'Crédito'),
  ('analise_propria.divergencia_seguradora', 'Admin'),
  ('reanalise.sugerida', 'Crédito')
) as v (tipo, perfil)
join public.perfis p on p.nome = v.perfil
where not exists (
  select 1 from public.notificacao_regras r
  where r.tipo_evento = v.tipo and r.perfil_id = p.id
);
