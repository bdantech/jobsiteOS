-- 0222 — Sacados por NF (Prompt 04r).
--
-- APLICADA EM PARTES no banco, para localizar a falha caso alguma fosse recusada:
-- `0222a_sacados_por_nf_tabelas`, `0222b_sacados_por_nf_rls`,
-- `0222c_analise_credito_nucleo_compartilhado`,
-- `0222d_pedido_de_apresentacao_tem_direcao`, `0222e_sacados_por_nf_escritas`,
-- `0222f_a_esteira_move_o_card_e_cria_a_carteira`, `0222g_sacados_por_nf_leituras`,
-- `0222h_sacados_por_nf_seeds`, `0222i_a_funcao_de_trigger_nao_e_endpoint` (pega pelo
-- advisor de segurança logo depois) e `0222j_o_estagio_do_card_vira_evento_de_timeline` —
-- as duas últimas já incorporadas ao texto abaixo, no lugar em que valem.
--
-- ─── O QUE ESTA FEATURE É, E POR QUE É UM FUNIL PRÓPRIO ─────────────────────
--
-- Temos certificado digital de boa parte dos nossos CEDENTES, então enxergamos todas as
-- notas que eles emitem — inclusive contra construtoras que ainda não são clientes. Cada
-- uma delas é um sacado em potencial com FLUXO COMERCIAL OBSERVADO, não inferido.
--
-- No funil de NFs (04) o sacado tem crédito aprovado e a pergunta é "o fornecedor vai
-- antecipar?". Aqui o sacado não tem análise nenhuma, e a pergunta é "conseguimos operar
-- isso?" — o gargalo é a esteira de crédito, não a conversa comercial. Estágios que
-- descrevem conversa não descrevem esteira.
--
-- A UNIDADE É O SACADO. Três cedentes emitindo contra a mesma construtora são UMA
-- oportunidade com o triplo de evidência: a análise acontece uma vez por CNPJ, e três
-- cards dariam três pedidos que a esteira recusaria a partir do segundo.
--
-- ─── SEIS MEDIÇÕES DA BASE EM 20/09/2026 SUSTENTAM O DESENHO ────────────────
--
--   886 sacados não cadastrados receberam 1.425 notas de cedentes nossos em 30 dias,
--       somando R$ 60,1 milhões. Com o corte de R$ 30 mil sobram 243 — que é um funil;
--       886 é a lista de destinatários.
--   114 dos 243 são CONTRATANTES pela régua de CNAE (divisão 41/42 ou grupo 6810),
--       somando R$ 20,7 milhões. Os outros 129 são posto de gasolina, papelaria e o
--       contador do fornecedor — a mesma lição que a aba substituída já tinha pago.
--     2 dos 243 ainda não têm CNAE nenhum, então o recorte custa quase nada em cegueira.
--    12 dias é a MEDIANA do prazo restante das 1.425 notas. De R$ 60,1 milhões emitidos
--       em 30 dias, só R$ 436 mil passariam de 55 dias de vida. É o número inteiro da
--       coluna `valor_operavel`, e o motivo de a ordenação não ser pelo volume de 30 dias.
--     7 análises de crédito decididas com prazo válido — amostra insuficiente para medir
--       o tempo de esteira, e por isso `esteira_base_minima` existe.
--     1 dos 130 cedentes que emitem contra sacados não cadastrados tem titular vigente em
--       `vendedor_carteira`. Quase todo card nasce órfão, e é por isso que o botão
--       "Seguir" é load-bearing e não um enfeite.
--
-- ─── DUAS DIVERGÊNCIAS ENTRE A SPEC E O BANCO VIVO, E COMO FORAM RESOLVIDAS ──
--
-- 1. O §2 fala em "papel `originacao` (04k)". Em `vendedor_carteira` vivem CINCO papéis,
--    e os dois nomes parecidos querem dizer coisas diferentes (ver PAPEIS_CARTEIRA em
--    packages/core/src/comercial/schemas.ts): `originacao` é roteamento de NF (04g);
--    `originador` é TITULAR DO CEDENTE (04k §4) — que é exatamente o que o §2 descreve.
--    A titularidade é espelhada de `originador`. Medido: `originador` cobre 8 dos 130
--    cedentes, `originacao` cobre 1.
--    No §7 o papel gravado É `originacao`, e ali a spec está certa: o que a aprovação
--    entrega ao originador é o roteamento das NFs daquele sacado.
--
-- 2. O §3 pede `origem = 'prospeccao_fluxo'` na análise de crédito. Em
--    `analises_credito`, `origem` diz qual SISTEMA criou a linha (jobsiteos,
--    atradius_backfill, api_producao) e `origem_motivo` diz POR QUE pediram — é o
--    comentário da própria coluna. A análise daqui nasce no jobsiteos como qualquer
--    outra; `prospeccao_fluxo` vai em `origem_motivo`. Escrevê-lo em `origem` inventaria
--    um quarto sistema e quebraria a contagem por sistema do report semanal.
--
-- O `unique (originador_id, fornecedor_cnpj, ate)` do §2 também não funcionaria como
-- escrito: NULL não é igual a NULL num índice único, então duas linhas vigentes
-- idênticas entrariam as duas. Virou índice único PARCIAL — ver o comentário da tabela.
--
-- ─── O QUE ESTA MIGRAÇÃO MEXE FORA DO PRÓPRIO MÓDULO ────────────────────────
--
--   `analises_credito`   ganha um núcleo compartilhado para "abrir análise" (§5), porque
--                        `app_solicitar_analise` exige módulo que este público não tem.
--   `pedidos_apresentacao` ganha DIREÇÃO: aqui a ponte vai no sentido inverso ao do 04l.
--   `vendedor_carteira`  ganha `origem = 'prospeccao_fluxo'` (§7).
--
-- Nenhuma delas muda o comportamento de quem já as usava.

-- =============================================================================
-- §2/§3 — Tabelas do funil de Sacados por NF
-- =============================================================================

create table public.prospeccao_config (
  chave text primary key,
  valor jsonb not null,
  atualizado_por uuid references public.usuarios (id) on delete set null,
  atualizado_em timestamptz not null default now()
);

comment on table public.prospeccao_config is
  'Settings do funil de Sacados por NF (04r §8): janelas, corte de volume, margem de '
  'prazo, teto de enriquecimento e motivos de descarte. Mesmo desenho de '
  'fornecedores_config e radar_config.';

-- ─── Quem o originador segue (§2) ───────────────────────────────────────────
/*
 * DUAS FONTES QUE COEXISTEM NA MESMA LINHA-CHAVE, e é por isso que `origem` entra no
 * índice único.
 *
 * O §2 é explícito: "perder titularidade por dormência NÃO remove o seguir manual". Com
 * um único par (originador, fornecedor), o job da titularidade fecharia a linha que o
 * botão "Seguir" tinha aberto, e o originador descobriria no dia seguinte que o
 * fornecedor sumiu do funil sem ninguém ter clicado em nada. Duas linhas, duas origens,
 * e o funil lê a UNIÃO.
 *
 * O `unique (originador_id, fornecedor_cnpj, ate)` do prompt não funcionaria em
 * Postgres: NULL não é igual a NULL num índice único, então duas linhas vigentes
 * idênticas entrariam as duas. O que se quer dizer é "no máximo um vínculo VIGENTE",
 * e isso é um índice único PARCIAL.
 */
create table public.fornecedores_seguidos (
  id uuid primary key default gen_random_uuid(),
  originador_id uuid not null references public.vendedores (id) on delete cascade,
  fornecedor_cnpj text not null
    constraint fornecedores_seguidos_cnpj_check check (fornecedor_cnpj ~ '^[0-9]{14}$'),
  origem text not null default 'manual'
    constraint fornecedores_seguidos_origem_check check (origem in ('manual', 'titularidade')),
  desde timestamptz not null default now(),
  ate timestamptz,
  criado_por uuid references public.usuarios (id) on delete set null
);

create unique index fornecedores_seguidos_vigente_idx
  on public.fornecedores_seguidos (originador_id, fornecedor_cnpj, origem)
  where ate is null;
create index fornecedores_seguidos_cnpj_idx
  on public.fornecedores_seguidos (fornecedor_cnpj) where ate is null;

comment on table public.fornecedores_seguidos is
  'Cedentes que cada originador acompanha (04r §2). União de duas fontes: titularidade '
  'espelhada de vendedor_carteira (papel `originador` = titular do cedente, 04k) e o '
  'botão "Seguir". As duas coexistem: perder a titularidade não apaga o seguir manual.';
comment on column public.fornecedores_seguidos.origem is
  'titularidade = espelhado do vendedor_carteira pelo job diário, e fechado por ele '
  'quando a titularidade cai. manual = alguém clicou em Seguir, e só outro clique tira.';
comment on column public.fornecedores_seguidos.ate is
  'NULL = vigente. Fechar em vez de apagar preserva a resposta de "desde quando ele '
  'via este fluxo?", que é o que separa uma oportunidade perdida de uma que nunca '
  'esteve na mesa.';

-- ─── O funil (§3) ───────────────────────────────────────────────────────────
/*
 * A UNIDADE É O SACADO, e o `unique (cnpj_sacado)` é essa decisão escrita.
 *
 * Três fornecedores nossos emitindo contra a mesma construtora são UMA oportunidade com
 * o triplo de evidência. A análise de crédito acontece uma vez por CNPJ; três cards
 * dariam três pedidos de análise para a mesma esteira, e o segundo já seria recusado
 * por `app__abrir_analise_credito` ("já existe uma análise em andamento") — com o
 * originador sem entender por quê.
 */
create table public.sacados_prospeccao (
  id uuid primary key default gen_random_uuid(),
  cnpj_sacado text not null unique
    constraint sacados_prospeccao_cnpj_check check (cnpj_sacado ~ '^[0-9]{14}$'),
  /* Denormalizado da NOTA: 225 dos 243 candidatos medidos em 20/09/2026 não têm ficha
     em `empresas`, e um card sem nome é um card que ninguém abre. */
  sacado_nome text,
  empresa_id uuid references public.empresas (id) on delete set null,

  originador_id uuid references public.vendedores (id) on delete set null,
  /* Como o dono chegou aqui — a mesma cicatriz do 04l. Sem esta coluna o job noturno
     desfaria toda reatribuição do gestor, e a correção sumiria de madrugada. */
  originador_origem text not null default 'automatica'
    constraint sacados_prospeccao_originador_origem_check
    check (originador_origem in ('automatica', 'manual')),

  estagio text not null default 'identificado'
    constraint sacados_prospeccao_estagio_check check (estagio in
      ('identificado', 'fornecedor_consultado', 'apresentacao_solicitada', 'analise_solicitada',
       'em_analise', 'aprovado', 'recusado', 'sem_interesse', 'descartado')),
  estagio_alterado_em timestamptz,
  estagio_alterado_por uuid references public.usuarios (id) on delete set null,
  motivo_saida text,
  observacao_saida text,

  -- ── métricas (recalculadas pelo job, §4) ─────────────────────────────────
  volume_30d numeric(14, 2),
  valor_operavel numeric(14, 2),
  qtd_nfs_30d int,
  qtd_fornecedores int,
  meses_com_emissao_6m int,
  media_mensal_6m numeric(14, 2),
  prazo_medio_dias int,
  ultima_nf_em date,
  /* O corte que produziu `valor_operavel` naquela rodada, e de onde ele veio. Sem os
     dois, o card mostra um número sem régua: "R$ 80 mil operáveis" não quer dizer nada
     se ninguém souber que o critério era "mais de 25 dias de vida". */
  prazo_minimo_operavel_dias int,
  prazo_minimo_origem text
    constraint sacados_prospeccao_prazo_origem_check
    check (prazo_minimo_origem is null or prazo_minimo_origem in ('medido', 'configurado')),

  -- ── qualificação (cache do 04c/04d) ──────────────────────────────────────
  score_credito numeric(5, 2),
  score_completude numeric(4, 3),
  chance_concessao numeric(4, 3),
  faturamento_estimado numeric(16, 2),
  limite_potencial numeric(16, 2),
  valor_esperado_mensal numeric(14, 2),

  -- ── ligação com a esteira ────────────────────────────────────────────────
  analise_credito_id uuid references public.analises_credito (id) on delete set null,

  entrou_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index sacados_prospeccao_originador_idx on public.sacados_prospeccao (originador_id, estagio);
create index sacados_prospeccao_valor_idx
  on public.sacados_prospeccao (valor_esperado_mensal desc nulls last);
-- A fila sem dono é a tela que o gestor abre por padrão: com 1 dos 130 cedentes tendo
-- titular vigente em 20/09/2026, quase todo card nasce órfão.
create index sacados_prospeccao_sem_dono_idx
  on public.sacados_prospeccao (valor_esperado_mensal desc)
  where originador_id is null and estagio = 'identificado';
create index sacados_prospeccao_analise_idx
  on public.sacados_prospeccao (analise_credito_id) where analise_credito_id is not null;
create index sacados_prospeccao_empresa_idx
  on public.sacados_prospeccao (empresa_id) where empresa_id is not null;

create trigger sacados_prospeccao_set_atualizado_em
  before update on public.sacados_prospeccao
  for each row execute function set_atualizado_em();

comment on table public.sacados_prospeccao is
  'Funil de aquisição de sacado por fluxo observado (04r). Entra por volume de NF de '
  'fornecedor SEGUIDO; sai por decisão da esteira de crédito. A unidade é o SACADO — a '
  'análise acontece uma vez por CNPJ, e fornecedores múltiplos são evidência, não cards.';
comment on column public.sacados_prospeccao.valor_operavel is
  'Soma das NFs da janela cujo prazo RESTANTE (contra hoje, não contra a emissão) supera '
  'prazo_minimo_operavel_dias. Medido em 20/09/2026: de R$ 60,1 mi emitidos em 30 dias, '
  'só R$ 436 mil passariam de 55 dias de vida — a mediana da base é de 12 dias. É o '
  'número que impede alguém de trabalhar um card duas semanas e descobrir no fim que não '
  'sobrou nota para operar.';
comment on column public.sacados_prospeccao.media_mensal_6m is
  'Volume da janela de recorrência dividido pelos MESES DA JANELA, não pelos meses com '
  'emissão. Dividir pelos meses com nota transformaria um pico único em "R$ 900 mil por '
  'mês" e ordenaria a lista pelo que já acabou.';
comment on column public.sacados_prospeccao.valor_esperado_mensal is
  'media_mensal_6m × chance_concessao × margem (04o). É a ordenação DEFAULT: ordenar '
  'pelo snapshot de 30 dias premiaria o pico; isto premia o fluxo que se destrava.';
comment on column public.sacados_prospeccao.analise_credito_id is
  'A análise que este card abriu. É por ela que o trigger da esteira move o card sozinho '
  '— aprovada vira `aprovado` e cria a carteira (§7); negada vira `recusado` com motivo.';

-- ─── A quebra por fornecedor — o coração do card (§5) ───────────────────────
create table public.sacados_prospeccao_fornecedores (
  id uuid primary key default gen_random_uuid(),
  sacado_prospeccao_id uuid not null
    references public.sacados_prospeccao (id) on delete cascade,
  fornecedor_cnpj text not null
    constraint sacados_prospeccao_fornecedores_cnpj_check check (fornecedor_cnpj ~ '^[0-9]{14}$'),
  fornecedor_nome text,
  fornecedor_empresa_id uuid references public.empresas (id) on delete set null,
  na_carteira_do_originador boolean not null default false,
  valor_30d numeric(14, 2),
  valor_operavel numeric(14, 2),
  qtd_nfs_30d int,
  meses_com_emissao_6m int,
  media_mensal_6m numeric(14, 2),
  ultima_nf_em date,
  unique (sacado_prospeccao_id, fornecedor_cnpj)
);

create index sacados_prospeccao_fornecedores_cnpj_idx
  on public.sacados_prospeccao_fornecedores (fornecedor_cnpj);

comment on table public.sacados_prospeccao_fornecedores is
  'A quebra por fornecedor dentro do card (04r §5). O detalhe NOTA A NOTA não vira '
  'tabela: ele é consultado direto em notas_fiscais pelo par (fornecedor, sacado) — '
  'copiar as notas criaria uma segunda verdade sobre o vencimento delas, que é '
  'justamente o dado que muda todo dia.';
comment on column public.sacados_prospeccao_fornecedores.na_carteira_do_originador is
  'Este fornecedor já é titularizado por quem trabalha o card. É a diferença entre '
  '"ligar para um cliente meu" e "pedir um favor a um cliente de outra pessoa".';

-- ─── O gasto do "Enriquecer sacado" (§5) ────────────────────────────────────
/*
 * LEDGER PRÓPRIO, e não `descoberta_execucoes`.
 *
 * Aquela tabela tem `fornecedor_cnpj NOT NULL` e mede a cascata de descoberta de
 * CONTATO de fornecedor. Guardar aqui um CNPJ de sacado numa coluna chamada
 * `fornecedor_cnpj` faria toda consulta de orçamento do 04l somar dois gastos que não
 * são a mesma coisa — e o originador que estourasse um teto descobriria pelo outro.
 *
 * A VERDADE DO GASTO É A SOMA, não um contador: mesma decisão do Radar e do 04l, e
 * pelo mesmo motivo — um contador incrementado em paralelo diverge na primeira vez que
 * um job morre no meio, e a divergência é invisível porque o número continua parecendo
 * um número.
 */
create table public.prospeccao_enriquecimentos (
  id uuid primary key default gen_random_uuid(),
  cnpj_sacado text not null
    constraint prospeccao_enriquecimentos_cnpj_check check (cnpj_sacado ~ '^[0-9]{14}$'),
  originador_id uuid references public.vendedores (id) on delete set null,
  solicitado_por uuid references public.usuarios (id) on delete set null,
  fonte text not null
    constraint prospeccao_enriquecimentos_fonte_check check (fonte in ('protesto', 'cadastral')),
  status text not null
    constraint prospeccao_enriquecimentos_status_check
    check (status in ('sucesso', 'sem_dados', 'erro')),
  custo numeric(10, 2) not null default 0,
  lote_id uuid references public.lotes_enriquecimento (id) on delete set null,
  erro text,
  executado_em timestamptz not null default now()
);

create index prospeccao_enriquecimentos_teto_idx
  on public.prospeccao_enriquecimentos (originador_id, executado_em desc);

comment on table public.prospeccao_enriquecimentos is
  'Ledger do gasto de enriquecimento deste funil (04r §5). Existe separado de '
  'descoberta_execucoes porque aquela é sobre CONTATO DE FORNECEDOR e tem '
  'fornecedor_cnpj NOT NULL — misturar os dois faria dois tetos virarem um.';

-- =============================================================================
-- §1 — RLS: quem vê o quê
--
--   Originador  os sacados cujo fluxo veio de um cedente que ELE segue.
--   Gestor      tudo, inclusive a fila sem dono — é ele quem atribui.
--
-- A FILA SEM DONO É DO GESTOR, e é a mesma decisão do 04g e do 04l: um sacado sem
-- titular é um sacado que ninguém trabalha, e deixá-lo visível para todos faria dois
-- originadores pedirem a mesma ponte ao mesmo fornecedor na mesma semana.
--
-- Aqui ela morde mais do que no 04l, e vale dizer: em 20/09/2026, 1 dos 130 cedentes
-- que emitem contra sacados não cadastrados tem titular vigente em `vendedor_carteira`.
-- Quase todo card nasce órfão. O caminho de saída não é afrouxar a policy — é o botão
-- "Seguir": seguir um cedente é o que faz os sacados dele aparecerem na SUA carteira.
--
-- ─── NENHUMA FUNÇÃO É CHAMADA POR LINHA ──────────────────────────────────────
--
-- `app_pode_ver_vendedor(originador_id)` dentro de um `using` roda por LINHA VARRIDA —
-- é a armadilha que estourou os 8s da tela de fornecedores a prospectar em 24/08 (0131)
-- e que a 0138f corrigiu. Como o argumento é a COLUNA, o envelope `(select ...)` não
-- salva: não há InitPlan possível sobre um valor que muda por linha. O predicado é
-- escrito aberto, e o planejador o avalia uma vez.
-- =============================================================================

alter table public.prospeccao_config enable row level security;
alter table public.fornecedores_seguidos enable row level security;
alter table public.sacados_prospeccao enable row level security;
alter table public.sacados_prospeccao_fornecedores enable row level security;
alter table public.prospeccao_enriquecimentos enable row level security;

/*
 * O predicado de visibilidade, uma vez só.
 *
 * Chamado pelas duas tabelas que se ligam ao card pelo CNPJ ou pelo id. Duas cópias do
 * mesmo EXISTS seriam dois lugares onde a regra pode divergir — e a primeira
 * divergência seria alguém vendo a quebra por fornecedor de um card que não enxerga,
 * que é exatamente o dado que o §6 manda proteger.
 */
create or replace function public.app_sacado_prospeccao_visivel(p_cnpj text)
returns boolean language sql stable security definer set search_path = '' as $$
  select
    public.app_gestor_comercial()
    or exists (
      select 1 from public.sacados_prospeccao s
      where s.cnpj_sacado = p_cnpj
        and (
          s.originador_id = public.app_vendedor_atual()
          or s.originador_id in (
            select a.pode_ver_vendedor_id from public.vendedor_acessos a
            where a.vendedor_id = public.app_vendedor_atual()
          )
        )
    );
$$;

comment on function public.app_sacado_prospeccao_visivel is
  'Este usuário enxerga o card deste sacado? Gestor sempre; originador quando o card '
  'está atribuído a ele (ou a alguém que ele pode ver). Card sem dono é do gestor.';

revoke execute on function public.app_sacado_prospeccao_visivel(text) from public, anon;
grant execute on function public.app_sacado_prospeccao_visivel(text) to authenticated, service_role;

-- A config é lida por qualquer um do módulo: o card mostra o custo estimado do clique e
-- a régua do valor operável, e os dois números vêm daqui. Escrever, só o gestor, e por RPC.
create policy prospeccao_config_select on public.prospeccao_config
  for select using ((select public.app_tem_modulo('antecipacao')));

/*
 * O SEGUIR é do originador, e ele precisa VER o próprio.
 *
 * Sem esta policy o botão "Seguir" viraria um interruptor sem lâmpada: o clique grava,
 * a tela não consegue ler de volta, e a pessoa clica de novo achando que não pegou.
 */
create policy fornecedores_seguidos_select on public.fornecedores_seguidos
  for select using (
    (select public.app_tem_modulo('antecipacao'))
    and (
      (select public.app_gestor_comercial())
      or originador_id = (select public.app_vendedor_atual())
      or originador_id in (
        select a.pode_ver_vendedor_id from public.vendedor_acessos a
        where a.vendedor_id = (select public.app_vendedor_atual())
      )
    )
  );

create policy sacados_prospeccao_select on public.sacados_prospeccao
  for select using (
    (select public.app_tem_modulo('antecipacao'))
    and (
      (select public.app_gestor_comercial())
      or originador_id = (select public.app_vendedor_atual())
      or originador_id in (
        select a.pode_ver_vendedor_id from public.vendedor_acessos a
        where a.vendedor_id = (select public.app_vendedor_atual())
      )
    )
  );

create policy sacados_prospeccao_fornecedores_select on public.sacados_prospeccao_fornecedores
  for select using (
    (select public.app_tem_modulo('antecipacao'))
    and exists (
      select 1 from public.sacados_prospeccao s
      where s.id = sacado_prospeccao_id
        and (
          (select public.app_gestor_comercial())
          or s.originador_id = (select public.app_vendedor_atual())
          or s.originador_id in (
            select a.pode_ver_vendedor_id from public.vendedor_acessos a
            where a.vendedor_id = (select public.app_vendedor_atual())
          )
        )
    )
  );

/*
 * O gasto é dado pessoal-adjacente: ele diz quanto alguém consumiu do próprio teto. A
 * régua é a do VENDEDOR, não a do card — o gestor precisa auditar quem estourou mesmo
 * num sacado que já saiu do funil.
 */
create policy prospeccao_enriquecimentos_select on public.prospeccao_enriquecimentos
  for select using (
    (select public.app_tem_modulo('antecipacao'))
    and (
      (select public.app_gestor_comercial())
      or originador_id = (select public.app_vendedor_atual())
      or originador_id in (
        select a.pode_ver_vendedor_id from public.vendedor_acessos a
        where a.vendedor_id = (select public.app_vendedor_atual())
      )
    )
  );

grant select on public.prospeccao_config, public.fornecedores_seguidos,
  public.sacados_prospeccao, public.sacados_prospeccao_fornecedores,
  public.prospeccao_enriquecimentos
  to authenticated;

-- Nenhum insert/update/delete para `authenticated` em nenhuma delas. "Solicitar
-- análise" grava a análise na esteira, o estágio, o vínculo e o evento numa transação
-- só; meia transação aqui é um card em `analise_solicitada` sem análise nenhuma do
-- outro lado — e o originador esperando uma resposta que nunca vai vir.

-- =============================================================================
-- §7 — `vendedor_carteira` passa a saber que um vínculo pode nascer deste funil
--
-- O CHECK vivo aceitava só `manual` e `automatica`. `automatica` já é usado pelo
-- roteamento e pelo funil de vendas, e reusá-lo aqui apagaria a única pergunta que a
-- auditoria de §7 precisa responder: este sacado entrou na carteira porque o território
-- mandou, ou porque alguém o descobriu numa nota?
--
-- Lido do BANCO, e não da migração original: 0132 escreveu a lista, e recriá-la a
-- partir dela apagaria qualquer valor que outra migração tenha acrescentado no meio.
-- =============================================================================

alter table public.vendedor_carteira drop constraint vendedor_carteira_origem_check;
alter table public.vendedor_carteira
  add constraint vendedor_carteira_origem_check
  check (origem in ('manual', 'automatica', 'prospeccao_fluxo'));

comment on column public.vendedor_carteira.origem is
  'manual = um gestor definiu. automatica = o roteamento por território criou. '
  'prospeccao_fluxo = o sacado foi descoberto no funil de Sacados por NF (04r §7) e a '
  'aprovação da esteira o entregou a quem o descobriu, sobrepondo o território.';

-- =============================================================================
-- §5 — "Solicitar análise" passa a ter UMA implementação
--
-- É o quinto achado da mesma família (0060, 0066, 0068, 0138): uma função que outro
-- módulo precisa existe, funciona, e está atrás de um portão de módulo que ele não tem.
-- `app_solicitar_analise` exige `credito` ou `empresas`; o público desta tela é o
-- Comercial, que tem `antecipacao`.
--
-- A saída é a de sempre: o NÚCLEO desce para uma função sem portão nenhum, revogada de
-- todo mundo, e cada porta de entrada põe a própria autorização em cima. Copiar o corpo
-- seria plantar dois lugares onde a regra "já existe análise em andamento" pode
-- divergir — e a divergência apareceria como duas análises abertas para o mesmo CNPJ,
-- que a esteira não sabe resolver.
--
-- `origem_motivo` é onde `prospeccao_fluxo` mora, e NÃO `origem`. A coluna `origem` diz
-- qual SISTEMA criou a análise (jobsiteos, atradius_backfill, api_producao) e esta
-- nasceu aqui como qualquer outra; `origem_motivo` é literalmente "por que pediram"
-- (ver o comentário da coluna, 0187). Escrever `prospeccao_fluxo` em `origem` diria que
-- existe um quarto sistema, e quebraria a contagem por sistema que o report semanal faz.
-- =============================================================================

create or replace function public.app__abrir_analise_credito(
  p_empresa_id uuid,
  p_limite numeric,
  p_observacoes text,
  p_origem_motivo text,
  p_ator uuid
)
returns public.analises_credito language plpgsql security definer set search_path = '' as $$
declare
  v_empresa public.empresas;
  v_linha public.analises_credito;
begin
  select * into v_empresa from public.empresas where id = p_empresa_id;
  if v_empresa.id is null then
    raise exception 'Empresa não encontrada.' using errcode = 'no_data_found';
  end if;

  if v_empresa.tipo not in ('construtora', 'incorporadora') then
    raise exception 'Análise de crédito é para sacados (construtora/incorporadora).'
      using errcode = '22023';
  end if;

  if exists (
    select 1 from public.analises_credito a
    where a.cnpj = v_empresa.cnpj
      and a.estagio in ('rascunho', 'solicitada', 'docs_pendentes', 'docs_recebidos',
                        'enviada_seguradora', 'em_analise')
  ) then
    raise exception 'Já existe uma análise em andamento para este CNPJ.' using errcode = '23505';
  end if;

  insert into public.analises_credito (
    empresa_id, cnpj, estagio, limite_solicitado, observacoes, solicitada_por, origem_motivo
  )
  values (
    v_empresa.id, v_empresa.cnpj, 'solicitada',
    coalesce(p_limite, public.app_arredondar_limite_sugerido(v_empresa.limite_potencial)),
    nullif(p_observacoes, ''), p_ator, nullif(p_origem_motivo, '')
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
      'analise_id', v_linha.id,
      'origem_motivo', v_linha.origem_motivo
    ),
    p_ator
  );

  return v_linha;
end $$;

comment on function public.app__abrir_analise_credito is
  'Núcleo compartilhado de "abrir análise na esteira": valida tipo, recusa a segunda '
  'análise aberta, grava e emite o evento. SEM portão de módulo — quem chama põe o seu. '
  'Revogada de todos os papéis de sessão de propósito.';

revoke execute on function public.app__abrir_analise_credito(uuid, numeric, text, text, uuid)
  from public, anon, authenticated;

-- A porta de entrada do Crédito/Empresas continua exatamente onde estava, com o mesmo
-- nome, a mesma assinatura e a mesma autorização. O que mudou é que o corpo dela agora
-- é uma chamada.
create or replace function public.app_solicitar_analise(p jsonb)
returns public.analises_credito language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_linha public.analises_credito;
begin
  if not (public.app_tem_modulo('credito') or public.app_tem_modulo('empresas')) then
    raise exception 'Sem acesso para solicitar análise de crédito.' using errcode = '42501';
  end if;

  v_linha := public.app__abrir_analise_credito(
    (p ->> 'empresa_id')::uuid,
    nullif(p ->> 'limite_solicitado', '')::numeric,
    p ->> 'observacoes',
    null,
    v_ator
  );

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'analise.solicitada', 'analises_credito', v_linha.id::text, p);

  return v_linha;
end $$;

/*
 * `create or replace function` PRESERVA a ACL — a mesma cicatriz da 0138k. Reescrever o
 * corpo de `app_solicitar_analise` herdou a permissão que ela já tinha; quem reescreve o
 * corpo passa a responder pela ACL dele.
 */
revoke execute on function public.app_solicitar_analise(jsonb) from public, anon;
grant execute on function public.app_solicitar_analise(jsonb) to authenticated, service_role;

-- =============================================================================
-- §5 — O pedido de apresentação passa a ter DIREÇÃO
--
-- `pedidos_apresentacao` (0138) foi escrita para UM sentido: nós pedimos ao SACADO
-- (nosso cliente) que nos apresente a um FORNECEDOR dele. É por isso que a coluna de
-- contato se chama `contato_sacado_id` — o destinatário era o sacado.
--
-- Neste funil o sentido é o inverso: o fornecedor é nosso, o sacado é o prospect, e
-- quem recebe a mensagem é o FORNECEDOR. Guardar o contato dele numa coluna chamada
-- `contato_sacado_id` faria toda leitura futura dessa tabela mentir sobre com quem se
-- falou — e "com quem se falou" é exatamente o que um registro de ponte existe para
-- dizer.
--
-- Mesma tabela (o par fornecedor × sacado é o mesmo fato, e o §5 manda reusá-la), com
-- uma coluna que diz para onde a mensagem foi.
-- =============================================================================

alter table public.pedidos_apresentacao
  add column direcao text not null default 'para_sacado'
    constraint pedidos_apresentacao_direcao_check
    check (direcao in ('para_sacado', 'para_fornecedor')),
  add column contato_fornecedor_id uuid references public.contatos (id) on delete set null;

comment on column public.pedidos_apresentacao.direcao is
  'para_sacado = pedimos ao nosso cliente que nos apresente ao fornecedor dele (04l). '
  'para_fornecedor = pedimos ao nosso cedente que nos apresente à construtora contra a '
  'qual ele fatura (04r). O default preserva o sentido de todas as linhas anteriores, '
  'que só podiam ser o primeiro.';
comment on column public.pedidos_apresentacao.contato_sacado_id is
  'Quem recebe, quando direcao = para_sacado. Nulo no outro sentido.';
comment on column public.pedidos_apresentacao.contato_fornecedor_id is
  'Quem recebe, quando direcao = para_fornecedor. Nulo no outro sentido.';

/*
 * A POLICY DA TABELA precisa enxergar os dois sentidos.
 *
 * Ela hoje diz `app_fornecedor_visivel(fornecedor_cnpj)`, que exige uma linha em
 * `fornecedores_funil`. Neste funil o fornecedor é CLIENTE — ele nunca esteve naquele
 * kanban, então a policy negaria a leitura de um pedido que a própria pessoa acabou de
 * criar, e o card mostraria "nenhum pedido" logo depois de mandar um.
 */
drop policy pedidos_apresentacao_select on public.pedidos_apresentacao;

create policy pedidos_apresentacao_select on public.pedidos_apresentacao
  for select using (
    (
      (select public.app_tem_modulo('comercial'))
      and public.app_fornecedor_visivel(fornecedor_cnpj)
    )
    or (
      (select public.app_tem_modulo('antecipacao'))
      and public.app_sacado_prospeccao_visivel(sacado_cnpj)
    )
  );

-- =============================================================================
-- §5 — Escritas do módulo. Todas por RPC.
-- =============================================================================

/*
 * O motivo de descarte vem da CONFIG (§8), não de um enum fixo no CHECK.
 *
 * A lista é curta e muda com o aprendizado comercial — "fornecedor não fez a ponte" só
 * virou motivo depois de esta tela existir. Um CHECK obrigaria migração para cada
 * palavra nova; a validação aqui obriga apenas um `update` na tela de settings.
 *
 * O que NÃO é configurável é a exigência de haver um motivo: a contagem "quantos
 * perdemos porque a ponte não andou?" é a única saída útil de um card descartado.
 */
create or replace function public.app__prospeccao_motivo_valido(p_motivo text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.prospeccao_config c,
         lateral jsonb_array_elements(c.valor) m
    where c.chave = 'motivos_descarte' and m ->> 'id' = p_motivo
  );
$$;

revoke execute on function public.app__prospeccao_motivo_valido(text) from public, anon;
grant execute on function public.app__prospeccao_motivo_valido(text) to authenticated, service_role;

-- ─── O estágio do card vira evento de timeline (§9) ─────────────────────────
--
-- `audit_log` responde "quem fez o quê" para auditoria; `empresa_eventos` responde "o
-- que aconteceu com esta empresa" para quem abre a ficha dela. Mover um card e descartá-lo
-- são fatos da segunda espécie: seis meses depois, a pergunta "alguém já trabalhou esta
-- construtora?" se faz na Company 360, não no log.
--
-- `sacado_prospeccao.analise_solicitada` está no §9 e NÃO existe como tipo. A ausência é
-- deliberada: `app__abrir_analise_credito` já emite `analise.solicitada` na timeline da
-- empresa, com `origem_motivo` no payload — que é exatamente o que separa "veio do funil
-- de fluxo" de "veio do Crédito". Um segundo tipo para o mesmo fato partiria a timeline
-- em duas metades que ninguém cruzaria, que é a mesma decisão já tomada para
-- `fornecedor.sem_interesse` (04l) e `toque.manual` (05A).

create or replace function public.app__prospeccao_evento_estagio(
  p_card public.sacados_prospeccao,
  p_era text,
  p_ator uuid
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (
    p_card.empresa_id, 'sacado_prospeccao.estagio_alterado',
    jsonb_build_object(
      'titulo', 'Sacado por NF mudou de estágio',
      'resumo', coalesce(p_card.sacado_nome, p_card.cnpj_sacado) || ': ' ||
                p_era || ' → ' || p_card.estagio ||
                coalesce(' (' || p_card.motivo_saida || ')', ''),
      'url', '/antecipacao/sacados-por-nf',
      'cnpj_sacado', p_card.cnpj_sacado,
      'de', p_era,
      'para', p_card.estagio,
      'motivo', p_card.motivo_saida
    ),
    p_ator
  );
end $$;

revoke execute on function public.app__prospeccao_evento_estagio(public.sacados_prospeccao, text, uuid)
  from public, anon, authenticated;

-- ─── Mover de estágio ───────────────────────────────────────────────────────
create or replace function public.app_prospeccao_mover(p jsonb)
returns public.sacados_prospeccao language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_cnpj text := p ->> 'cnpj_sacado';
  v_estagio text := p ->> 'estagio';
  v_era text;
  v_linha public.sacados_prospeccao;
begin
  if not public.app_tem_modulo('antecipacao') then
    raise exception 'Sem acesso ao módulo Antecipação.' using errcode = '42501';
  end if;
  if not public.app_sacado_prospeccao_visivel(v_cnpj) then
    raise exception 'Este sacado não está na sua carteira.' using errcode = '42501';
  end if;

  /*
   * Quatro estágios NÃO se alcançam arrastando o card, e a recusa é a mensagem:
   *
   *   `aprovado` e `recusado` são FATO DA ESTEIRA. Marcá-los à mão criaria a carteira
   *   do §7 (ou fecharia o card) sem que limite nenhum tenha sido decidido — e a
   *   comissão do 04k passaria a correr sobre um sacado que ninguém aprovou.
   *   `sem_interesse` e `descartado` exigem motivo, e um gesto de arrastar não tem
   *   onde pedi-lo.
   */
  if v_estagio in ('aprovado', 'recusado') then
    raise exception 'Este estágio é decidido pela esteira de crédito, não pela tela.'
      using errcode = '23514';
  end if;
  if v_estagio in ('sem_interesse', 'descartado') then
    raise exception 'Use "descartar": estes estágios exigem motivo.' using errcode = '23514';
  end if;
  if v_estagio not in ('identificado', 'fornecedor_consultado', 'apresentacao_solicitada') then
    raise exception 'Estágio inválido: %.', v_estagio using errcode = '22023';
  end if;

  select estagio into v_era from public.sacados_prospeccao where cnpj_sacado = v_cnpj;
  if v_era is null then
    raise exception 'Sacado não está no funil.' using errcode = 'no_data_found';
  end if;

  update public.sacados_prospeccao
     set estagio = v_estagio,
         estagio_alterado_em = now(),
         estagio_alterado_por = v_ator,
         -- Reabrir desfaz a marcação inteira, não só a coluna de estágio: um motivo de
         -- descarte pendurado num card ativo é a tela dizendo duas coisas ao mesmo tempo.
         motivo_saida = null,
         observacao_saida = null
   where cnpj_sacado = v_cnpj
  returning * into v_linha;

  -- Mexer no card sem sair do lugar não é notícia para a timeline de ninguém.
  if v_era is distinct from v_estagio then
    perform public.app__prospeccao_evento_estagio(v_linha, v_era, v_ator);
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'prospeccao.mover', 'sacados_prospeccao', v_linha.id::text, p);

  return v_linha;
end $$;

-- ─── Descartar / sem interesse ──────────────────────────────────────────────
/*
 * NÃO grava supressão de canal, e a diferença com o 04l é o SUJEITO.
 *
 * Lá o descarte é sobre o FORNECEDOR que disse "não me procurem" — e aí a supressão é o
 * que impede o outbox de voltar a escrever para ele. Aqui o card é sobre uma construtora
 * com quem, pelo §6, NUNCA falamos diretamente: não há canal aberto para suprimir. Criar
 * uma supressão por este caminho bloquearia o CNPJ para os outros módulos (Radar,
 * Campanhas) por causa de uma ponte que não andou, que é uma decisão que ninguém tomou.
 */
create or replace function public.app_prospeccao_descartar(p jsonb)
returns public.sacados_prospeccao language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_cnpj text := p ->> 'cnpj_sacado';
  v_estagio text := coalesce(nullif(p ->> 'estagio', ''), 'descartado');
  v_motivo text := p ->> 'motivo';
  v_obs text := nullif(p ->> 'observacao', '');
  v_era text;
  v_linha public.sacados_prospeccao;
begin
  if not public.app_tem_modulo('antecipacao') then
    raise exception 'Sem acesso ao módulo Antecipação.' using errcode = '42501';
  end if;
  if not public.app_sacado_prospeccao_visivel(v_cnpj) then
    raise exception 'Este sacado não está na sua carteira.' using errcode = '42501';
  end if;
  if v_estagio not in ('descartado', 'sem_interesse') then
    raise exception 'Estágio inválido para descarte: %.', v_estagio using errcode = '22023';
  end if;
  if not public.app__prospeccao_motivo_valido(v_motivo) then
    raise exception 'Motivo inválido: %. A lista vive em Configurações.', coalesce(v_motivo, '(vazio)')
      using errcode = '22023';
  end if;
  if v_motivo = 'outro' and v_obs is null then
    raise exception 'Com motivo "Outro", a observação é obrigatória.' using errcode = '23514';
  end if;

  select estagio into v_era from public.sacados_prospeccao where cnpj_sacado = v_cnpj;
  if v_era is null then
    raise exception 'Sacado não está no funil.' using errcode = 'no_data_found';
  end if;

  update public.sacados_prospeccao
     set estagio = v_estagio,
         motivo_saida = v_motivo,
         observacao_saida = v_obs,
         estagio_alterado_em = now(),
         estagio_alterado_por = v_ator
   where cnpj_sacado = v_cnpj
  returning * into v_linha;

  perform public.app__prospeccao_evento_estagio(v_linha, v_era, v_ator);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'prospeccao.descartar', 'sacados_prospeccao', v_linha.id::text, p);

  return v_linha;
end $$;

-- ─── Reatribuir (gestor) ────────────────────────────────────────────────────
create or replace function public.app_prospeccao_reatribuir(p jsonb)
returns public.sacados_prospeccao language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_cnpj text := p ->> 'cnpj_sacado';
  v_orig uuid := nullif(p ->> 'originador_id', '')::uuid;
  v_linha public.sacados_prospeccao;
begin
  -- Reatribuir é decidir de quem é o trabalho e, por tabela, de quem é o teto de
  -- enriquecimento que o clique vai consumir. Fica com o gestor, como a Fila sem Dono.
  if not public.app_gestor_comercial() then
    raise exception 'Só um gestor comercial reatribui sacado.' using errcode = '42501';
  end if;

  if v_orig is not null and not exists (
    select 1 from public.vendedores v where v.id = v_orig and v.ativo
  ) then
    raise exception 'Vendedor inexistente ou inativo.' using errcode = '23503';
  end if;

  update public.sacados_prospeccao
     set originador_id = v_orig,
         -- `manual` é o que impede o job noturno de desfazer esta decisão. Voltar para
         -- null devolve o card à fila E à derivação automática: "sem dono" não é uma
         -- escolha a preservar, é a ausência de uma.
         originador_origem = case when v_orig is null then 'automatica' else 'manual' end
   where cnpj_sacado = v_cnpj
  returning * into v_linha;

  if v_linha.id is null then
    raise exception 'Sacado não está no funil.' using errcode = 'no_data_found';
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'prospeccao.reatribuir', 'sacados_prospeccao', v_linha.id::text, p);

  return v_linha;
end $$;

-- ─── Solicitar análise de crédito ───────────────────────────────────────────
create or replace function public.app_prospeccao_solicitar_analise(p jsonb)
returns public.analises_credito language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_cnpj text := p ->> 'cnpj_sacado';
  v_card public.sacados_prospeccao;
  v_analise public.analises_credito;
begin
  if not public.app_tem_modulo('antecipacao') then
    raise exception 'Sem acesso ao módulo Antecipação.' using errcode = '42501';
  end if;
  if not public.app_sacado_prospeccao_visivel(v_cnpj) then
    raise exception 'Este sacado não está na sua carteira.' using errcode = '42501';
  end if;

  select * into v_card from public.sacados_prospeccao where cnpj_sacado = v_cnpj;
  if v_card.id is null then
    raise exception 'Sacado não está no funil.' using errcode = 'no_data_found';
  end if;
  /*
   * A ficha é criada pelo JOB, com o tipo derivado do CNAE pela régua que mora no
   * TypeScript (`tipoDeEmpresaPorCnae`) — a 0195 derrubou a cópia em SQL exatamente
   * para não haver duas. Se ela ainda não existe, é porque o cadastral não respondeu, e
   * a resposta certa é dizer isso em vez de inventar um tipo aqui.
   */
  if v_card.empresa_id is null then
    raise exception 'Este CNPJ ainda não tem ficha: o cadastral não respondeu. Ele está na fila de lookup.'
      using errcode = 'no_data_found';
  end if;

  v_analise := public.app__abrir_analise_credito(
    v_card.empresa_id,
    nullif(p ->> 'limite_solicitado', '')::numeric,
    p ->> 'observacoes',
    'prospeccao_fluxo',
    v_ator
  );

  update public.sacados_prospeccao
     set estagio = 'analise_solicitada',
         analise_credito_id = v_analise.id,
         estagio_alterado_em = now(),
         estagio_alterado_por = v_ator
   where id = v_card.id;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'prospeccao.solicitar_analise', 'analises_credito', v_analise.id::text, p);

  return v_analise;
end $$;

-- ─── Seguir / deixar de seguir um cedente (§2) ──────────────────────────────
create or replace function public.app_prospeccao_seguir(p jsonb)
returns public.fornecedores_seguidos language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_cnpj text := p ->> 'fornecedor_cnpj';
  v_seguir boolean := coalesce((p ->> 'seguir')::boolean, true);
  v_eu uuid := public.app_vendedor_atual();
  v_orig uuid := coalesce(nullif(p ->> 'originador_id', '')::uuid, v_eu);
  v_linha public.fornecedores_seguidos;
begin
  if not public.app_tem_modulo('antecipacao') then
    raise exception 'Sem acesso ao módulo Antecipação.' using errcode = '42501';
  end if;
  if v_orig is null then
    raise exception 'Seu usuário não está ligado a um vendedor.' using errcode = '42501';
  end if;
  -- Seguir em nome de outra pessoa é enfiar trabalho na carteira dela. Só o gestor.
  if v_orig <> v_eu and not public.app_gestor_comercial() then
    raise exception 'Só um gestor comercial segue um cedente em nome de outra pessoa.'
      using errcode = '42501';
  end if;

  /*
   * Seguir só faz sentido para CEDENTE NOSSO. O funil inteiro se apoia em enxergar as
   * notas que ele emite, e isso só existe porque temos o certificado digital dele —
   * seguir um CNPJ de fora seria assinar uma lista que nunca vai encher.
   */
  if not exists (
    select 1 from public.notas_fiscais nf
    where nf.fornecedor_cnpj = v_cnpj and nf.fornecedor_cadastrado is true
  ) then
    raise exception 'Este CNPJ não é um cedente com notas na base.' using errcode = 'no_data_found';
  end if;

  if v_seguir then
    insert into public.fornecedores_seguidos (originador_id, fornecedor_cnpj, origem, criado_por)
    values (v_orig, v_cnpj, 'manual', v_ator)
    on conflict (originador_id, fornecedor_cnpj, origem) where ate is null do nothing;

    select * into v_linha from public.fornecedores_seguidos
     where originador_id = v_orig and fornecedor_cnpj = v_cnpj and origem = 'manual' and ate is null;
  else
    /*
     * Fecha SÓ a linha manual. A titularidade é espelho de `vendedor_carteira`, e apagá-la
     * daqui faria o job diário recriá-la na madrugada seguinte — um botão que se desfaz
     * sozinho é pior que um botão que não existe. Quem deixa de ser titular é o 04k.
     */
    update public.fornecedores_seguidos
       set ate = now()
     where originador_id = v_orig and fornecedor_cnpj = v_cnpj and origem = 'manual' and ate is null
    returning * into v_linha;
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, case when v_seguir then 'prospeccao.seguir' else 'prospeccao.deixar_de_seguir' end,
          'fornecedores_seguidos', coalesce(v_linha.id::text, v_cnpj), p);

  return v_linha;
end $$;

-- ─── Pedir apresentação AO FORNECEDOR (§5) ──────────────────────────────────
create or replace function public.app_prospeccao_pedir_apresentacao(p jsonb)
returns public.pedidos_apresentacao language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_sacado text := p ->> 'cnpj_sacado';
  v_forn text := p ->> 'fornecedor_cnpj';
  v_card public.sacados_prospeccao;
  v_pedido public.pedidos_apresentacao;
begin
  if not public.app_tem_modulo('antecipacao') then
    raise exception 'Sem acesso ao módulo Antecipação.' using errcode = '42501';
  end if;
  if not public.app_sacado_prospeccao_visivel(v_sacado) then
    raise exception 'Este sacado não está na sua carteira.' using errcode = '42501';
  end if;

  select * into v_card from public.sacados_prospeccao where cnpj_sacado = v_sacado;
  if v_card.id is null then
    raise exception 'Sacado não está no funil.' using errcode = 'no_data_found';
  end if;

  /*
   * O fornecedor tem de ser um fornecedor DESTE sacado, e a evidência é a quebra do
   * próprio card. Sem esta guarda o pedido viraria um caminho para escrever a qualquer
   * cliente nosso a pretexto de uma ponte — e a mensagem sairia dizendo "você tem a
   * receber da Construtora X" para quem nunca faturou contra ela.
   */
  if not exists (
    select 1 from public.sacados_prospeccao_fornecedores f
    where f.sacado_prospeccao_id = v_card.id and f.fornecedor_cnpj = v_forn
  ) then
    raise exception 'Este cedente não emitiu contra este sacado na janela.' using errcode = '23514';
  end if;

  insert into public.pedidos_apresentacao
    (fornecedor_cnpj, sacado_cnpj, direcao, contato_fornecedor_id, mensagem, status, solicitado_por)
  values (
    v_forn, v_sacado, 'para_fornecedor',
    nullif(p ->> 'contato_fornecedor_id', '')::uuid,
    p ->> 'mensagem', 'rascunho', v_ator
  )
  returning * into v_pedido;

  /*
   * O evento vai na timeline do FORNECEDOR, não do sacado: quem vai receber o pedido é o
   * nosso cedente, e é na ficha dele que alguém precisa ver que já pedimos um favor. É a
   * mesma regra do 04l ("na ficha de quem recebe"), com o destinatário invertido.
   */
  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  select e.id, 'apresentacao.solicitada',
    jsonb_build_object(
      'titulo', 'Apresentação pedida ao cedente',
      'resumo', 'Pedimos a ponte para a construtora ' ||
                coalesce(v_card.sacado_nome, v_card.cnpj_sacado) || '.',
      'url', '/antecipacao/sacados-por-nf',
      'fornecedor_cnpj', v_forn,
      'sacado_cnpj', v_sacado
    ),
    v_ator
  from public.empresas e where e.cnpj = v_forn;

  -- Pedir a ponte É o trabalho da coluna. Mover o card à mão depois é a etapa que
  -- ninguém faz, e o funil fica dizendo que ninguém pediu nada.
  update public.sacados_prospeccao
     set estagio = 'apresentacao_solicitada',
         estagio_alterado_em = now(),
         estagio_alterado_por = v_ator
   where id = v_card.id
     and estagio in ('identificado', 'fornecedor_consultado');

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'prospeccao.pedir_apresentacao', 'pedidos_apresentacao', v_pedido.id::text, p);

  return v_pedido;
end $$;

-- ─── Settings ───────────────────────────────────────────────────────────────
create or replace function public.app_salvar_prospeccao_config(p jsonb)
returns public.prospeccao_config language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_linha public.prospeccao_config;
begin
  if not (public.app_gestor_comercial() or public.app_is_admin()) then
    raise exception 'Só um gestor comercial altera as configurações.' using errcode = '42501';
  end if;

  insert into public.prospeccao_config (chave, valor, atualizado_por, atualizado_em)
  values (p ->> 'chave', p -> 'valor', v_ator, now())
  on conflict (chave) do update
    set valor = excluded.valor, atualizado_por = excluded.atualizado_por, atualizado_em = now()
  returning * into v_linha;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'prospeccao.config', 'prospeccao_config', v_linha.chave, p);

  return v_linha;
end $$;

-- ─── Grants das escritas ────────────────────────────────────────────────────
revoke execute on function public.app_prospeccao_mover(jsonb) from public, anon;
revoke execute on function public.app_prospeccao_descartar(jsonb) from public, anon;
revoke execute on function public.app_prospeccao_reatribuir(jsonb) from public, anon;
revoke execute on function public.app_prospeccao_solicitar_analise(jsonb) from public, anon;
revoke execute on function public.app_prospeccao_seguir(jsonb) from public, anon;
revoke execute on function public.app_prospeccao_pedir_apresentacao(jsonb) from public, anon;
revoke execute on function public.app_salvar_prospeccao_config(jsonb) from public, anon;

grant execute on function public.app_prospeccao_mover(jsonb) to authenticated, service_role;
grant execute on function public.app_prospeccao_descartar(jsonb) to authenticated, service_role;
grant execute on function public.app_prospeccao_reatribuir(jsonb) to authenticated, service_role;
grant execute on function public.app_prospeccao_solicitar_analise(jsonb) to authenticated, service_role;
grant execute on function public.app_prospeccao_seguir(jsonb) to authenticated, service_role;
grant execute on function public.app_prospeccao_pedir_apresentacao(jsonb) to authenticated, service_role;
grant execute on function public.app_salvar_prospeccao_config(jsonb) to authenticated, service_role;

-- =============================================================================
-- §5/§7 — A decisão da esteira move o card sozinha, e a aprovação cria a carteira
--
-- POR QUE TRIGGER, E NÃO O JOB.
--
-- A esteira é movimentada por quatro caminhos diferentes: a tela do Crédito, o poll da
-- Atradius, o RPC de conclusão do confronto (04j) e a API de produção. Um job noturno
-- que varresse `analises_credito` faria o card ficar até 24h dizendo "em análise"
-- depois de aprovado — e a carteira do §7 só nasceria na madrugada seguinte, com a
-- comissão do 04k correndo a partir de uma data que não é a da aprovação.
--
-- Pendurar a regra na TRANSAÇÃO que decide é o que faz o dono e a data serem exatamente
-- os que a decisão produziu, venha ela de onde vier.
-- =============================================================================

create or replace function public.prospeccao_reagir_a_decisao()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_card public.sacados_prospeccao;
  v_usuario uuid;
  v_nome text;
begin
  -- Só reage a MUDANÇA de estágio. A esteira sofre updates por outros motivos (limite
  -- ajustado, case id da seguradora), e reagir a todos reescreveria o card sem fato novo.
  if new.estagio is not distinct from old.estagio then
    return new;
  end if;

  select * into v_card from public.sacados_prospeccao where analise_credito_id = new.id;
  if v_card.id is null then
    return new;
  end if;

  -- ── Ainda em curso ──────────────────────────────────────────────────────
  if new.estagio in ('enviada_seguradora', 'em_analise') then
    update public.sacados_prospeccao
       set estagio = 'em_analise', estagio_alterado_em = now()
     where id = v_card.id and estagio in ('analise_solicitada', 'em_analise');
    return new;
  end if;

  -- ── Aprovada ────────────────────────────────────────────────────────────
  if new.estagio in ('aprovada', 'aprovada_parcial') then
    update public.sacados_prospeccao
       set estagio = 'aprovado',
           estagio_alterado_em = now(),
           motivo_saida = null,
           observacao_saida = null
     where id = v_card.id;

    /*
     * §7 — O sacado entra na carteira de quem o descobriu, SOBREPONDO o roteamento por
     * território. É o único vínculo do sistema que nasce de uma descoberta, e é por isso
     * que `origem = 'prospeccao_fluxo'`: sem ele, seis meses depois ninguém consegue
     * responder se aquele sacado veio do mapa ou do trabalho de alguém.
     *
     * O vínculo anterior é FECHADO, não sobrescrito: `vendedor_carteira` é uma linha do
     * tempo, e é dela que o motor de comissões (04k) tira o dono NA DATA de cada
     * operação. Apagar a janela antiga reescreveria comissões já apuradas.
     *
     * Card sem dono não cria carteira nenhuma. "Ninguém descobriu" não é um dono, e
     * inventar um aqui daria comissão a quem não trabalhou.
     */
    if v_card.originador_id is not null then
      update public.vendedor_carteira
         set ate = now()
       where empresa_id = v_card.empresa_id
         and papel = 'originacao'
         and ate is null
         and share_pct = 100
         and vendedor_id <> v_card.originador_id;

      insert into public.vendedor_carteira (vendedor_id, empresa_id, papel, desde, share_pct, origem)
      select v_card.originador_id, v_card.empresa_id, 'originacao', now(), 100, 'prospeccao_fluxo'
      where v_card.empresa_id is not null
        and not exists (
          select 1 from public.vendedor_carteira c
          where c.empresa_id = v_card.empresa_id and c.papel = 'originacao'
            and c.ate is null and c.vendedor_id = v_card.originador_id
        );
    end if;

    insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
    values (
      v_card.empresa_id, 'sacado_prospeccao.aprovado',
      jsonb_build_object(
        'titulo', 'Sacado descoberto por fluxo foi aprovado',
        'resumo', coalesce(v_card.sacado_nome, v_card.cnpj_sacado) ||
                  ' teve limite aprovado e entrou na carteira de quem a descobriu.',
        'url', '/antecipacao/sacados-por-nf',
        'cnpj_sacado', v_card.cnpj_sacado,
        'analise_id', new.id
      ),
      null
    );

  -- ── Negada ou cancelada ─────────────────────────────────────────────────
  elsif new.estagio in ('negada', 'cancelada') then
    update public.sacados_prospeccao
       set estagio = 'recusado',
           -- O motivo vem da ESTEIRA, e é por isso que ele não sai da lista de descarte
           -- comercial: "negada pela seguradora" não é uma decisão que alguém daqui tomou.
           motivo_saida = 'esteira_' || new.estagio,
           observacao_saida = nullif(new.motivo, ''),
           estagio_alterado_em = now()
     where id = v_card.id;

    insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
    values (
      v_card.empresa_id, 'sacado_prospeccao.recusado',
      jsonb_build_object(
        'titulo', 'Sacado descoberto por fluxo foi recusado',
        'resumo', coalesce(v_card.sacado_nome, v_card.cnpj_sacado) || ': ' ||
                  coalesce(nullif(new.motivo, ''), 'sem limite aprovado.'),
        'url', '/antecipacao/sacados-por-nf',
        'cnpj_sacado', v_card.cnpj_sacado,
        'analise_id', new.id
      ),
      null
    );
  else
    return new;
  end if;

  /*
   * A NOTIFICAÇÃO É NOMINAL (§9): quem esperava a resposta é o originador, não um perfil.
   *
   * O fan-out de `empresa_eventos` distribui por REGRA DE PERFIL, e é o certo para
   * "todo mundo do Crédito vê". Aqui o destinatário é uma pessoa específica, e ela pode
   * não estar em perfil nenhum que assine este evento. O sino dela precisa tocar.
   *
   * O push (Web Push / Expo) não sai daqui — trigger não fala HTTP. Ele vem do worker,
   * que lê as notificações novas pelo caminho de sempre.
   */
  select u.id into v_usuario
  from public.vendedores v join public.usuarios u on u.id = v.usuario_id
  where v.id = v_card.originador_id and u.ativo;

  if v_usuario is not null then
    v_nome := coalesce(v_card.sacado_nome, v_card.cnpj_sacado);
    insert into public.notificacoes (usuario_id, titulo, corpo, url)
    values (
      v_usuario,
      case when new.estagio in ('aprovada', 'aprovada_parcial')
           then 'Sacado aprovado: ' || v_nome
           else 'Sacado recusado: ' || v_nome end,
      case when new.estagio in ('aprovada', 'aprovada_parcial')
           then 'A esteira aprovou o limite. Ele entrou na sua carteira e as notas dele caem no funil de NFs.'
           else coalesce(nullif(new.motivo, ''), 'A esteira não aprovou limite para este CNPJ.') end,
      '/antecipacao/sacados-por-nf'
    );
  end if;

  return new;
end $$;

comment on function public.prospeccao_reagir_a_decisao is
  'A decisão da esteira move o card do funil de Sacados por NF e, quando aprova, cria a '
  'carteira do §7 na MESMA transação. Trigger em vez de job porque a esteira é '
  'movimentada por quatro caminhos e a data do vínculo precisa ser a da decisão.';

create trigger analises_credito_prospeccao
  after update on public.analises_credito
  for each row execute function public.prospeccao_reagir_a_decisao();

-- =============================================================================
-- §5 — Leitura: a view do kanban, o painel do originador e o detalhe nota a nota
-- =============================================================================

create view public.sacados_prospeccao_view
with (security_invoker = true) as
  select
    s.id,
    s.cnpj_sacado,
    -- A razão social do CADASTRO ganha do nome da nota (mesma razão de 0056/0101: o da
    -- nota é o que o emitente digitou, e vem abreviado com frequência).
    coalesce(mu.razao_social, s.sacado_nome, s.cnpj_sacado) as sacado_nome,
    mu.nome_fantasia,
    mu.municipio,
    mu.uf,
    mu.cnae_principal,
    mu.porte_rfb,
    mu.situacao_cadastral,
    mu.data_inicio_atividade,
    s.empresa_id,
    s.originador_id,
    s.originador_origem,
    v.nome as originador_nome,
    s.estagio,
    s.estagio_alterado_em,
    s.motivo_saida,
    s.observacao_saida,
    s.volume_30d,
    s.valor_operavel,
    s.qtd_nfs_30d,
    s.qtd_fornecedores,
    s.meses_com_emissao_6m,
    s.media_mensal_6m,
    s.prazo_medio_dias,
    s.ultima_nf_em,
    s.prazo_minimo_operavel_dias,
    s.prazo_minimo_origem,
    s.score_credito,
    s.score_completude,
    s.chance_concessao,
    s.faturamento_estimado,
    s.limite_potencial,
    s.valor_esperado_mensal,
    s.analise_credito_id,
    a.estagio as analise_estagio,
    a.limite_aprovado as analise_limite_aprovado,
    a.decidida_em as analise_decidida_em,
    s.entrou_em,
    s.atualizado_em
    /*
     * SEM contagens correlacionadas sobre a quebra por fornecedor nem sobre os pedidos.
     * É a cicatriz da 0138l: um `count(*)` numa view `security_invoker` avalia a RLS da
     * outra tabela POR LINHA — 200 avaliações numa página de 200 cards, e o custo só
     * aparece quando o recurso começa a ser usado. `qtd_fornecedores` já vive na linha,
     * escrito pelo job, e é o número que o card mostra.
     */
  from public.sacados_prospeccao s
    left join public.mercado_universo mu on mu.cnpj = s.cnpj_sacado
    left join public.vendedores v on v.id = s.originador_id
    left join public.analises_credito a on a.id = s.analise_credito_id;

grant select on public.sacados_prospeccao_view to authenticated;

comment on view public.sacados_prospeccao_view is
  'O card do funil de Sacados por NF com o cadastral e o estado da esteira juntos. '
  'security_invoker: a RLS de sacados_prospeccao é quem recorta por originador.';

-- ─── Painel do originador (§5) ──────────────────────────────────────────────
create or replace function public.prospeccao_painel(p_originador_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_eu uuid := public.app_vendedor_atual();
  v_gestor boolean := public.app_gestor_comercial();
  v_alvo uuid;
  v_todos boolean := false;
  v_r jsonb;
begin
  if not public.app_tem_modulo('antecipacao') then
    return jsonb_build_object('tem_acesso', false);
  end if;

  /*
   * O gestor abre na CARTEIRA INTEIRA; quem não é gestor vê só a própria. Passar o id de
   * outra pessoa sem ser gestor não levanta erro — devolve o painel de quem perguntou.
   * Um 403 aqui só ensinaria a tentar de novo com outro id; devolver o próprio painel
   * responde a pergunta que a pessoa tinha direito de fazer.
   */
  if p_originador_id is null then
    v_todos := v_gestor;
    v_alvo := v_eu;
  elsif v_gestor or p_originador_id = v_eu then
    v_alvo := p_originador_id;
  else
    v_alvo := v_eu;
  end if;

  select jsonb_build_object(
    'tem_acesso', true,
    'escopo', case when v_todos then 'todos' else 'originador' end,
    'originador_id', case when v_todos then null else v_alvo end,
    'sacados', count(*),
    'volume_observado', coalesce(sum(s.volume_30d), 0),
    'valor_operavel', coalesce(sum(s.valor_operavel), 0),
    'valor_esperado_mensal', coalesce(sum(s.valor_esperado_mensal), 0),
    -- Quantos estão parados esperando a esteira. É o número que responde "por que meu
    -- funil não anda?" sem que ninguém precise contar coluna na tela.
    'travados_na_esteira', count(*) filter (where s.estagio in ('analise_solicitada', 'em_analise')),
    'sem_dono', count(*) filter (where s.originador_id is null),
    'por_estagio', coalesce(
      (select jsonb_object_agg(x.estagio, x.n)
         from (select s2.estagio, count(*) as n
                 from public.sacados_prospeccao s2
                where (v_todos or s2.originador_id is not distinct from v_alvo)
                group by s2.estagio) x),
      '{}'::jsonb)
  )
  into v_r
  from public.sacados_prospeccao s
  where (v_todos or s.originador_id is not distinct from v_alvo)
    and s.estagio in ('identificado', 'fornecedor_consultado', 'apresentacao_solicitada',
                      'analise_solicitada', 'em_analise');

  return v_r;
end $$;

comment on function public.prospeccao_painel is
  'Painel do topo da aba Sacados por NF (04r §5): quantos sacados, volume observado, '
  'valor esperado mensal somado e quantos estão travados esperando análise. Os totais '
  'contam só o funil ATIVO — somar os encerrados faria o número crescer para sempre.';

revoke execute on function public.prospeccao_painel(uuid) from public, anon;
grant execute on function public.prospeccao_painel(uuid) to authenticated, service_role;

-- ─── O detalhe nota a nota (§5) ─────────────────────────────────────────────
/*
 * POR QUE RPC, E NÃO UMA CONSULTA DIRETA EM `notas_fiscais`.
 *
 * A policy daquela tabela recorta por vendedor da nota ou por carteira de empresa. O
 * originador deste funil não é nenhum dos dois: o sacado NÃO é cliente (é o ponto da
 * feature) e a nota costuma estar roteada para quem cuida do cedente. Lida direto, a
 * expansão do fornecedor viria VAZIA — e "nenhuma nota" com cara de resposta certa é o
 * pior desfecho possível numa tela cuja tese inteira é mostrar o fluxo.
 *
 * A autorização é a do CARD: quem enxerga o card enxerga as notas que o sustentam.
 */
create or replace function public.prospeccao_notas(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_cnpj text := p ->> 'cnpj_sacado';
  v_forn text := nullif(p ->> 'fornecedor_cnpj', '');
  v_card public.sacados_prospeccao;
  v_dias int;
  v_r jsonb;
begin
  if not public.app_tem_modulo('antecipacao') then
    raise exception 'Sem acesso ao módulo Antecipação.' using errcode = '42501';
  end if;
  if not public.app_sacado_prospeccao_visivel(v_cnpj) then
    raise exception 'Este sacado não está na sua carteira.' using errcode = '42501';
  end if;

  select * into v_card from public.sacados_prospeccao where cnpj_sacado = v_cnpj;
  if v_card.id is null then
    raise exception 'Sacado não está no funil.' using errcode = 'no_data_found';
  end if;
  v_dias := coalesce(v_card.prazo_minimo_operavel_dias, 25);

  select coalesce(jsonb_agg(n order by n.emitida_em desc), '[]'::jsonb) into v_r
  from (
    select
      nf.access_key,
      nf.numero,
      nf.serie,
      nf.fornecedor_cnpj,
      nf.fornecedor_nome,
      nf.valor,
      nf.emitida_em::date as emitida_em,
      nf.vencimento,
      nf.dias_para_vencimento,
      -- A mesma régua do card, aplicada nota a nota. Calculá-la na tela daria a chance
      -- de o total e as linhas discordarem sobre qual nota sobrevive à esteira.
      (nf.dias_para_vencimento is not null and nf.dias_para_vencimento > v_dias) as operavel
    from public.notas_fiscais nf
    where nf.sacado_cnpj = v_cnpj
      and nf.fornecedor_cadastrado is true
      and (v_forn is null or nf.fornecedor_cnpj = v_forn)
      and nf.emitida_em >= now() - make_interval(days => greatest(
            coalesce((select (c.valor ->> 'janela_emissao_dias')::int
                        from public.prospeccao_config c where c.chave = 'janelas'), 30), 1))
      -- A expansão mostra as notas DE QUEM O ORIGINADOR SEGUE. Um cedente que saiu da
      -- lista de seguidos sai da quebra na rodada seguinte; mostrá-lo aqui faria a soma
      -- da expansão não bater com o número do card.
      and exists (
        select 1 from public.sacados_prospeccao_fornecedores f
        where f.sacado_prospeccao_id = v_card.id and f.fornecedor_cnpj = nf.fornecedor_cnpj
      )
  ) n;

  return jsonb_build_object(
    'cnpj_sacado', v_cnpj,
    'prazo_minimo_operavel_dias', v_dias,
    'prazo_minimo_origem', v_card.prazo_minimo_origem,
    'notas', v_r
  );
end $$;

comment on function public.prospeccao_notas is
  'As notas, uma a uma, do par (cedente, sacado) deste card. SECURITY DEFINER porque a '
  'RLS de notas_fiscais recorta por vendedor da nota ou carteira de empresa, e o '
  'originador deste funil não é nenhum dos dois — lida direto, a expansão viria vazia.';

revoke execute on function public.prospeccao_notas(jsonb) from public, anon;
grant execute on function public.prospeccao_notas(jsonb) to authenticated, service_role;

-- =============================================================================
-- §8 — Settings, com os defaults da spec
--
-- Todo default aqui é também o default EMBUTIDO no leitor do worker: se uma linha for
-- apagada, o job roda com o valor da spec em vez de quebrar. Mesmo desenho de
-- radar_config e fornecedores_config, e pelo mesmo motivo — um job que morre porque
-- alguém apagou uma configuração é um job que ninguém confia o suficiente para agendar.
-- =============================================================================

insert into public.prospeccao_config (chave, valor) values
  ('janelas', jsonb_build_object(
    'janela_emissao_dias', 30,
    'janela_recorrencia_meses', 6
  )),

  ('corte_volume', to_jsonb(30000)),

  /*
   * A régua do VALOR OPERÁVEL.
   *
   * `tempo_esteira_dias` é o FALLBACK: o número que vale é o medido em `analises_credito`
   * (04d). Em 20/09/2026 há 7 análises decididas com prazo válido e a mediana é de horas
   * — cair nela marcaria como operável toda nota que vence amanhã. `esteira_base_minima`
   * é o que impede isso: abaixo dela, usa-se o default, e a tela diz qual dos dois entrou.
   */
  ('prazo', jsonb_build_object(
    'margem_prazo_dias', 10,
    'tempo_esteira_dias', 15,
    'esteira_base_minima', 10
  )),

  /*
   * O teto de cards por originador.
   *
   * Não é um limite de ambição: é o que impede a fila de virar a mesma lista morta que o
   * corte de volume já evitou uma vez. Acima do teto, os de menor valor esperado
   * simplesmente não entram — e voltam a entrar quando algum sai.
   */
  ('max_cards_por_originador', to_jsonb(60)),

  /*
   * Só sacados que CONTRATAM obra (CNAE de divisão 41/42 ou grupo 6810).
   *
   * Herdado da aba que esta substitui, onde a lição foi paga: sem o recorte a lista vira
   * "todo CNPJ que já apareceu como destinatário" — posto de gasolina, papelaria, o
   * contador do fornecedor. Medido em 20/09/2026: dos 243 sacados acima do corte, 114
   * são contratantes (R$ 20,7 mi na janela) e 2 ainda não têm CNAE.
   *
   * A régua mora no TypeScript (`tipoDeEmpresaPorCnae`), e a 0195 derrubou a cópia em
   * SQL de propósito. Este flag decide se ela é APLICADA, não qual é ela.
   */
  ('exigir_contratante', to_jsonb(true)),

  ('enriquecimento', jsonb_build_object(
    'teto_mensal_por_originador', 150,
    'alerta_percentual', 0.8
  )),

  /*
   * O limiar do push de "novo sacado" (§9). Em valor ESPERADO mensal, não em volume:
   * avisar sobre um pico de R$ 2 milhões que a esteira não vai aprovar é ensinar a
   * ignorar o aviso.
   */
  ('notificacao', jsonb_build_object('limiar_valor_esperado_mensal', 1000)),

  ('motivos_descarte', jsonb_build_array(
    jsonb_build_object('id', 'fornecedor_nao_apresentou', 'label', 'Fornecedor não fez a ponte'),
    jsonb_build_object('id', 'sacado_sem_interesse', 'label', 'Construtora não tem interesse'),
    jsonb_build_object('id', 'ja_opera_com_outro', 'label', 'Já opera com outra financeira'),
    jsonb_build_object('id', 'porte_incompativel', 'label', 'Porte incompatível'),
    jsonb_build_object('id', 'fora_do_perfil', 'label', 'Fora do perfil (CNAE ou atividade)'),
    jsonb_build_object('id', 'fluxo_pontual', 'label', 'Fluxo pontual — não se repete'),
    jsonb_build_object('id', 'risco_conhecido', 'label', 'Risco conhecido'),
    jsonb_build_object('id', 'outro', 'label', 'Outro')
  )),

  /*
   * §6 — O GUARDRAIL DE RELACIONAMENTO, escrito no dado e não só na tela.
   *
   * Os dois templates falam com o FORNECEDOR, que é o dono do dado: são as notas dele,
   * e é ele quem nos deu o certificado para vê-las. NENHUM template deste módulo fala
   * com a construtora — não há um terceiro aqui, e a ausência é a regra.
   *
   * Se um dia existir, ele NÃO pode citar volume, nome de fornecedor nem detalhe de
   * nota: devolver ao sacado o que o fornecedor nos cedeu para antecipar soa como
   * vigilância, e queima o relacionamento que sustenta a operação inteira. É a mesma
   * regra já aplicada no pedido de apresentação do 04l.
   *
   * As chaves entre chaves são renderizadas A PARTIR DO CARD, antes de o texto chegar ao
   * compositor — e não pelo catálogo de `templates_mensagem`, que resolve variáveis
   * contra a empresa destinatária e não saberia quem é a construtora deste card.
   */
  ('templates', jsonb_build_object(
    'abordagem_fornecedor',
      'Olá! Aqui é {remetente_nome}, da ONE OS. Vi que vocês têm {valor_total} a receber ' ||
      'da {sacado_nome}. Conseguimos antecipar esse valor — quer que eu te mande a simulação?',
    'pedido_ponte',
      'Olá! Aqui é {remetente_nome}, da ONE OS. Estamos começando a atender a {sacado_nome}, ' ||
      'para quem vocês faturam. Você conseguiria nos apresentar a quem cuida do financeiro lá? ' ||
      'Com o cadastro deles aprovado, passamos a antecipar essas notas para vocês.'
  ))
on conflict (chave) do nothing;

comment on table public.prospeccao_config is
  'Settings do funil de Sacados por NF (04r §8). Chaves: janelas, corte_volume, prazo, '
  'max_cards_por_originador, exigir_contratante, enriquecimento, notificacao, '
  'motivos_descarte, templates. Todo default está DUPLICADO no leitor do worker de '
  'propósito: apagar uma linha degrada para a spec em vez de derrubar o job.';

-- =============================================================================
-- A função de TRIGGER não é um endpoint
--
-- `prospeccao_reagir_a_decisao()` nasceu com o `EXECUTE` que o Postgres concede por
-- default a `public` — e o PostgREST expõe toda função de `public` em
-- `/rest/v1/rpc/<nome>`. O advisor de segurança a listou como chamável por `anon`.
--
-- Explorável hoje não é: chamar uma função de trigger fora de um trigger levanta
-- "trigger functions can only be called as triggers", antes de o corpo rodar. Mas é
-- exatamente a mesma forma da cicatriz da 0138k — uma DEFINER que escreve em
-- `vendedor_carteira` e `notificacoes` não deve estar ao alcance de um papel sem sessão
-- por um caminho que só falha por causa de uma checagem do próprio Postgres.
--
-- Quem escreve a função responde pela ACL dela.
-- =============================================================================

revoke execute on function public.prospeccao_reagir_a_decisao() from public, anon, authenticated;

comment on function public.prospeccao_reagir_a_decisao is
  'A decisão da esteira move o card do funil de Sacados por NF e, quando aprova, cria a '
  'carteira do §7 na MESMA transação. Trigger em vez de job porque a esteira é '
  'movimentada por quatro caminhos e a data do vínculo precisa ser a da decisão. '
  'EXECUTE revogado de todos os papéis de sessão: função de trigger não é endpoint.';
