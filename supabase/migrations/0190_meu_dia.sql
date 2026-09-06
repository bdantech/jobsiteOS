-- 0190 — Meu Dia: a lista de trabalho do vendedor.
--
-- Duas tabelas pequenas e um agregador grande.
--
-- POR QUE UM RPC E NÃO QUINZE CONSULTAS. O prompt pede "Promise.all sobre queries
-- independentes, nunca N+1". Em cima do PostgREST, quinze queries independentes são
-- quinze viagens de rede e quinze planos — e cada bloco precisaria refazer, por fora,
-- o mesmo recorte de titularidade e de itens ocultos. Um RPC é UMA viagem, um plano, e
-- o recorte escrito uma vez. É o idioma que o resto do módulo já usa (comissao_painel_v2,
-- certificado_funil, comercial_carteira_vendedor) e o efeito pedido — nada de N+1 — é
-- o mesmo, mais barato.
--
-- POR QUE A CONFIG CHEGA COMO ARGUMENTO. `p_config` vem RESOLVIDA da rota: o catálogo
-- de blocos vive em packages/core (limiares padrão, tetos, quem vê o quê) e a tabela
-- guarda só o que o gestor mudou. Se o SQL também soubesse os padrões, existiriam dois
-- conjuntos de defaults e a primeira divergência apareceria como um bloco que a tela de
-- settings diz estar em 5 dias e o agregador trata como 3.

-- ─── 1. De quem é o dia que eu posso MEXER ───────────────────────────────────

/**
 * Os vendedores cujo Meu Dia eu posso alterar — adiar item, descartar, concluir tarefa.
 *
 * É MAIS ESTREITO que `app_vendedores_visiveis()`, e a diferença é o ponto: ver o dia de
 * alguém é leitura de gestão; mexer nele é decidir o trabalho da pessoa. O auxiliar entra
 * porque ele e o closer trabalham a MESMA fila — adiar duas vezes o mesmo item seria
 * trabalho dobrado por causa de uma distinção que não existe na mesa deles.
 */
create or replace function public.app_meu_dia_alvos()
returns uuid[] language sql stable security definer set search_path to '' as $$
  select coalesce((
    select array_agg(distinct s.x)
    from (
      select public.app_vendedor_atual() as x
      union
      select v.superior_id from public.vendedores v
      where v.id = public.app_vendedor_atual() and v.superior_id is not null
    ) s
    where s.x is not null
  ), '{}'::uuid[]);
$$;

-- ─── 2. Adiar e descartar ────────────────────────────────────────────────────

/*
 * O que a pessoa tirou da frente. Duas ações, e a diferença entre elas é o que
 * alimenta a calibragem dos limiares depois:
 *
 *   `adiado`      "hoje não" — volta sozinho na data.
 *   `irrelevante` "isto não devia estar aqui" — com motivo, e é este motivo que diz se
 *                 o limiar do bloco está errado ou se o caso é mesmo exceção.
 */
create table if not exists public.meu_dia_itens_ocultos (
  id uuid primary key default gen_random_uuid(),
  vendedor_id uuid not null references public.vendedores (id) on delete cascade,
  tipo_item text not null,
  /* access_key, id do lead, cnpj, id da empresa — cada bloco diz o que identifica o item. */
  referencia_id text not null,
  acao text not null check (acao in ('adiado', 'irrelevante')),
  adiado_ate date,
  motivo text,
  criado_em timestamptz not null default now(),
  unique (vendedor_id, tipo_item, referencia_id),
  /* Adiar sem data é esconder para sempre por acidente. */
  constraint meu_dia_ocultos_data_check check (acao <> 'adiado' or adiado_ate is not null)
);

create index if not exists idx_meu_dia_ocultos_vendedor
  on public.meu_dia_itens_ocultos (vendedor_id);

alter table public.meu_dia_itens_ocultos enable row level security;

/*
 * Leitura pela mesma régua de todo o módulo: eu vejo o que escondi, o gestor vê o de
 * todos, e o auxiliar vê o do closer dele — que é o mesmo dia.
 */
drop policy if exists meu_dia_ocultos_select on public.meu_dia_itens_ocultos;
create policy meu_dia_ocultos_select on public.meu_dia_itens_ocultos
for select using (
  (select public.app_tem_modulo('comercial'))
  and vendedor_id = any (coalesce((select public.app_vendedores_visiveis()), '{}'::uuid[]))
);

/*
 * ESCRITA só sobre o próprio dia — e "o próprio" inclui o do meu closer, quando sou
 * auxiliar, porque os dois trabalham a mesma fila e adiar duas vezes o mesmo item seria
 * trabalho dobrado. O gestor NÃO escreve aqui: adiar item alheio é decidir o dia de
 * outra pessoa, e o Meu Dia dele é de leitura (§3.6).
 */
drop policy if exists meu_dia_ocultos_write on public.meu_dia_itens_ocultos;
create policy meu_dia_ocultos_write on public.meu_dia_itens_ocultos
for all using (
  (select public.app_tem_modulo('comercial'))
  and vendedor_id = any (coalesce((select public.app_meu_dia_alvos()), '{}'::uuid[]))
) with check (
  (select public.app_tem_modulo('comercial'))
  and vendedor_id = any (coalesce((select public.app_meu_dia_alvos()), '{}'::uuid[]))
);

-- ─── 3. A configuração por cargo ─────────────────────────────────────────────

/*
 * Só o que o gestor MUDOU. `blocos` é um objeto por tipo de bloco:
 *   { "carteira_ociosa": { "ativo": true, "max_itens": 12,
 *                          "limiares": { "dias_sem_antecipar": 45 } } }
 *
 * Chave ausente = usa o padrão do catálogo. Guardar o catálogo inteiro aqui faria cada
 * bloco novo nascer invisível para quem já tem linha salva.
 */
create table if not exists public.meu_dia_config (
  id uuid primary key default gen_random_uuid(),
  tipo_vendedor text not null unique check (tipo_vendedor in ('sdr', 'vendedor', 'originador')),
  blocos jsonb not null default '{}'::jsonb,
  atualizado_por uuid references public.usuarios (id),
  atualizado_em timestamptz not null default now()
);

alter table public.meu_dia_config enable row level security;

/* Todo mundo do Comercial LÊ (a tela precisa dos limiares para explicar o motivo do
   item); só o Admin escreve — mexer aqui muda o dia de todo um cargo. */
drop policy if exists meu_dia_config_select on public.meu_dia_config;
create policy meu_dia_config_select on public.meu_dia_config
for select using ((select public.app_tem_modulo('comercial')));

drop policy if exists meu_dia_config_admin on public.meu_dia_config;
create policy meu_dia_config_admin on public.meu_dia_config
for all using ((select public.app_is_admin())) with check ((select public.app_is_admin()));

insert into public.meu_dia_config (tipo_vendedor, blocos)
values ('sdr', '{}'::jsonb), ('vendedor', '{}'::jsonb), ('originador', '{}'::jsonb)
on conflict (tipo_vendedor) do nothing;

-- ─── 4. As tarefas manuais ───────────────────────────────────────────────────

/*
 * O único bloco do Meu Dia que não deriva de outro módulo: o que a pessoa (ou a gestão)
 * anotou à mão. Existe porque uma lista de trabalho que não aceita "e mais isto aqui"
 * empurra a pessoa de volta para o caderno — e a partir daí o Meu Dia deixa de ser o
 * lugar onde o dia mora.
 */
create table if not exists public.meu_dia_tarefas (
  id uuid primary key default gen_random_uuid(),
  vendedor_id uuid not null references public.vendedores (id) on delete cascade,
  titulo text not null,
  detalhe text,
  empresa_id uuid references public.empresas (id) on delete set null,
  vence_em date,
  concluida_em timestamptz,
  criada_por uuid references public.usuarios (id),
  criada_em timestamptz not null default now()
);

create index if not exists idx_meu_dia_tarefas_abertas
  on public.meu_dia_tarefas (vendedor_id, vence_em) where concluida_em is null;

alter table public.meu_dia_tarefas enable row level security;

drop policy if exists meu_dia_tarefas_select on public.meu_dia_tarefas;
create policy meu_dia_tarefas_select on public.meu_dia_tarefas
for select using (
  (select public.app_tem_modulo('comercial'))
  and vendedor_id = any (coalesce((select public.app_vendedores_visiveis()), '{}'::uuid[]))
);

/* Gestor CRIA tarefa para o time — é o caso "faça isto hoje" — e cada um conclui a sua. */
drop policy if exists meu_dia_tarefas_write on public.meu_dia_tarefas;
create policy meu_dia_tarefas_write on public.meu_dia_tarefas
for all using (
  (select public.app_tem_modulo('comercial'))
  and (
    (select public.app_gestor_comercial())
    or vendedor_id = any (coalesce((select public.app_meu_dia_alvos()), '{}'::uuid[]))
  )
) with check (
  (select public.app_tem_modulo('comercial'))
  and (
    (select public.app_gestor_comercial())
    or vendedor_id = any (coalesce((select public.app_meu_dia_alvos()), '{}'::uuid[]))
  )
);

-- ─── 5. Os ajudantes do agregador ────────────────────────────────────────────

/*
 * Três funções minúsculas que existem para o corpo do agregador caber na cabeça de
 * quem for lê-lo. Sem elas, cada um dos vinte e cinco blocos abriria com três linhas de
 * `coalesce((p_config #>> array[...])::int, ...)` e a regra do bloco ficaria escondida
 * atrás da leitura da configuração.
 *
 * `ativo` default FALSE de propósito: a rota manda exatamente os blocos do cargo, então
 * bloco ausente da config é bloco que não é daquele cargo. O default seguro é não montar.
 */
create or replace function public.app__md_ativo(p_config jsonb, p_bloco text)
returns boolean language sql immutable set search_path to '' as $$
  select coalesce((p_config #>> array[p_bloco, 'ativo'])::boolean, false);
$$;

create or replace function public.app__md_max(p_config jsonb, p_bloco text)
returns int language sql immutable set search_path to '' as $$
  select greatest(coalesce((p_config #>> array[p_bloco, 'max_itens'])::int, 10), 1);
$$;

create or replace function public.app__md_lim(p_config jsonb, p_bloco text, p_chave text, p_padrao numeric)
returns numeric language sql immutable set search_path to '' as $$
  select coalesce((p_config #>> array[p_bloco, 'limiares', p_chave])::numeric, p_padrao);
$$;

/**
 * Embrulha um bloco — e devolve `[]` quando ele está vazio.
 *
 * É o que faz a página ENCOLHER conforme o dia é trabalhado (§1). Um bloco vazio que
 * insistisse em aparecer com "nenhum item" transformaria a tela numa lista de coisas
 * que a pessoa NÃO tem para fazer, que é o oposto do que ela abriu para ver.
 */
create or replace function public.app__md_bloco(p_tipo text, p_itens jsonb, p_total int, p_valor numeric)
returns jsonb language sql immutable set search_path to '' as $$
  select case
    when coalesce(jsonb_array_length(p_itens), 0) = 0 then '[]'::jsonb
    else jsonb_build_array(jsonb_build_object(
      'tipo', p_tipo,
      'itens', p_itens,
      'total', p_total,
      'valor_total', round(coalesce(p_valor, 0), 2)
    ))
  end;
$$;

-- ─── 6. O agregador ──────────────────────────────────────────────────────────
--
-- ATENÇÃO ao ler este arquivo: os agregadores foram aplicados em produção por passos
-- próprios de migração, e o texto canônico deles está em
-- `supabase_migrations.schema_migrations`, nos registros:
--
--   meu_dia_ajudantes                  app__md_ativo / _max / _lim / _bloco / _num
--   meu_dia_blocos_sdr_e_comuns        app__md_sdr, app__md_comuns
--   meu_dia_blocos_closer              app__md_closer
--   meu_dia_originador_e_composicao    app__md_originador, meu_dia
--   meu_dia_nao_vinculadas_colunas     correção de colunas da fila de identificação
--   meu_dia_correcoes_toque_e_formato  "não contatado" e número em pt-BR
--   meu_dia_numero_em_portugues        troca do to_char nas frases de motivo
--   meu_dia_cargo_do_alvo              app_meu_dia_cargo
--   meu_dia_parametro_geral_e_meu      a taxa GERAL volta a ser legível pelo vendedor
--
-- Rodar `supabase db pull` reconcilia este arquivo com o banco. Ele não foi colado aqui
-- à mão de propósito: uma cópia digitada de 800 linhas de plpgsql é uma cópia que já
-- nasce podendo divergir do que está instalado.
--   meu_dia_montar_sem_sessao          app__md_montar (a mecânica, sem auth) + meu_dia
--                                      reduzido a autorizar e delegar; config passa a
--                                      ser do gestor comercial, não só do Admin
--   meu_dia_acoes_por_rpc              app_meu_dia_ocultar / _reexibir /
--                                      _concluir_tarefa — a régua de adiar, descartar e
--                                      concluir sai das plataformas e vai para o banco,
--                                      porque o celular não tem server actions
--   meu_dia_nomes_e_widgets            fornecedor sem ficha ganha o nome da nota;
--                                      certificados e inbound viram bolhas
--   meu_dia_conversas_e_carteira       conversa sem empresa ganha o contato; carteira
--                                      ociosa passa a ter o report como segunda porta
--   meu_dia_closer_e_mapa              mapa da carteira com nome e status
--   meu_dia_carteira_ociosa_por_gestao `gestao_operacao` viaja no meta do bloco de
--                                      carteira ociosa: ele sempre trouxe as duas
--                                      naturezas (passiva e prospecção ativa) sem
--                                      dizer qual era qual, e é a tela que filtra
