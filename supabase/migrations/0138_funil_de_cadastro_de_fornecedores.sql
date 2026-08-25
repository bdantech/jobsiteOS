-- 0138 — Funil de cadastro de fornecedores (Prompt 04l).
--
-- APLICADA EM PARTES no banco, para localizar a falha caso alguma fosse recusada:
-- `0138a_fornecedores_funil_tabelas`, `0138b_fornecedores_funil_rls`,
-- `0138c_suprimir_fornecedor_uma_regra_so`,
-- `0138d_promover_fornecedor_nucleo_compartilhado`,
-- `0138e_fornecedores_funil_rpcs`, `0138g_fornecedores_leitura_e_toque` e
-- `0138h_fornecedores_seeds` — mais duas correções aplicadas em seguida e já
-- incorporadas ao texto abaixo:
-- `0138f_visibilidade_sem_funcao_por_linha` (as policies de 0138b chamavam
-- `app_pode_ver_vendedor(originador_id)` por LINHA VARRIDA — a mesma armadilha que
-- estourou os 8s da tela de fornecedores a prospectar em 24/08) e
-- `0138i_descartar_fornecedor_fala_com_os_dois_funis` (marcar "sem interesse" aqui
-- precisava sumir também da lista a prospectar da Antecipação, e o motivo passou a
-- vir do enum que já existia) e
-- `0138j_a_tabela_de_credencial_precisa_do_revoke_explicito` (o "sem grant nenhum"
-- de `integracao_tokens` não era verdade: o Supabase concede ALL por default em toda
-- tabela nova de `public`, e só a RLS estava segurando) e
-- `0138k_create_or_replace_preserva_o_grant_do_anon` (reescrever o corpo de três RPCs
-- de outros módulos herdou o `anon=X` que eles já tinham) e
-- `0138l_a_contagem_de_pedidos_custava_uma_rls_por_linha` (uma coluna de `count(*)` na
-- view cobrava a RLS de outra tabela 500 vezes por página, e nenhuma tela a lia),
-- `0138m_a_supressao_precisa_saber_que_veio_do_comercial` (o CHECK de `contexto` só
-- conhecia `geral` e `antecipacao`) e
-- `0138n_a_view_lia_uma_tabela_que_o_comercial_nao_enxerga` (a view trazia `suprimido`
-- por join em `supressao`, cuja policy exige o módulo **radar** — o LEFT JOIN vinha
-- vazio e devolvia "não suprimido" justamente para o público da tela).
--
-- As duas últimas foram pegas por um teste de ponta a ponta dos RPCs rodando COMO O
-- USUÁRIO (set role authenticated + JWT do Fabio), e nenhuma delas era visível
-- consultando como superusuário.
--
-- ─── O QUE ESTE PROMPT ACRESCENTA AO QUE JÁ HAVIA ────────────────────────────
--
-- A view `antecipacao_fornecedores_a_prospectar` (0101) já LISTAVA estes CNPJs. O que
-- faltava era o que transforma uma lista em funil: dono, estágio, munição de abordagem
-- e um motor de descoberta de contato com orçamento.
--
-- Três medições da base em 25/08/2026 sustentam as decisões daqui:
--
--   688 fornecedores passam do corte de R$ 50 mil em 90 dias, somando R$ 289,2 milhões
--       cedidos na janela. Sem corte são 7.892 — que não é um funil, é a mesma lista
--       morta com kanban em volta.
--   528 deles (77%) têm telefone no bloco `<emit>` do XML da NF-e e 201 (29%) têm
--       e-mail. O cadastral da Receita, para os mesmos 688, tem telefone em 75 (11%) e
--       e-mail em 70 (10%). O XML ganha por sete vezes e custa zero — é por isso que
--       ele é a primeira etapa da cascata e nenhuma fonte paga roda antes dele.
--   112 dos 688 têm originador titular pela carteira de originação. Os outros 576
--       nascem sem dono, e é por isso que a fila sem dono é a tela que o gestor abre
--       por padrão.

-- =============================================================================
-- §2 — Tabelas
--
-- ─── POR QUE TABELA E NÃO VIEW ───────────────────────────────────────────────
--
-- A view continua existindo e continua sendo a fonte da munição. Mas estágio,
-- titular e contato descoberto são ESTADO — coisas que uma pessoa decidiu e que
-- precisam sobreviver ao recálculo da noite seguinte. Uma view não guarda que o
-- Fábio ligou terça-feira.
-- =============================================================================

-- ─── Settings do módulo ─────────────────────────────────────────────────────
create table public.fornecedores_config (
  chave text primary key,
  valor jsonb not null,
  atualizado_por uuid references public.usuarios (id) on delete set null,
  atualizado_em timestamptz not null default now()
);

comment on table public.fornecedores_config is
  'Settings do funil de fornecedores: corte de volume, custos por provedor, tetos de '
  'orçamento e template do pedido de apresentação. Mesmo desenho de radar_config.';

/*
 * O cache de credencial de terceiro, numa tabela SEM GRANT NENHUM.
 *
 * O token da Nova Vida poderia morar em `fornecedores_config` — é config, tem chave
 * e valor. Não mora, e a razão é que `fornecedores_config` é lida por `authenticated`
 * para a tela de settings. Filtrar a linha do token por predicado funcionaria até
 * alguém escrever a próxima policy sem lembrar dela.
 *
 * Uma credencial precisa ser inalcançável por construção, não por filtro.
 */
create table public.integracao_tokens (
  provedor text primary key,
  token text not null,
  expira_em timestamptz not null,
  atualizado_em timestamptz not null default now()
);

/*
 * DUAS camadas, e a segunda foi aprendida medindo.
 *
 * A intenção era "RLS ligada, nenhuma policy, nenhum grant". As duas primeiras
 * estavam certas; a terceira não: o Postgres do Supabase tem DEFAULT PRIVILEGES que
 * concedem ALL a `anon` e `authenticated` em toda tabela nova de `public` — inclusive
 * SELECT. Na prática o token seguia inalcançável (RLS sem policy nega tudo, e é assim
 * que o projeto inteiro se protege), mas para ESTA tabela uma camada só é pouco.
 *
 * O modo de falhar é o argumento: em qualquer outra tabela, um `create policy ... for
 * select` escrito distraidamente abre linhas que o usuário já podia ver de outro
 * jeito. Aqui ele entregaria a credencial de um serviço de terceiro a todo mundo que
 * tem sessão, e nada na tela mudaria para avisar.
 */
revoke all on public.integracao_tokens from anon, authenticated, public;

comment on table public.integracao_tokens is
  'Cache de token de provedor externo (Nova Vida). Duas camadas, de propósito: RLS '
  'habilitada SEM policy nenhuma, e ALL revogado de anon/authenticated (o default do '
  'Supabase concede). Só o service_role chega aqui. Validade guardada com folga sobre '
  'a real: 23,5h de 24h, para que nenhuma consulta pegue um token expirando no meio '
  'do voo — cujo erro é indistinguível de um CNPJ desconhecido.';

-- ─── O funil ────────────────────────────────────────────────────────────────
create table public.fornecedores_funil (
  id uuid primary key default gen_random_uuid(),
  fornecedor_cnpj text unique not null
    constraint fornecedores_funil_cnpj_check check (fornecedor_cnpj ~ '^[0-9]{14}$'),

  /*
   * Derivado do SACADO: o originador que titulariza a construtora contra a qual o
   * fornecedor mais fatura. Um fornecedor emite contra vários sacados; o desempate é
   * o volume, porque é a porta de entrada mais forte da abordagem.
   */
  originador_id uuid references public.vendedores (id) on delete set null,
  /*
   * Como o dono chegou aqui. Sem esta coluna o job noturno desfaria toda reatribuição
   * do gestor (§1: "reatribuível pelo gestor") — a correção sumiria de madrugada e a
   * pessoa a refaria no dia seguinte, sem saber por quê.
   */
  originador_origem text not null default 'automatica'
    constraint fornecedores_funil_origem_check check (originador_origem in ('automatica', 'manual')),

  estagio text not null default 'a_cadastrar'
    constraint fornecedores_funil_estagio_check check (estagio in
      ('a_cadastrar', 'em_prospeccao', 'aguardando_retorno', 'sem_contato', 'sem_interesse', 'cadastrado')),
  estagio_alterado_em timestamptz,
  estagio_alterado_por uuid references public.usuarios (id) on delete set null,
  sem_interesse_motivo text,
  sem_interesse_observacao text,
  /*
   * Quando a supressão vence e ele volta. Denormalizado de `supressao` de propósito:
   * a policy daquela tabela exige o módulo `radar`, que o time Comercial não tem, e um
   * LEFT JOIN que a RLS esvazia devolve "não suprimido" com a cara de resposta certa.
   * NULL com estágio `sem_interesse` é supressão eterna.
   */
  sem_interesse_ate date,

  -- ── munição (recalculada pelo job) ───────────────────────────────────────
  volume_90d numeric(14, 2),
  qtd_nfs_90d int,
  prazo_medio_dias int,
  sacados_principais jsonb not null default '[]'::jsonb,
  potencial_mensal numeric(14, 2),
  ultima_nf_em date,

  -- ── contato ──────────────────────────────────────────────────────────────
  contatos_encontrados int not null default 0,
  melhor_confianca text
    constraint fornecedores_funil_confianca_check
    check (melhor_confianca is null or melhor_confianca in ('alta', 'media', 'baixa')),
  ultima_busca_em timestamptz,
  /* Quando as camadas 0+1 (gratuitas) rodaram. Separada de `ultima_busca_em`, que é
     do clique pago: misturar as duas faria o botão dizer "já buscamos" por causa de
     uma varredura de XML que não gastou nada. */
  descoberta_automatica_em timestamptz,

  /* Não-cadastrado não quer dizer sem ficha: 189 notas já trazem `empresa_id` de um
     fornecedor promovido à mão. É o que permite pendurar evento na timeline dele. */
  empresa_id uuid references public.empresas (id) on delete set null,

  entrou_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index fornecedores_funil_originador_idx on public.fornecedores_funil (originador_id, estagio);
create index fornecedores_funil_potencial_idx on public.fornecedores_funil (potencial_mensal desc nulls last);
-- A fila sem dono é a tela que o gestor abre por padrão — 576 dos 688 chegam assim.
create index fornecedores_funil_sem_dono_idx on public.fornecedores_funil (potencial_mensal desc)
  where originador_id is null and estagio <> 'cadastrado';
create index fornecedores_funil_empresa_idx on public.fornecedores_funil (empresa_id)
  where empresa_id is not null;

create trigger fornecedores_funil_set_atualizado_em
  before update on public.fornecedores_funil
  for each row execute function set_atualizado_em();

comment on table public.fornecedores_funil is
  'Funil de cadastro de fornecedores (04l). Entra por volume (corte em '
  'fornecedores_config.corte_volume), sai por cadastro na plataforma. A munição é '
  'recalculada pelo job; o estágio e o dono são estado humano.';
comment on column public.fornecedores_funil.potencial_mensal is
  'Volume 90d ÷ 3. É "quanto ele fatura por mês contra nossos sacados", não "quanto '
  'vai antecipar" — a segunda pergunta depende de apetite e limite, e um número que '
  'fingisse respondê-la poria o originador a prometer o que não é dele.';
comment on column public.fornecedores_funil.originador_origem is
  'automatica = derivado do sacado pelo job. manual = o gestor reatribuiu, e o job '
  'não sobrescreve.';
comment on column public.fornecedores_funil.sem_interesse_motivo is
  'Código do enum MOTIVOS_SEM_INTERESSE (0104). Enumerado porque esta resposta é '
  'contável; a observação livre fica na coluna ao lado.';
comment on column public.fornecedores_funil.sem_interesse_ate is
  'Quando a supressão vence e o fornecedor volta ao funil. NULL com estágio '
  '`sem_interesse` é supressão eterna. Denormalizado de `supressao` de propósito: a '
  'tela do Comercial não pode ler aquela tabela (a policy dela exige o módulo radar), '
  'e um LEFT JOIN que a RLS esvazia devolve "não suprimido" para todo mundo.';

/*
 * `supressao.contexto` só conhecia `geral` e `antecipacao` (0045). O funil de cadastro
 * grava `comercial`, e o contexto próprio não é rótulo: `app_fornecedor_mover` filtra
 * por ele ao reabrir um card, justamente para NÃO apagar uma supressão que o Radar ou
 * a Antecipação criaram sobre o mesmo CNPJ por outro motivo.
 */
alter table public.supressao drop constraint supressao_contexto_check;
alter table public.supressao
  add constraint supressao_contexto_check
  check (contexto in ('geral', 'antecipacao', 'comercial'));

comment on column public.supressao.contexto is
  'De onde veio a supressão: geral | antecipacao | comercial. O efeito é o mesmo (o '
  'CNPJ para de ser abordado em qualquer canal), mas o contexto é quem pode desfazer: '
  'reabrir um card no funil de cadastro só apaga supressão `comercial`, para não '
  'liberar um CNPJ que outro time bloqueou por outro motivo.';

-- ─── Contatos descobertos ───────────────────────────────────────────────────
create table public.contatos_descobertos (
  id uuid primary key default gen_random_uuid(),
  fornecedor_cnpj text not null
    constraint contatos_descobertos_cnpj_check check (fornecedor_cnpj ~ '^[0-9]{14}$'),
  tipo text not null
    constraint contatos_descobertos_tipo_check check (tipo in ('telefone', 'email', 'whatsapp', 'site', 'instagram')),
  /* Forma CANÔNICA: E.164 para telefone, minúsculo para e-mail/site. É o que faz o
     unique embaixo deduplicar de verdade — as seis fontes escrevem o mesmo número de
     seis jeitos. */
  valor text not null,
  /* Como estava escrito na origem. A tela mostra quando difere. */
  valor_original text,
  nome_pessoa text,
  cargo text,
  fonte text not null
    constraint contatos_descobertos_fonte_check check (fonte in
      ('xml_nfe', 'receita', 'google_places', 'site_empresa', 'apollo', 'novavida', 'claude_busca', 'sacado')),
  confianca text not null
    constraint contatos_descobertos_confianca_check check (confianca in ('alta', 'media', 'baixa')),
  /* URL, número da NF ou trecho. Contato do Claude SEM evidência é descartado antes
     de chegar aqui — um telefone sem origem é indistinguível de um inventado. */
  evidencia text,
  /* Quantas vezes a MESMA informação apareceu. Num fornecedor com 40 notas na janela,
     um telefone que aparece nas 40 é outra coisa que um que apareceu numa. */
  frequencia int not null default 1,
  ultima_vez_visto date,
  validado jsonb not null default '{}'::jsonb,
  promovido_contato_id uuid references public.contatos (id) on delete set null,
  descoberto_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (fornecedor_cnpj, tipo, valor)
);

create index contatos_descobertos_fornecedor_idx on public.contatos_descobertos (fornecedor_cnpj);
create index contatos_descobertos_fonte_idx on public.contatos_descobertos (fonte, confianca);
-- A varredura diária de validação (§4.4) pega os que nunca foram validados primeiro.
create index contatos_descobertos_a_validar_idx on public.contatos_descobertos (descoberto_em)
  where validado = '{}'::jsonb;

create trigger contatos_descobertos_set_atualizado_em
  before update on public.contatos_descobertos
  for each row execute function set_atualizado_em();

comment on table public.contatos_descobertos is
  'Contatos achados pela cascata (04l §4). NUNCA são apagados: contato inválido fica '
  'com confiança rebaixada e marcado em `validado` — apagar destruiria a evidência de '
  'que a fonte entrega lixo, que é o insumo do painel de eficácia (§6).';

-- ─── Pedido de apresentação ao sacado ───────────────────────────────────────
create table public.pedidos_apresentacao (
  id uuid primary key default gen_random_uuid(),
  fornecedor_cnpj text not null
    constraint pedidos_apresentacao_forn_check check (fornecedor_cnpj ~ '^[0-9]{14}$'),
  sacado_cnpj text not null
    constraint pedidos_apresentacao_sacado_check check (sacado_cnpj ~ '^[0-9]{14}$'),
  contato_sacado_id uuid references public.contatos (id) on delete set null,
  mensagem text,
  status text not null default 'rascunho'
    constraint pedidos_apresentacao_status_check check (status in ('rascunho', 'enviado', 'respondido', 'sem_resposta')),
  solicitado_por uuid references public.usuarios (id) on delete set null,
  criado_em timestamptz not null default now(),
  respondido_em timestamptz
);

create index pedidos_apresentacao_fornecedor_idx on public.pedidos_apresentacao (fornecedor_cnpj, criado_em desc);
create index pedidos_apresentacao_sacado_idx on public.pedidos_apresentacao (sacado_cnpj);

comment on table public.pedidos_apresentacao is
  'Camada 3 da cascata (04l §4.3): pedir ao sacado que apresente o fornecedor. Nesta '
  'fase o texto é COPIÁVEL — não há canal de envio (Prompt 05). `enviado` é marcação '
  'manual de quem mandou por fora.';

-- ─── Livro-razão da descoberta ──────────────────────────────────────────────
/*
 * O gasto do mês é a SOMA daqui, não um contador à parte.
 *
 * É a mesma decisão do orçamento do Radar (`enriquecimentos.custo_real`), e pelo
 * mesmo motivo: um contador incrementado em paralelo diverge do que aconteceu na
 * primeira vez que um job morrer no meio, e a divergência é invisível — o número
 * continua parecendo um número.
 *
 * Grava TODA tentativa, inclusive `pulado` e `sem_dados`. Sem elas o painel de
 * eficácia (§6) só saberia responder "quantos contatos o Apollo trouxe", nunca
 * "quantas vezes ele não trouxe nada" — que é metade da conta de custo por cadastro.
 */
create table public.descoberta_execucoes (
  id uuid primary key default gen_random_uuid(),
  fornecedor_cnpj text not null
    constraint descoberta_execucoes_cnpj_check check (fornecedor_cnpj ~ '^[0-9]{14}$'),
  camada text not null
    constraint descoberta_execucoes_camada_check check (camada in ('automatica', 'sob_demanda')),
  provedor text not null,
  status text not null
    constraint descoberta_execucoes_status_check check (status in ('sucesso', 'sem_dados', 'erro', 'pulado')),
  motivo text,
  custo numeric(10, 4) not null default 0,
  contatos_novos int not null default 0,
  /* De quem é o gasto. O teto do §4.2 é POR ORIGINADOR. */
  originador_id uuid references public.vendedores (id) on delete set null,
  solicitado_por uuid references public.usuarios (id) on delete set null,
  executado_em timestamptz not null default now()
);

create index descoberta_execucoes_mes_idx on public.descoberta_execucoes (originador_id, executado_em desc);
create index descoberta_execucoes_fornecedor_idx on public.descoberta_execucoes (fornecedor_cnpj, executado_em desc);
create index descoberta_execucoes_provedor_idx on public.descoberta_execucoes (provedor, status);

comment on table public.descoberta_execucoes is
  'Toda tentativa da cascata, inclusive as puladas e as sem dados. É a verdade do '
  'gasto (teto mensal por originador) e a matéria-prima do painel de eficácia por '
  'fonte (04l §6).';

-- A atribuição do §6 busca toques por CNPJ dentro do payload do evento. Sem este
-- índice, cada consulta do painel varre a tabela inteira de eventos.
create index if not exists empresa_eventos_toque_cnpj_idx
  on public.empresa_eventos ((payload ->> 'cnpj'))
  where tipo = 'toque.manual';

-- =============================================================================
-- §1 — RLS: quem vê o quê
--
--   Originador  os fornecedores cujos sacados estão na carteira DELE.
--   Gestor      tudo, inclusive a fila sem dono — é ele quem atribui.
--
-- A FILA SEM DONO É DO GESTOR, e é a mesma decisão da "Fila sem Dono" do 04g. Um
-- fornecedor sem titular é um fornecedor cujo sacado ninguém trabalha: deixá-lo
-- visível para todos os originadores faria dois deles ligarem para a mesma empresa
-- na mesma semana, cada um achando que era seu.
--
-- ─── NENHUMA FUNÇÃO É CHAMADA POR LINHA ──────────────────────────────────────
--
-- A primeira versão destas policies usava `app_pode_ver_vendedor(originador_id)`
-- direto no `using`. Funciona, é legível, e é exatamente a forma que estourou os 8
-- segundos da tela de fornecedores a prospectar em 24/08 (0131).
--
-- Uma função STABLE dentro de um `using` NÃO é avaliada uma vez: ela roda por linha
-- VARRIDA. `app_pode_ver_vendedor` faz três subconsultas, então listar 688
-- fornecedores custa ~2.000 consultas para responder sempre a mesma coisa. Como o
-- argumento é a COLUNA, o envelope `(select ...)` não salva: não há InitPlan possível
-- sobre um valor que muda por linha.
--
-- A saída é quebrar a função nas suas três partes e escrevê-las de um jeito que o
-- planejador consiga avaliar uma vez só. O predicado é o mesmo; o plano é outro.
-- =============================================================================

alter table public.fornecedores_config enable row level security;
alter table public.integracao_tokens enable row level security;
alter table public.fornecedores_funil enable row level security;
alter table public.contatos_descobertos enable row level security;
alter table public.pedidos_apresentacao enable row level security;
alter table public.descoberta_execucoes enable row level security;

/*
 * `integracao_tokens` NÃO ganha policy nenhuma. RLS ligada sem policy é negação
 * total para `authenticated`; o service_role passa por cima da RLS por definição.
 * É a forma mais curta de dizer "esta tabela não é do usuário".
 */

/*
 * O predicado de visibilidade, uma vez só.
 *
 * Ele é chamado por duas tabelas (contatos e pedidos) que se ligam ao funil pelo
 * CNPJ. Duas cópias do mesmo EXISTS seriam dois lugares onde a regra pode divergir —
 * e a primeira divergência seria alguém enxergando o telefone de um fornecedor cujo
 * card ele não vê. O EXISTS usa o índice único de `fornecedor_cnpj`: uma busca de uma
 * linha, não uma varredura.
 */
create or replace function public.app_fornecedor_visivel(p_cnpj text)
returns boolean language sql stable security definer set search_path = '' as $$
  select
    public.app_gestor_comercial()
    or exists (
      select 1 from public.fornecedores_funil f
      where f.fornecedor_cnpj = p_cnpj
        and (
          f.originador_id = public.app_vendedor_atual()
          or f.originador_id in (
            select a.pode_ver_vendedor_id from public.vendedor_acessos a
            where a.vendedor_id = public.app_vendedor_atual()
          )
        )
    );
$$;

comment on function public.app_fornecedor_visivel is
  'Este usuário enxerga o card deste fornecedor? Gestor sempre; originador quando o '
  'fornecedor está atribuído a ele (ou a alguém que ele pode ver). Fornecedor sem '
  'dono é do gestor.';

revoke execute on function public.app_fornecedor_visivel(text) from public, anon;
grant execute on function public.app_fornecedor_visivel(text) to authenticated, service_role;

-- A config é lida por qualquer um do módulo: o card mostra o custo estimado do
-- clique, e esse número vem daqui. Escrever, só o gestor — e por RPC.
create policy fornecedores_config_select on public.fornecedores_config
  for select using ((select public.app_tem_modulo('comercial')));

create policy fornecedores_funil_select on public.fornecedores_funil
  for select using (
    (select public.app_tem_modulo('comercial'))
    and (
      (select public.app_gestor_comercial())
      or originador_id = (select public.app_vendedor_atual())
      or originador_id in (
        select a.pode_ver_vendedor_id from public.vendedor_acessos a
        where a.vendedor_id = (select public.app_vendedor_atual())
      )
    )
  );

create policy contatos_descobertos_select on public.contatos_descobertos
  for select using (
    (select public.app_tem_modulo('comercial'))
    and public.app_fornecedor_visivel(fornecedor_cnpj)
  );

create policy pedidos_apresentacao_select on public.pedidos_apresentacao
  for select using (
    (select public.app_tem_modulo('comercial'))
    and public.app_fornecedor_visivel(fornecedor_cnpj)
  );

/*
 * O gasto é dado pessoal-adjacente: ele diz quanto alguém consumiu do próprio teto.
 * A régua é a mesma da comissão, e não a do card: o gestor precisa auditar o gasto de
 * quem estourou, mesmo em fornecedor já cadastrado.
 */
create policy descoberta_execucoes_select on public.descoberta_execucoes
  for select using (
    (select public.app_tem_modulo('comercial'))
    and (
      (select public.app_gestor_comercial())
      or originador_id = (select public.app_vendedor_atual())
      or originador_id in (
        select a.pode_ver_vendedor_id from public.vendedor_acessos a
        where a.vendedor_id = (select public.app_vendedor_atual())
      )
    )
  );

grant select on public.fornecedores_config, public.fornecedores_funil,
  public.contatos_descobertos, public.pedidos_apresentacao, public.descoberta_execucoes
  to authenticated;

-- Nenhum insert/update/delete para `authenticated` em nenhuma delas. "Marcar sem
-- interesse" grava estágio + motivo + linha de supressão com validade + linha na
-- qualificação da Antecipação + evento, numa transação só; meia transação aqui é um
-- fornecedor marcado como sem interesse que volta ao topo da lista na madrugada
-- seguinte — ou que para de aparecer aqui e continua recebendo mensagem lá.

-- =============================================================================
-- "Sem interesse" e "promover fornecedor" passam a ter UMA implementação cada
--
-- Os dois casos são o mesmo padrão, e é o quarto achado da mesma família (0060,
-- 0066, 0068): uma função que o Comercial precisa existe, funciona, e está atrás de
-- um portão de módulo que ele não tem.
--
-- Copiar o corpo com o gate trocado daria duas implementações do mesmo fato, e a
-- divergência não seria acadêmica: se uma delas esquecer o `update notas_fiscais set
-- faixa = null`, o fornecedor sai do funil de cadastro e CONTINUA gerando outbox no
-- funil de antecipação. O originador marca "não quer falar com a gente" e o sistema
-- manda mensagem no dia seguinte.
--
-- Então a lógica desce para uma função interna (prefixo `app__`, sem grant) e cada
-- módulo põe o seu portão em volta.
-- =============================================================================

create or replace function public.app__suprimir_fornecedor(
  p_cnpj text,
  p_motivo text,
  p_dias int,          -- null = eterna
  p_ator uuid,
  p_contexto text
) returns public.supressao language plpgsql security definer set search_path = '' as $$
declare
  v_sup public.supressao;
  v_expira date;
  v_empresa uuid;
  v_nome text;
begin
  if p_cnpj !~ '^[0-9]{14}$' then
    raise exception 'CNPJ inválido.' using errcode = '22023';
  end if;
  if nullif(p_motivo, '') is null then
    raise exception 'Informe o motivo.' using errcode = '23514';
  end if;

  v_expira := case when p_dias is null then null else current_date + p_dias end;

  insert into public.supressao (escopo, valor, motivo, observacao, criado_por, expira_em, contexto)
  values (
    'empresa', p_cnpj,
    -- Eterna é LGPD; soft é decisão comercial. A distinção importa porque só a
    -- primeira sobrevive à limpeza de supressões vencidas.
    case when p_dias is null then 'solicitacao_lgpd' else 'nao_abordar' end,
    p_motivo, p_ator, v_expira, p_contexto
  )
  on conflict (escopo, valor) do update
    set expira_em = excluded.expira_em,
        observacao = excluded.observacao,
        motivo = excluded.motivo,
        contexto = excluded.contexto
  returning * into v_sup;

  -- As notas continuam no universo; o que sai é a FAIXA. Fazer isso aqui (e não só
  -- no job) é o que faz o card sumir do Kanban no mesmo clique.
  update public.notas_fiscais
    set faixa = null, faixa_motivo = 'suprimido', faixa_alterada_em = now()
  where fornecedor_cnpj = p_cnpj and faixa is not null;

  select id, coalesce(razao_social, nome_fantasia) into v_empresa, v_nome
    from public.empresas where cnpj = p_cnpj;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (
    v_empresa, 'fornecedor.sem_interesse',
    jsonb_build_object(
      'titulo', 'Fornecedor sem interesse',
      'resumo', coalesce(v_nome, p_cnpj) || ' marcado como sem interesse ('
                || case when p_dias is null then 'eterna' else p_dias || ' dias' end || '): '
                || p_motivo,
      'url', case when p_contexto = 'comercial' then '/comercial/fornecedores' else '/antecipacao' end,
      'cnpj', p_cnpj,
      'expira_em', v_expira,
      'motivo', p_motivo,
      'contexto', p_contexto
    ),
    p_ator
  );

  return v_sup;
end $$;

comment on function public.app__suprimir_fornecedor is
  'Núcleo do "sem interesse": supressão com validade + limpeza de faixa + evento. '
  'Interna (prefixo app__, sem grant): quem chama é o RPC de cada módulo, que faz o '
  'próprio gate. Existe para que a Antecipação e o funil de cadastro não tenham duas '
  'versões da mesma regra.';

revoke execute on function public.app__suprimir_fornecedor(text, text, int, uuid, text) from public, anon, authenticated;

-- O RPC da Antecipação (0047) passa a delegar.
create or replace function public.app_marcar_sem_interesse(p jsonb)
returns public.supressao language plpgsql security definer set search_path = '' as $$
declare
  v_sup public.supressao;
  v_ator uuid := auth.uid();
begin
  if not public.app_tem_modulo('antecipacao') then
    raise exception 'Sem acesso ao módulo Antecipação.' using errcode = '42501';
  end if;

  v_sup := public.app__suprimir_fornecedor(
    p ->> 'fornecedor_cnpj',
    p ->> 'motivo',
    case when coalesce((p ->> 'eterna')::boolean, false) then null
         else coalesce((p ->> 'dias')::int, 90) end,
    v_ator,
    'antecipacao'
  );

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'antecipacao.sem_interesse', 'supressao', v_sup.id::text, p);

  return v_sup;
end $$;

-- ─── Promoção a `empresas` ──────────────────────────────────────────────────
--
-- "Tornar ponto focal" (§5) é um clique só, e ele precisa de uma `empresas.id`:
-- `contatos.empresa_id` é NOT NULL. Mas um fornecedor do funil de cadastro é, por
-- definição, alguém que ainda não está na plataforma — na maioria dos casos não há
-- ficha nenhuma. O recorte que justifica o DEFINER é o mesmo da 0068: só promove CNPJ
-- que JÁ aparece como fornecedor numa nota, e sempre com tipo='fornecedor'.

create or replace function public.app__promover_fornecedor_para_empresa(
  p_cnpj text,
  p_ator uuid,
  p_origem text
) returns public.empresas language plpgsql security definer set search_path = '' as $$
declare
  v_universo public.mercado_universo;
  v_empresa public.empresas;
begin
  if p_cnpj !~ '^[0-9]{14}$' then
    raise exception 'CNPJ inválido.' using errcode = '22023';
  end if;

  -- O recorte: você promove quem você já podia ler.
  if not exists (select 1 from public.notas_fiscais nf where nf.fornecedor_cnpj = p_cnpj) then
    raise exception 'Este CNPJ não é fornecedor de nenhuma nota.' using errcode = 'no_data_found';
  end if;

  select * into v_universo from public.mercado_universo where cnpj = p_cnpj;
  if v_universo.cnpj is null then
    raise exception 'Cadastro deste CNPJ ainda não foi enriquecido. Ele está na fila de lookup.'
      using errcode = 'no_data_found';
  end if;

  -- Idempotente: promover de novo devolve o que existe, em vez de estourar.
  if v_universo.empresa_id is not null then
    select * into v_empresa from public.empresas where id = v_universo.empresa_id;
    if v_empresa.id is not null then return v_empresa; end if;
  end if;

  select * into v_empresa from public.empresas where cnpj = p_cnpj;

  if v_empresa.id is null then
    insert into public.empresas (
      cnpj, razao_social, nome_fantasia, tipo, estagio,
      uf, municipio, cnae_principal, porte,
      camada, grupo_id, is_spe, grafo_sefaz, origem
    )
    values (
      v_universo.cnpj, v_universo.razao_social, v_universo.nome_fantasia,
      -- Nunca vem do cliente: é o que impede este caminho de envenenar a pirâmide
      -- comercial, os segmentos e o TAM, que leem esta coluna.
      'fornecedor', 'mercado',
      v_universo.uf, v_universo.municipio, v_universo.cnae_principal, v_universo.porte_rfb,
      v_universo.camada, v_universo.grupo_id, v_universo.is_spe, v_universo.grafo_sefaz,
      p_origem
    )
    returning * into v_empresa;
  end if;

  update public.mercado_universo set empresa_id = v_empresa.id where cnpj = p_cnpj;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (
    v_empresa.id, 'empresa.promovida',
    jsonb_build_object(
      'resumo', coalesce(v_empresa.razao_social, v_empresa.cnpj)
                || ' foi promovida a partir do funil de ' || p_origem || '.',
      'camada', v_universo.camada,
      'origem', p_origem
    ),
    p_ator
  );

  return v_empresa;
end $$;

comment on function public.app__promover_fornecedor_para_empresa is
  'Núcleo da promoção de fornecedor a `empresas`. Interna (app__, sem grant): o gate '
  'de módulo é de quem chama. Sempre tipo=fornecedor, sempre a partir de CNPJ que já '
  'é fornecedor de alguma nota. Idempotente.';

revoke execute on function public.app__promover_fornecedor_para_empresa(text, uuid, text)
  from public, anon, authenticated;

-- O RPC da Antecipação (0068) passa a delegar.
create or replace function public.app_promover_fornecedor(p jsonb)
returns public.empresas language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_empresa public.empresas;
begin
  if not public.app_tem_modulo('antecipacao') then
    raise exception 'Sem acesso ao módulo Antecipação.' using errcode = '42501';
  end if;

  v_empresa := public.app__promover_fornecedor_para_empresa(p ->> 'cnpj', v_ator, 'antecipacao');

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'antecipacao.fornecedor_promovido', 'empresas', v_empresa.id::text, p);

  return v_empresa;
end $$;

-- ─── Toque manual pelo Comercial ────────────────────────────────────────────
--
-- Mesmo padrão, terceira vez. E aqui o toque precisa carregar MAIS: qual contato foi
-- usado. É essa informação, e só ela, que permite ao §6 responder "qual fonte levou
-- ao cadastro" — sem ela, o painel de eficácia sabe quantos contatos cada provedor
-- trouxe e nunca quantos viraram cliente, que é a única pergunta que decide desligar
-- um provedor.

create or replace function public.app__registrar_toque(
  p_cnpj text, p_canal text, p_contato text, p_extra jsonb, p_ator uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_empresa uuid;
  v_nome text;
begin
  if p_canal not in ('ligacao', 'whatsapp', 'email') then
    raise exception 'Canal inválido: %.', p_canal using errcode = '22023';
  end if;
  if p_cnpj !~ '^[0-9]{14}$' then
    raise exception 'CNPJ inválido.' using errcode = '22023';
  end if;

  select id, coalesce(razao_social, nome_fantasia) into v_empresa, v_nome
    from public.empresas where cnpj = p_cnpj;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (
    v_empresa, 'toque.manual',
    jsonb_build_object(
      'titulo', 'Toque manual',
      'resumo', 'Contato por ' || p_canal || ' com ' || coalesce(v_nome, p_cnpj) || '.',
      'cnpj', p_cnpj,
      'canal', p_canal,
      'contato', p_contato
    ) || coalesce(p_extra, '{}'::jsonb),
    p_ator
  );
end $$;

revoke execute on function public.app__registrar_toque(text, text, text, jsonb, uuid)
  from public, anon, authenticated;

create or replace function public.app_registrar_toque_manual(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.app_tem_modulo('antecipacao') then
    raise exception 'Sem acesso ao módulo Antecipação.' using errcode = '42501';
  end if;
  perform public.app__registrar_toque(
    p ->> 'fornecedor_cnpj', p ->> 'canal', p ->> 'contato',
    jsonb_build_object('access_key', p ->> 'access_key'),
    auth.uid()
  );
end $$;

-- =============================================================================
-- §5 — Escritas do módulo. Todas por RPC.
-- =============================================================================

-- ─── Mover de estágio ───────────────────────────────────────────────────────
create or replace function public.app_fornecedor_mover(p jsonb)
returns public.fornecedores_funil language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_cnpj text := p ->> 'fornecedor_cnpj';
  v_estagio text := p ->> 'estagio';
  v_era text;
  v_linha public.fornecedores_funil;
begin
  if not public.app_tem_modulo('comercial') then
    raise exception 'Sem acesso ao módulo Comercial.' using errcode = '42501';
  end if;
  if not public.app_fornecedor_visivel(v_cnpj) then
    raise exception 'Este fornecedor não está na sua carteira.' using errcode = '42501';
  end if;

  /*
   * Dois estágios NÃO se alcançam arrastando o card, e a recusa é a mensagem:
   *
   *   `sem_interesse` grava supressão com validade — arrastar sem motivo criaria o
   *   estágio sem o bloqueio de canal, e o fornecedor continuaria recebendo outbox.
   *   `cadastrado` é fato observado no sync, não opinião: marcá-lo à mão faria o
   *   card sumir enquanto o fornecedor segue fora da plataforma.
   */
  if v_estagio = 'sem_interesse' then
    raise exception 'Use "marcar sem interesse": este estágio exige motivo e prazo.' using errcode = '23514';
  end if;
  if v_estagio = 'cadastrado' then
    raise exception 'O cadastro é detectado no sync da nota, não marcado à mão.' using errcode = '23514';
  end if;

  select estagio into v_era from public.fornecedores_funil where fornecedor_cnpj = v_cnpj;
  if v_era is null then
    raise exception 'Fornecedor não está no funil.' using errcode = 'no_data_found';
  end if;

  /*
   * Reabrir desfaz as DUAS marcações, não só o estágio.
   *
   * Sem isto, "reabrir" deixaria o card no kanban e o CNPJ suprimido — o originador
   * ligaria para alguém que o sistema continua tratando como "não abordar", e o
   * outbox seguiria calado. Um desfazer que desfaz metade é pior que nenhum.
   *
   * `contexto = 'comercial'` no delete não é detalhe: sem ele, reabrir um card aqui
   * apagaria uma supressão que o Radar ou a Antecipação criaram sobre o mesmo CNPJ.
   */
  if v_era = 'sem_interesse' then
    delete from public.supressao where escopo = 'empresa' and valor = v_cnpj and contexto = 'comercial';
    delete from public.antecipacao_fornecedor_sem_interesse where cnpj = v_cnpj;
  end if;

  update public.fornecedores_funil
    set estagio = v_estagio,
        estagio_alterado_em = now(),
        estagio_alterado_por = v_ator,
        sem_interesse_motivo = null,
        sem_interesse_observacao = null,
        sem_interesse_ate = null
  where fornecedor_cnpj = v_cnpj
  returning * into v_linha;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'fornecedores.mover', 'fornecedores_funil', v_linha.id::text, p);

  return v_linha;
end $$;

-- ─── Sem interesse ──────────────────────────────────────────────────────────
--
-- Três efeitos numa transação: a supressão de canal (que impede o job de ressuscitar
-- o lead e o outbox de mandar mensagem), a qualificação que a lista a prospectar da
-- Antecipação lê, e o estágio do card. Duas telas discordando sobre o mesmo CNPJ é
-- como o trabalho é refeito.
--
-- O motivo é ENUMERADO, e é o enum que já existe (0104). Não é uniformidade por
-- gosto: "quantos perdemos porque já operam com outro?" só tem resposta se os dois
-- funis responderem com o mesmo vocabulário.
create or replace function public.app_fornecedor_sem_interesse(p jsonb)
returns public.fornecedores_funil language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_cnpj text := p ->> 'fornecedor_cnpj';
  v_motivo text := p ->> 'motivo';
  v_obs text := nullif(p ->> 'observacao', '');
  v_dias int := nullif(p ->> 'dias', '')::int;   -- null = eterna
  v_nome text;
  v_sup public.supressao;
  v_linha public.fornecedores_funil;
begin
  if not public.app_tem_modulo('comercial') then
    raise exception 'Sem acesso ao módulo Comercial.' using errcode = '42501';
  end if;
  if not public.app_fornecedor_visivel(v_cnpj) then
    raise exception 'Este fornecedor não está na sua carteira.' using errcode = '42501';
  end if;
  if v_motivo not in ('nao_utiliza_antecipacao', 'ja_opera_com_outro', 'caixa_confortavel',
                      'nao_quer_plataforma', 'sem_contato', 'porte_incompativel', 'outro') then
    raise exception 'Motivo inválido: %.', v_motivo using errcode = '22023';
  end if;
  if v_motivo = 'outro' and v_obs is null then
    raise exception 'Com motivo "Outro", a observação é obrigatória.' using errcode = '23514';
  end if;

  select coalesce(mu.razao_social, mu.nome_fantasia) into v_nome
    from public.mercado_universo mu where mu.cnpj = v_cnpj;

  v_sup := public.app__suprimir_fornecedor(
    v_cnpj,
    v_motivo || coalesce(' — ' || v_obs, ''),
    v_dias, v_ator, 'comercial'
  );

  insert into public.antecipacao_fornecedor_sem_interesse
    (cnpj, fornecedor_nome, motivo, observacao, marcado_por)
  values (v_cnpj, v_nome, v_motivo, v_obs, v_ator)
  on conflict (cnpj) do update
    set motivo = excluded.motivo,
        observacao = excluded.observacao,
        marcado_por = excluded.marcado_por,
        marcado_em = now();

  update public.fornecedores_funil
    set estagio = 'sem_interesse',
        sem_interesse_motivo = v_motivo,
        sem_interesse_observacao = v_obs,
        -- A data vem da linha que ACABOU de ser gravada, não de um cálculo repetido:
        -- duas contas para a mesma data é uma chance de elas divergirem.
        sem_interesse_ate = v_sup.expira_em,
        estagio_alterado_em = now(),
        estagio_alterado_por = v_ator
  where fornecedor_cnpj = v_cnpj
  returning * into v_linha;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'fornecedores.sem_interesse', 'supressao', v_sup.id::text, p);

  return v_linha;
end $$;

-- ─── Reatribuir (gestor) ────────────────────────────────────────────────────
create or replace function public.app_fornecedor_reatribuir(p jsonb)
returns public.fornecedores_funil language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_cnpj text := p ->> 'fornecedor_cnpj';
  v_orig uuid := nullif(p ->> 'originador_id', '')::uuid;
  v_linha public.fornecedores_funil;
begin
  -- Reatribuir é decidir de quem é o trabalho (e, por tabela, de quem é o teto de
  -- orçamento que o clique vai consumir). Fica com o gestor, como a Fila sem Dono.
  if not public.app_gestor_comercial() then
    raise exception 'Só um gestor comercial reatribui fornecedor.' using errcode = '42501';
  end if;

  if v_orig is not null and not exists (
    select 1 from public.vendedores v where v.id = v_orig and v.ativo
  ) then
    raise exception 'Vendedor inexistente ou inativo.' using errcode = '23503';
  end if;

  update public.fornecedores_funil
    set originador_id = v_orig,
        -- `manual` é o que impede o job noturno de desfazer esta decisão. Voltar
        -- para null devolve o fornecedor à fila E à derivação automática: "sem dono"
        -- não é uma escolha a preservar, é a ausência de uma.
        originador_origem = case when v_orig is null then 'automatica' else 'manual' end
  where fornecedor_cnpj = v_cnpj
  returning * into v_linha;

  if v_linha.id is null then
    raise exception 'Fornecedor não está no funil.' using errcode = 'no_data_found';
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'fornecedores.reatribuir', 'fornecedores_funil', v_linha.id::text, p);

  return v_linha;
end $$;

-- ─── Tornar ponto focal (§5) ────────────────────────────────────────────────
create or replace function public.app_promover_contato_descoberto(p jsonb)
returns public.contatos language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_id uuid := (p ->> 'contato_descoberto_id')::uuid;
  v_focal boolean := coalesce((p ->> 'ponto_focal')::boolean, true);
  v_desc public.contatos_descobertos;
  v_empresa public.empresas;
  v_contato public.contatos;
begin
  if not public.app_tem_modulo('comercial') then
    raise exception 'Sem acesso ao módulo Comercial.' using errcode = '42501';
  end if;

  select * into v_desc from public.contatos_descobertos where id = v_id;
  if v_desc.id is null then
    raise exception 'Contato descoberto não encontrado.' using errcode = 'no_data_found';
  end if;
  if not public.app_fornecedor_visivel(v_desc.fornecedor_cnpj) then
    raise exception 'Este fornecedor não está na sua carteira.' using errcode = '42501';
  end if;

  -- Site e Instagram não são pessoa: não há o que virar ponto focal.
  if v_desc.tipo not in ('telefone', 'email', 'whatsapp') then
    raise exception 'Só telefone, e-mail ou WhatsApp viram contato oficial.' using errcode = '23514';
  end if;

  -- Já promovido: devolve o mesmo contato. Dois cliques não criam duas fichas.
  if v_desc.promovido_contato_id is not null then
    select * into v_contato from public.contatos where id = v_desc.promovido_contato_id;
    if v_contato.id is not null then
      if v_focal and not v_contato.ponto_focal then
        update public.contatos set ponto_focal = false
          where empresa_id = v_contato.empresa_id and ponto_focal and id <> v_contato.id;
        update public.contatos set ponto_focal = true where id = v_contato.id
          returning * into v_contato;
      end if;
      return v_contato;
    end if;
  end if;

  -- A ficha da empresa é criada aqui se ainda não existir. Exigir que alguém a crie
  -- antes transformaria o "um clique" do §5 num formulário.
  v_empresa := public.app__promover_fornecedor_para_empresa(v_desc.fornecedor_cnpj, v_ator, 'comercial');

  insert into public.contatos (empresa_id, nome, cargo, email, telefone, whatsapp, origem)
  values (
    v_empresa.id,
    coalesce(v_desc.nome_pessoa, 'Contato ' || v_desc.tipo),
    v_desc.cargo,
    case when v_desc.tipo = 'email'    then v_desc.valor end,
    case when v_desc.tipo = 'telefone' then v_desc.valor end,
    case when v_desc.tipo = 'whatsapp' then v_desc.valor
         -- Celular achado pela cascata entra também como WhatsApp: é o canal que o
         -- originador de fato usa no celular, e obrigá-lo a copiar o número de um
         -- campo para o outro é o tipo de atrito que faz o botão não ser usado.
         when v_desc.tipo = 'telefone' and (v_desc.validado ->> 'tem_whatsapp')::boolean then v_desc.valor
    end,
    'descoberta:' || v_desc.fonte
  )
  returning * into v_contato;

  if v_focal then
    -- Um por empresa (índice único parcial de 0045). A troca é feita aqui, na mesma
    -- transação, porque duas UPDATEs separadas deixam um instante com dois focais.
    update public.contatos set ponto_focal = false
      where empresa_id = v_empresa.id and ponto_focal and id <> v_contato.id;
    update public.contatos set ponto_focal = true where id = v_contato.id
      returning * into v_contato;
  end if;

  update public.contatos_descobertos
    set promovido_contato_id = v_contato.id
  where id = v_desc.id;

  update public.fornecedores_funil
    set empresa_id = coalesce(empresa_id, v_empresa.id)
  where fornecedor_cnpj = v_desc.fornecedor_cnpj;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (
    v_empresa.id,
    case when v_focal then 'contato.ponto_focal_definido' else 'contatos.enriquecidos' end,
    jsonb_build_object(
      'resumo', coalesce(v_contato.nome, 'Contato') || ' promovido a partir da descoberta ('
                || v_desc.fonte || ', confiança ' || v_desc.confianca || ').',
      'fonte', v_desc.fonte,
      'confianca', v_desc.confianca,
      'evidencia', v_desc.evidencia
    ),
    v_ator
  );

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'fornecedores.promover_contato', 'contatos', v_contato.id::text, p);

  return v_contato;
end $$;

-- ─── Pedido de apresentação (§4.3) ──────────────────────────────────────────
create or replace function public.app_pedir_apresentacao(p jsonb)
returns public.pedidos_apresentacao language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_forn text := p ->> 'fornecedor_cnpj';
  v_sacado text := p ->> 'sacado_cnpj';
  v_pedido public.pedidos_apresentacao;
  v_empresa uuid;
begin
  if not public.app_tem_modulo('comercial') then
    raise exception 'Sem acesso ao módulo Comercial.' using errcode = '42501';
  end if;
  if not public.app_fornecedor_visivel(v_forn) then
    raise exception 'Este fornecedor não está na sua carteira.' using errcode = '42501';
  end if;

  /*
   * O sacado tem de ser um sacado DESTE fornecedor. Sem esta guarda o pedido viraria
   * um caminho para mandar mensagem a qualquer cliente nosso a pretexto de apresentar
   * alguém — e a mensagem sairia com o nome de um fornecedor que nunca faturou contra
   * ele, o que é pior do que não mandar.
   */
  if not exists (
    select 1 from public.notas_fiscais nf
    where nf.fornecedor_cnpj = v_forn and nf.sacado_cnpj = v_sacado
      and nf.emitida_em >= now() - interval '180 days'
  ) then
    raise exception 'Este fornecedor não emitiu nota contra este sacado nos últimos 180 dias.'
      using errcode = '23514';
  end if;

  insert into public.pedidos_apresentacao
    (fornecedor_cnpj, sacado_cnpj, contato_sacado_id, mensagem, status, solicitado_por)
  values (
    v_forn, v_sacado, nullif(p ->> 'contato_sacado_id', '')::uuid,
    p ->> 'mensagem', 'rascunho', v_ator
  )
  returning * into v_pedido;

  select id into v_empresa from public.empresas where cnpj = v_sacado;

  -- O evento vai na timeline do SACADO, não do fornecedor: quem vai receber o pedido
  -- é o cliente, e é na ficha dele que alguém precisa ver que já pedimos um favor.
  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (
    v_empresa, 'apresentacao.solicitada',
    jsonb_build_object(
      'titulo', 'Apresentação pedida ao sacado',
      'resumo', 'Pedido de apresentação do fornecedor ' || v_forn || ' preparado.',
      'url', '/comercial/fornecedores',
      'fornecedor_cnpj', v_forn,
      'sacado_cnpj', v_sacado
    ),
    v_ator
  );

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'fornecedores.pedir_apresentacao', 'pedidos_apresentacao', v_pedido.id::text, p);

  return v_pedido;
end $$;

create or replace function public.app_pedido_apresentacao_status(p jsonb)
returns public.pedidos_apresentacao language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_id uuid := (p ->> 'pedido_id')::uuid;
  v_status text := p ->> 'status';
  v_pedido public.pedidos_apresentacao;
begin
  if not public.app_tem_modulo('comercial') then
    raise exception 'Sem acesso ao módulo Comercial.' using errcode = '42501';
  end if;

  select * into v_pedido from public.pedidos_apresentacao where id = v_id;
  if v_pedido.id is null then
    raise exception 'Pedido não encontrado.' using errcode = 'no_data_found';
  end if;
  if not public.app_fornecedor_visivel(v_pedido.fornecedor_cnpj) then
    raise exception 'Este fornecedor não está na sua carteira.' using errcode = '42501';
  end if;

  update public.pedidos_apresentacao
    set status = v_status,
        respondido_em = case when v_status = 'respondido' then now() else respondido_em end
  where id = v_id
  returning * into v_pedido;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'fornecedores.pedido_status', 'pedidos_apresentacao', v_id::text, p);

  return v_pedido;
end $$;

-- ─── Toque do Comercial ─────────────────────────────────────────────────────
create or replace function public.app_fornecedor_toque(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_cnpj text := p ->> 'fornecedor_cnpj';
  v_desc public.contatos_descobertos;
begin
  if not public.app_tem_modulo('comercial') then
    raise exception 'Sem acesso ao módulo Comercial.' using errcode = '42501';
  end if;
  if not public.app_fornecedor_visivel(v_cnpj) then
    raise exception 'Este fornecedor não está na sua carteira.' using errcode = '42501';
  end if;

  if nullif(p ->> 'contato_descoberto_id', '') is not null then
    select * into v_desc from public.contatos_descobertos
      where id = (p ->> 'contato_descoberto_id')::uuid;
  end if;

  perform public.app__registrar_toque(
    v_cnpj, p ->> 'canal', coalesce(v_desc.valor, p ->> 'contato'),
    jsonb_build_object(
      'origem_modulo', 'comercial',
      'contato_descoberto_id', v_desc.id,
      -- A fonte no payload é o que o §6 lê. Guardá-la aqui, e não só na tabela de
      -- contatos, é o que faz a atribuição sobreviver a um contato apagado.
      'fonte', v_desc.fonte,
      'confianca', v_desc.confianca
    ),
    auth.uid()
  );

  -- Quem tocou está trabalhando o lead. Mover o card à mão depois de ligar é a
  -- etapa que ninguém faz, e o funil fica mentindo que ninguém falou com ele.
  update public.fornecedores_funil
    set estagio = 'em_prospeccao', estagio_alterado_em = now(), estagio_alterado_por = auth.uid()
  where fornecedor_cnpj = v_cnpj and estagio = 'a_cadastrar';
end $$;

-- ─── Settings ───────────────────────────────────────────────────────────────
create or replace function public.app_salvar_fornecedores_config(p jsonb)
returns public.fornecedores_config language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_linha public.fornecedores_config;
begin
  if not public.app_gestor_comercial() then
    raise exception 'Só um gestor comercial altera as configurações.' using errcode = '42501';
  end if;

  -- O cache de token não é config: ele mora em `integracao_tokens`, sem grant. Barrar
  -- a chave aqui é redundância barata contra alguém recriá-lo neste caminho.
  if (p ->> 'chave') like '%token%' or (p ->> 'chave') like '%senha%' then
    raise exception 'Credencial não se guarda em configuração.' using errcode = '42501';
  end if;

  insert into public.fornecedores_config (chave, valor, atualizado_por, atualizado_em)
  values (p ->> 'chave', p -> 'valor', v_ator, now())
  on conflict (chave) do update
    set valor = excluded.valor, atualizado_por = excluded.atualizado_por, atualizado_em = now()
  returning * into v_linha;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'fornecedores.config', 'fornecedores_config', v_linha.chave, p);

  return v_linha;
end $$;

/*
 * `create or replace function` PRESERVA a ACL.
 *
 * As três funções de outros módulos que tiveram o corpo reescrito acima carregam
 * `anon=X` desde que foram criadas, e reescrevê-las herdou a permissão. Explorável
 * hoje não é: as três abrem com `app_tem_modulo(...)`, que resolve `auth.uid()` — para
 * o `anon` isso é null, o `exists` dá falso e a função levanta 42501 antes de tocar em
 * qualquer tabela.
 *
 * Mas uma DEFINER que insere em `empresas` e grava `supressao` não deve estar ao
 * alcance de um papel sem sessão por um caminho que só falha por causa de um `if` no
 * topo. Quem reescreveu o corpo passa a responder pela ACL dele.
 */
revoke execute on function public.app_marcar_sem_interesse(jsonb) from anon;
revoke execute on function public.app_promover_fornecedor(jsonb) from anon;
revoke execute on function public.app_registrar_toque_manual(jsonb) from anon;

-- ─── Grants das escritas ────────────────────────────────────────────────────
revoke execute on function public.app_fornecedor_mover(jsonb) from public, anon;
revoke execute on function public.app_fornecedor_sem_interesse(jsonb) from public, anon;
revoke execute on function public.app_fornecedor_reatribuir(jsonb) from public, anon;
revoke execute on function public.app_promover_contato_descoberto(jsonb) from public, anon;
revoke execute on function public.app_pedir_apresentacao(jsonb) from public, anon;
revoke execute on function public.app_pedido_apresentacao_status(jsonb) from public, anon;
revoke execute on function public.app_fornecedor_toque(jsonb) from public, anon;
revoke execute on function public.app_salvar_fornecedores_config(jsonb) from public, anon;

grant execute on function public.app_fornecedor_mover(jsonb) to authenticated, service_role;
grant execute on function public.app_fornecedor_sem_interesse(jsonb) to authenticated, service_role;
grant execute on function public.app_fornecedor_reatribuir(jsonb) to authenticated, service_role;
grant execute on function public.app_promover_contato_descoberto(jsonb) to authenticated, service_role;
grant execute on function public.app_pedir_apresentacao(jsonb) to authenticated, service_role;
grant execute on function public.app_pedido_apresentacao_status(jsonb) to authenticated, service_role;
grant execute on function public.app_fornecedor_toque(jsonb) to authenticated, service_role;
grant execute on function public.app_salvar_fornecedores_config(jsonb) to authenticated, service_role;

-- =============================================================================
-- §5/§6 — Leitura: a view do kanban, o painel e a eficácia por fonte
-- =============================================================================

create view public.fornecedores_funil_view
with (security_invoker = true) as
  select
    f.id,
    f.fornecedor_cnpj,
    -- A razão social do cadastro ganha do nome da NF (mesma razão de 0056/0101: o da
    -- nota é o que o emitente digitou, e vem abreviado com frequência).
    coalesce(mu.razao_social, f.fornecedor_cnpj) as fornecedor_nome,
    mu.nome_fantasia,
    mu.municipio,
    mu.uf,
    mu.cnae_principal,
    mu.porte_rfb,
    mu.situacao_cadastral,
    mu.data_inicio_atividade,
    mu.dominio,
    mu.dominio_confianca,
    f.originador_id,
    f.originador_origem,
    v.nome as originador_nome,
    f.estagio,
    f.estagio_alterado_em,
    f.sem_interesse_motivo,
    f.sem_interesse_observacao,
    f.sem_interesse_ate,
    (f.estagio = 'sem_interesse') as suprimido,
    f.volume_90d,
    f.qtd_nfs_90d,
    f.prazo_medio_dias,
    f.sacados_principais,
    f.potencial_mensal,
    f.ultima_nf_em,
    f.contatos_encontrados,
    f.melhor_confianca,
    f.ultima_busca_em,
    f.descoberta_automatica_em,
    f.empresa_id,
    f.entrou_em
    /*
     * SEM `supressao` e SEM contagens correlacionadas, e as duas ausências são
     * decisões.
     *
     * `supressao`: a policy daquela tabela exige o módulo `radar`. Como esta view é
     * `security_invoker`, o LEFT JOIN vinha VAZIO para o time Comercial — e devolvia
     * `suprimido = false` com a cara de resposta certa, para exatamente o público da
     * tela. O dado desceu para a própria linha do funil, escrito pelo RPC.
     *
     * Contagens: um `count(*)` sobre `pedidos_apresentacao` avaliaria a RLS daquela
     * tabela por linha — 500 avaliações numa página de 500 cards, e o custo só
     * apareceria quando o recurso começasse a ser usado.
     */
  from public.fornecedores_funil f
    left join public.mercado_universo mu on mu.cnpj = f.fornecedor_cnpj
    left join public.vendedores v on v.id = f.originador_id;

grant select on public.fornecedores_funil_view to authenticated;

comment on view public.fornecedores_funil_view is
  'O card do funil de fornecedores com o cadastral junto. security_invoker: a RLS de '
  '`fornecedores_funil` é quem recorta por originador. NÃO lê `supressao` — a policy '
  'daquela tabela exige o módulo radar, e um join que a RLS esvazia devolveria "não '
  'suprimido" justamente para o público desta tela.';

-- ─── Painel do originador (§5) ──────────────────────────────────────────────
create or replace function public.fornecedores_painel(p_originador_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_eu uuid := public.app_vendedor_atual();
  v_gestor boolean := public.app_gestor_comercial();
  v_alvo uuid;
  v_teto numeric := coalesce((select (valor #>> '{}')::numeric from public.fornecedores_config
                              where chave = 'teto_mensal_por_originador'), 0);
  v_inicio timestamptz := date_trunc('month', now());
  v_out jsonb;
begin
  if not public.app_tem_modulo('comercial') then
    return jsonb_build_object('tem_acesso', false);
  end if;

  /*
   * O alvo, com a mesma disciplina do painel de comissão: um não-gestor SÓ vê a si
   * mesmo, e o parâmetro é ignorado em vez de recusado. Recusar ensinaria que o id
   * do colega é um id válido; ignorar não diz nada.
   */
  v_alvo := case when v_gestor then p_originador_id else v_eu end;

  select jsonb_build_object(
    'tem_acesso', true,
    'eh_gestor', v_gestor,
    'originador_id', v_alvo,
    'por_estagio', coalesce((
      select jsonb_object_agg(t.estagio, t.n) from (
        select f.estagio, count(*)::int as n
        from public.fornecedores_funil f
        where (v_alvo is null or f.originador_id = v_alvo)
          and (v_gestor or f.originador_id = v_eu)
        group by f.estagio
      ) t
    ), '{}'::jsonb),
    'potencial_total', coalesce((
      select sum(f.potencial_mensal) from public.fornecedores_funil f
      where f.estagio not in ('cadastrado', 'sem_interesse')
        and (v_alvo is null or f.originador_id = v_alvo)
        and (v_gestor or f.originador_id = v_eu)
    ), 0),
    'sem_dono', case when v_gestor then (
      select count(*)::int from public.fornecedores_funil f
      where f.originador_id is null and f.estagio not in ('cadastrado', 'sem_interesse')
    ) else null end,
    'gasto_mes', coalesce((
      select sum(e.custo) from public.descoberta_execucoes e
      where e.executado_em >= v_inicio
        and (v_alvo is null or e.originador_id = v_alvo)
        and (v_gestor or e.originador_id = v_eu)
    ), 0),
    'teto_mensal', v_teto,
    'ranking', coalesce((
      select jsonb_agg(jsonb_build_object(
        'fornecedor_cnpj', r.fornecedor_cnpj,
        'nome', r.nome,
        'potencial_mensal', r.potencial_mensal,
        'estagio', r.estagio,
        'contatos_encontrados', r.contatos_encontrados,
        'melhor_confianca', r.melhor_confianca
      ) order by r.potencial_mensal desc nulls last)
      from (
        select f.fornecedor_cnpj, coalesce(mu.razao_social, f.fornecedor_cnpj) as nome,
               f.potencial_mensal, f.estagio, f.contatos_encontrados, f.melhor_confianca
        from public.fornecedores_funil f
          left join public.mercado_universo mu on mu.cnpj = f.fornecedor_cnpj
        where f.estagio not in ('cadastrado', 'sem_interesse')
          and (v_alvo is null or f.originador_id = v_alvo)
          and (v_gestor or f.originador_id = v_eu)
        order by f.potencial_mensal desc nulls last
        limit 10
      ) r
    ), '[]'::jsonb)
  ) into v_out;

  return v_out;
end $$;

revoke execute on function public.fornecedores_painel(uuid) from public, anon;
grant execute on function public.fornecedores_painel(uuid) to authenticated, service_role;

comment on function public.fornecedores_painel is
  'Painel do originador (04l §5): contagem por estágio, potencial na carteira, gasto '
  'do mês contra o teto e ranking por potencial. Não-gestor só vê a si mesmo.';

-- ─── Aprendizado de fontes (§6) ─────────────────────────────────────────────
create or replace function public.fornecedores_eficacia_fontes()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_out jsonb;
begin
  if not public.app_gestor_comercial() then
    raise exception 'Só um gestor comercial vê a eficácia por fonte.' using errcode = '42501';
  end if;

  with
  /*
   * Qual fonte levou ao cadastro: o ÚLTIMO toque antes de o fornecedor virar
   * `cadastrado`. Não é o contato mais recente nem o de maior confiança — é aquele
   * com que a pessoa efetivamente falou, e é a única leitura que responde "vale a
   * pena continuar pagando por este provedor".
   */
  cadastrados as (
    select f.fornecedor_cnpj, f.estagio_alterado_em
    from public.fornecedores_funil f
    where f.estagio = 'cadastrado'
  ),
  atribuicao as (
    select distinct on (c.fornecedor_cnpj)
      c.fornecedor_cnpj,
      e.payload ->> 'fonte' as fonte
    from cadastrados c
      join public.empresa_eventos e
        on e.tipo = 'toque.manual'
       and e.payload ->> 'cnpj' = c.fornecedor_cnpj
       and (c.estagio_alterado_em is null or e.criado_em <= c.estagio_alterado_em)
    where e.payload ->> 'fonte' is not null
    order by c.fornecedor_cnpj, e.criado_em desc
  ),
  contatos as (
    select
      cd.fonte,
      count(*)::int as encontrados,
      count(*) filter (where cd.validado ? 'valido' and (cd.validado ->> 'valido')::boolean)::int as validos,
      count(*) filter (where cd.validado ? 'valido')::int as testados,
      count(*) filter (where cd.promovido_contato_id is not null)::int as promovidos
    from public.contatos_descobertos cd
    group by cd.fonte
  ),
  custos as (
    select
      -- `contatos_base` grava em `contatos_descobertos.fonte = site_empresa`: as duas
      -- linhas são o mesmo dinheiro (zero) e a mesma fonte na tela.
      case when x.provedor = 'contatos_base' then 'site_empresa' else x.provedor end as fonte,
      sum(x.custo) as custo,
      count(*)::int as execucoes,
      count(*) filter (where x.status = 'sucesso')::int as acertos
    from public.descoberta_execucoes x
    group by 1
  ),
  cadastros as (
    select a.fonte, count(*)::int as cadastros
    from atribuicao a where a.fonte is not null group by a.fonte
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'fonte', f.fonte,
    'contatos_encontrados', coalesce(c.encontrados, 0),
    'contatos_validos', coalesce(c.validos, 0),
    'contatos_testados', coalesce(c.testados, 0),
    'contatos_promovidos', coalesce(c.promovidos, 0),
    'execucoes', coalesce(k.execucoes, 0),
    'acertos', coalesce(k.acertos, 0),
    'custo_total', coalesce(k.custo, 0),
    'cadastros', coalesce(g.cadastros, 0),
    -- null, e não zero nem infinito: "ainda não sabemos" é a resposta certa enquanto
    -- não houver um cadastro atribuído, e um zero aqui leria como "sai de graça".
    'custo_por_cadastro', case when coalesce(g.cadastros, 0) > 0
                               then round(coalesce(k.custo, 0) / g.cadastros, 2) end
  ) order by coalesce(g.cadastros, 0) desc, coalesce(c.encontrados, 0) desc), '[]'::jsonb)
  into v_out
  from (
    select fonte from contatos
    union select fonte from custos
    union select fonte from cadastros
  ) f
    left join contatos c on c.fonte = f.fonte
    left join custos k on k.fonte = f.fonte
    left join cadastros g on g.fonte = f.fonte;

  return v_out;
end $$;

revoke execute on function public.fornecedores_eficacia_fontes() from public, anon;
grant execute on function public.fornecedores_eficacia_fontes() to authenticated, service_role;

comment on function public.fornecedores_eficacia_fontes is
  'Painel de eficácia por fonte (04l §6): quantos contatos, quantos válidos, quantos '
  'viraram cadastro e a que custo. Em três meses isso reordena a cascata com '
  'evidência — e permite desligar provedor que não paga.';

-- =============================================================================
-- Seeds
--
-- Todo valor aqui é editável na tela de settings. Os defaults saíram da medição da
-- base em 25/08/2026, não de arredondamento.
-- =============================================================================

insert into public.fornecedores_config (chave, valor) values
  ('corte_volume', '50000'::jsonb),

  /*
   * Custos por consulta, em reais. Ficam em config porque câmbio e tabela de
   * provedor mudam sem avisar — e porque o custo estimado que o botão mostra ao
   * originador PRECISA ser o mesmo número que o orçamento debita depois.
   *
   * `apollo` é o mesmo valor de `radar_config.custos.contato_apollo`: é a mesma
   * cobrança, e dois números para ela fariam os dois orçamentos divergirem sobre a
   * mesma fatura.
   */
  ('custos', '{"google_places": 0.18, "novavida": 0.35, "apollo": 1.2, "claude_busca": 0.1}'::jsonb),

  /*
   * O teto mensal POR ORIGINADOR é a autorização, não o gestor.
   *
   * R$ 150 compram ~90 cliques completos. Ele existe para que o originador acione
   * sozinho: pedir aprovação para cada R$ 1,65 transformaria a descoberta num
   * processo com fila, e uma fila de aprovação de centavos é como um recurso pago
   * vira um recurso que ninguém usa.
   */
  ('teto_mensal_por_originador', '150'::jsonb),

  /*
   * A camada automática roda para TODOS, sem clique — e o único item pago dela é o
   * Google Places. 688 fornecedores × R$ 0,18 = R$ 123,84 para varrer a lista
   * inteira uma vez. O teto de R$ 400 cobre a primeira varredura e a reposição
   * mensal do que entra, com folga; estourado, o job para o que é pago e avisa —
   * mas as quatro etapas grátis continuam rodando, porque são elas que trazem 77%
   * dos telefones.
   */
  ('orcamento_automatico_mensal', '400'::jsonb),
  ('alerta_percentual', '0.8'::jsonb),

  ('parar_ao_encontrar_alta', 'true'::jsonb),

  -- Apollo só onde existe estrutura administrativa com LinkedIn (§4.2b).
  ('apollo_minimo_funcionarios', '10'::jsonb),
  ('apollo_minimo_faturamento', '20000000'::jsonb),

  -- Quantos dias esperar antes de reconsultar um provedor pago para o mesmo CNPJ.
  -- Sem isso, dois cliques no mesmo card em dias seguidos pagam duas vezes pela
  -- mesma resposta.
  ('ttl_dias_sob_demanda', '90'::jsonb),
  ('ttl_dias_automatica', '30'::jsonb),

  -- Quantas notas do fornecedor o extrator de XML lê por rodada. O ganho satura
  -- rápido: o telefone do `emit` é o mesmo em todas, e o que muda é a `frequencia`.
  ('max_notas_por_extracao', '60'::jsonb),

  ('template_apresentacao', to_jsonb($tpl$Oi {{contato_sacado_nome}}, tudo bem?

Somos parceiros da {{sacado_nome}} na antecipação de recebíveis, e vimos que a {{fornecedor_nome}} é fornecedora de vocês.

Faz sentido você nos apresentar a eles? A ideia é oferecer antecipação das notas que eles emitem contra vocês — o que costuma ajudar o fornecedor a manter prazo e preço.

Se puder passar o contato de quem cuida do financeiro lá, ou fazer a ponte num e-mail, já ajuda muito.

Obrigado!
{{originador_nome}}$tpl$::text))
on conflict (chave) do nothing;

comment on table public.fornecedores_config is
  'Settings do funil de fornecedores (04l). O template de apresentação NÃO cita o '
  'volume que o fornecedor fatura contra o sacado: o número vem das notas que o '
  'próprio sacado nos enviou, e devolvê-lo na mensagem soa como vigilância mesmo '
  'sendo um dado que ele nos deu. As variáveis existem para quem quiser adaptar.';
