-- ─────────────────────────────────────────────────────────────────────────────
-- 0262 — Um motor de avisos, e um painel para ele
--
-- A auditoria de 24/09 achou três caminhos até o sino, que não conversavam:
--
--   1. evento + regra ...... `empresa_eventos` → trigger → `notificacao_regras`,
--                             que só conhece PERFIL ou USUÁRIO fixo. Sino, sem push.
--   2. `notify()` direto ... ~35 pontos no worker e na web, com destinatário e
--                             texto escritos no código. Sino + push.
--   3. insert solto ........ dois casos pontuais.
--
-- O resultado era o que o relatório mostrou: o aviso ia para a gestão e não para
-- quem age (o closer não sabia da reunião esperando o aceite dele), vários fatos
-- chegavam duas ou três vezes (um caminho de cada lado), push de madrugada, e 61%
-- do sino era um único tipo que ninguém lia. E nada disso era editável sem código.
--
-- ─── O MOTOR ─────────────────────────────────────────────────────────────────
-- `notificacao_emitir(tipo, empresa, payload)` é o caminho único. O trigger de
-- `empresa_eventos` passa a chamá-lo, e o worker e a web o chamam direto para os
-- avisos que não são fatos de uma empresa. Ele:
--
--   • lê as regras ativas do tipo — agora com DESTINATÁRIO POR PAPEL (o SDR do
--     lead, o closer da reunião, o originador da nota, o dono da empresa…),
--     resolvido pelo dado do evento em `notificacao_resolver_papel`;
--   • "se ninguém, cai para o Admin": regra com `fallback_admin` nunca some em
--     silêncio — os perfis Crédito e Jurídico estão vazios hoje, e os avisos deles
--     não chegavam a ninguém;
--   • um aviso por pessoa por evento, mesmo que várias regras a alcancem — é o que
--     acaba com o sino em dobro;
--   • renderiza o texto: o modelo do catálogo se houver (com {{variáveis}}), senão o
--     texto que o código mandou — nenhum aviso depende do painel para existir;
--   • trava de repetição por chave, em horas;
--   • frequência: na hora (sino + fila de push/e-mail, respeitando o horário de
--     silêncio) ou RESUMO DIÁRIO (fila própria, entregue às 8h num aviso só).
--
-- O motor nunca derruba quem o chamou: o trigger roda dentro das RPCs de negócio,
-- e um aviso que falha não pode desfazer a venda que acabou de ser movida.
--
-- ─── O PAINEL ────────────────────────────────────────────────────────────────
-- `notificacao_tipos` é o catálogo (um registro por tipo, com modelo de texto e
-- pausa); as regras ganham papel, canais, frequência, silêncio, repetição e
-- fallback; `notificacao_config` guarda o horário de silêncio; e toda mudança nas
-- três fica em `notificacao_historico`, com quem e quando. As três são escritas
-- pela tela de Admin com a sessão da pessoa — a RLS é que diz que só admin mexe.
--
-- ─── AS REGRAS DE PARTIDA ────────────────────────────────────────────────────
-- No fim, as regras replicam o que existia com os ajustes aprovados no relatório:
-- (a) quem age passa a receber; (b) o que era ruído vira resumo, vai ao dono, ou
-- para. Os avisos que o código mandava direto ganham tipo e regra própria, e o
-- código deixa de mandá-los (mesma entrega, agora mudável pelo painel).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. O sino passa a saber o tipo ───────────────────────────────────────────

alter table public.notificacoes
  add column if not exists tipo text,
  add column if not exists chave text;

comment on column public.notificacoes.tipo is
  'Tipo do aviso no catálogo (notificacao_tipos). Nulo nos avisos anteriores à 0262 que o backfill não casou.';
comment on column public.notificacoes.chave is
  'Chave de repetição: o motor não repete o mesmo aviso para a mesma pessoa dentro da janela da regra.';

create index if not exists notificacoes_chave_idx
  on public.notificacoes (usuario_id, chave, criado_em desc) where chave is not null;
create index if not exists notificacoes_tipo_idx
  on public.notificacoes (tipo, criado_em desc) where tipo is not null;

-- ── 2. O catálogo ────────────────────────────────────────────────────────────

create table if not exists public.notificacao_tipos (
  tipo            text primary key,
  modulo          text not null default 'plataforma',
  nome            text not null,
  descricao       text,
  gravidade       text not null default 'normal' check (gravidade in ('normal', 'critica')),
  -- Pausar o tipo inteiro: nenhuma regra dele entrega enquanto estiver false.
  ativo           boolean not null default true,
  -- O modelo de texto. Nulo = vale o texto que o código mandou no payload.
  titulo_modelo   text,
  corpo_modelo    text,
  url_modelo      text,
  -- O último payload visto pelo caminho direto (os eventos de empresa têm o seu
  -- em empresa_eventos). É o que alimenta a prévia e a lista de variáveis.
  ultimo_payload  jsonb,
  ultimo_em       timestamptz,
  atualizado_por  uuid references public.usuarios (id) on delete set null,
  atualizado_em   timestamptz not null default now(),
  criado_em       timestamptz not null default now()
);

comment on table public.notificacao_tipos is
  'Catálogo de avisos (0262). O código registra o tipo; o texto e a pausa são do painel de Admin.';

alter table public.notificacao_tipos enable row level security;

drop policy if exists notificacao_tipos_admin on public.notificacao_tipos;
create policy notificacao_tipos_admin on public.notificacao_tipos
  for all to authenticated using (public.app_is_admin()) with check (public.app_is_admin());

-- ── 3. As regras ganham papel, canais e ritmo ────────────────────────────────

alter table public.notificacao_regras
  add column if not exists papel text,
  add column if not exists canais text[] not null default '{sino}',
  add column if not exists frequencia text not null default 'imediato',
  add column if not exists respeita_silencio boolean not null default true,
  add column if not exists dedup_horas integer not null default 0,
  add column if not exists fallback_admin boolean not null default false,
  add column if not exists atualizado_em timestamptz;

alter table public.notificacao_regras drop constraint if exists notificacao_regras_alvo_check;
alter table public.notificacao_regras add constraint notificacao_regras_alvo_check
  check (num_nonnulls(perfil_id, usuario_id, papel) = 1);

alter table public.notificacao_regras drop constraint if exists notificacao_regras_papel_check;
alter table public.notificacao_regras add constraint notificacao_regras_papel_check
  check (papel is null or papel in (
    'nomeados', 'vendedor_citado', 'sdr_do_lead', 'closer_da_reuniao', 'vendedor_da_venda',
    'originador_da_nota', 'dono_da_empresa', 'responsavel_da_conversa', 'dono_do_numero',
    'quem_pediu', 'dono_do_envio', 'advogado_do_processo'
  ));

alter table public.notificacao_regras drop constraint if exists notificacao_regras_canais_check;
alter table public.notificacao_regras add constraint notificacao_regras_canais_check
  check (cardinality(canais) > 0 and canais <@ array['sino', 'push', 'email']::text[]);

alter table public.notificacao_regras drop constraint if exists notificacao_regras_frequencia_check;
alter table public.notificacao_regras add constraint notificacao_regras_frequencia_check
  check (frequencia in ('imediato', 'resumo_diario'));

alter table public.notificacao_regras drop constraint if exists notificacao_regras_dedup_check;
alter table public.notificacao_regras add constraint notificacao_regras_dedup_check
  check (dedup_horas between 0 and 8760);

create unique index if not exists notificacao_regras_papel_uniq
  on public.notificacao_regras (tipo_evento, papel) where papel is not null;

-- ── 4. Horário de silêncio ───────────────────────────────────────────────────

create table if not exists public.notificacao_config (
  id               boolean primary key default true check (id),
  silencio_inicio  smallint not null default 20 check (silencio_inicio between 0 and 23),
  silencio_fim     smallint not null default 8 check (silencio_fim between 0 and 23),
  fuso             text not null default 'America/Sao_Paulo',
  atualizado_em    timestamptz not null default now()
);

insert into public.notificacao_config (id) values (true) on conflict (id) do nothing;

alter table public.notificacao_config enable row level security;
drop policy if exists notificacao_config_admin on public.notificacao_config;
create policy notificacao_config_admin on public.notificacao_config
  for all to authenticated using (public.app_is_admin()) with check (public.app_is_admin());

-- ── 5. As filas: envio (push/e-mail) e resumo diário ─────────────────────────

create table if not exists public.notificacoes_envios (
  id              uuid primary key default gen_random_uuid(),
  notificacao_id  uuid not null references public.notificacoes (id) on delete cascade,
  usuario_id      uuid not null references public.usuarios (id) on delete cascade,
  canal           text not null check (canal in ('push', 'email')),
  agendado_para   timestamptz not null default now(),
  status          text not null default 'pendente'
                  check (status in ('pendente', 'enviado', 'ignorado', 'falhou')),
  tentativas      smallint not null default 0,
  erro            text,
  criado_em       timestamptz not null default now(),
  enviado_em      timestamptz
);

create index if not exists notificacoes_envios_fila_idx
  on public.notificacoes_envios (agendado_para) where status = 'pendente';

create table if not exists public.notificacoes_resumo (
  id           uuid primary key default gen_random_uuid(),
  usuario_id   uuid not null references public.usuarios (id) on delete cascade,
  tipo         text not null,
  titulo       text not null,
  corpo        text,
  url          text,
  chave        text,
  canais       text[] not null default '{sino}',
  criado_em    timestamptz not null default now(),
  entregue_em  timestamptz
);

create index if not exists notificacoes_resumo_pendente_idx
  on public.notificacoes_resumo (usuario_id, criado_em) where entregue_em is null;
create index if not exists notificacoes_resumo_chave_idx
  on public.notificacoes_resumo (usuario_id, chave, criado_em desc) where chave is not null;

-- Só o service role lê e escreve as filas.
alter table public.notificacoes_envios enable row level security;
alter table public.notificacoes_resumo enable row level security;

-- ── 6. Histórico do painel ───────────────────────────────────────────────────

create table if not exists public.notificacao_historico (
  id          uuid primary key default gen_random_uuid(),
  tabela      text not null,
  registro    text not null,
  acao        text not null check (acao in ('criou', 'alterou', 'excluiu')),
  antes       jsonb,
  depois      jsonb,
  usuario_id  uuid references public.usuarios (id) on delete set null,
  criado_em   timestamptz not null default now()
);

create index if not exists notificacao_historico_idx on public.notificacao_historico (criado_em desc);

alter table public.notificacao_historico enable row level security;
drop policy if exists notificacao_historico_admin on public.notificacao_historico;
create policy notificacao_historico_admin on public.notificacao_historico
  for select to authenticated using (public.app_is_admin());

create or replace function public.notificacao__registrar_historico()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_antes jsonb;
  v_depois jsonb;
  v_linha jsonb;
begin
  -- Via jsonb, e não `new.tipo`/`new.id`: o gatilho serve três tabelas, e em
  -- PL/pgSQL citar um campo que a linha não tem falha mesmo no ramo não tomado.
  if tg_op in ('UPDATE', 'DELETE') then v_antes := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_depois := to_jsonb(new); end if;
  v_linha := coalesce(v_depois, v_antes);

  insert into public.notificacao_historico (tabela, registro, acao, antes, depois, usuario_id)
  values (
    tg_table_name,
    case tg_table_name
      when 'notificacao_tipos' then v_linha ->> 'tipo'
      when 'notificacao_config' then 'config'
      else v_linha ->> 'id'
    end,
    case tg_op when 'INSERT' then 'criou' when 'UPDATE' then 'alterou' else 'excluiu' end,
    v_antes,
    v_depois,
    auth.uid()
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

-- Só as mudanças feitas por PESSOAS: o worker grava `ultimo_payload` a cada aviso
-- direto, e isso não é uma alteração de configuração.
drop trigger if exists notificacao_tipos_historico on public.notificacao_tipos;
create trigger notificacao_tipos_historico
  after update on public.notificacao_tipos
  for each row
  when (auth.uid() is not null and (
    old.titulo_modelo is distinct from new.titulo_modelo
    or old.corpo_modelo is distinct from new.corpo_modelo
    or old.url_modelo is distinct from new.url_modelo
    or old.ativo is distinct from new.ativo
    or old.gravidade is distinct from new.gravidade
  ))
  execute function public.notificacao__registrar_historico();

drop trigger if exists notificacao_regras_historico on public.notificacao_regras;
create trigger notificacao_regras_historico
  after insert or update or delete on public.notificacao_regras
  for each row
  when (auth.uid() is not null)
  execute function public.notificacao__registrar_historico();

drop trigger if exists notificacao_config_historico on public.notificacao_config;
create trigger notificacao_config_historico
  after update on public.notificacao_config
  for each row
  when (auth.uid() is not null)
  execute function public.notificacao__registrar_historico();

-- ── 7. Peças do motor ────────────────────────────────────────────────────────

/*
 * Cast seguro: o payload vem de dezenas de emissores, e um id malformado num
 * `::uuid` direto derrubaria a transação de quem emitiu.
 */
create or replace function public.notificacao__uuid(p text)
returns uuid
language sql
immutable
as $$
  select case
    when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid
  end
$$;

/*
 * Os filtros do modelo: {{valor|moeda}}, {{total|inteiro}}, {{data|data}}.
 * pt-BR à mão — o lc_numeric do banco não é o do Brasil.
 */
create or replace function public.notificacao__formatar(p_valor text, p_filtro text)
returns text
language plpgsql
immutable
as $$
declare
  v_num numeric;
begin
  if p_valor is null then return ''; end if;
  if p_filtro is null or p_filtro = '' then return p_valor; end if;

  if p_filtro in ('moeda', 'inteiro') then
    begin
      v_num := p_valor::numeric;
    exception when others then
      return p_valor;
    end;
    if p_filtro = 'moeda' then
      return 'R$ ' || translate(to_char(round(v_num, 2), 'FM999,999,999,990.00'), ',.', '.,');
    end if;
    return translate(to_char(round(v_num), 'FM999,999,999,990'), ',', '.');
  end if;

  if p_filtro = 'data' then
    begin
      return to_char(p_valor::timestamptz at time zone 'America/Sao_Paulo', 'DD/MM/YYYY');
    exception when others then
      return p_valor;
    end;
  end if;

  return p_valor;
end $$;

/*
 * {{chave}} e {{chave|filtro}}. Variável ausente vira texto vazio — um modelo que
 * cita algo que o evento não tem não pode derrubar o envio; o painel é que avisa
 * na hora de salvar.
 */
create or replace function public.notificacao_renderizar(p_modelo text, p_vars jsonb)
returns text
language plpgsql
immutable
as $$
declare
  v_saida text := p_modelo;
  v_m text[];
  v_valor text;
begin
  if p_modelo is null or btrim(p_modelo) = '' then return null; end if;

  for v_m in
    select regexp_matches(p_modelo, '\{\{\s*([A-Za-z0-9_]+)\s*(?:\|\s*([a-z]+)\s*)?\}\}', 'g')
  loop
    v_valor := public.notificacao__formatar(p_vars ->> v_m[1], v_m[2]);
    v_saida := regexp_replace(
      v_saida,
      '\{\{\s*' || v_m[1] || '\s*' || coalesce('\|\s*' || v_m[2] || '\s*', '') || '\}\}',
      replace(v_valor, '\', '\\'),
      'g'
    );
  end loop;

  return v_saida;
end $$;

/*
 * QUEM É O PAPEL, a partir do dado do evento.
 *
 * Cada papel lê a chave do payload que o emissor já manda (lead_id, venda_id,
 * access_key, conversa_id…). Um papel que não acha o dado devolve ninguém — e é
 * aí que o `fallback_admin` da regra entra.
 */
create or replace function public.notificacao_resolver_papel(
  p_papel text,
  p_empresa_id uuid,
  p_payload jsonb
)
returns setof uuid
language sql
stable
security definer
set search_path to ''
as $$
  select distinct x.usuario_id from (
    -- Pessoas nomeadas pelo próprio emissor (quem pediu, o autor do report…).
    select public.notificacao__uuid(d.valor) as usuario_id
    from jsonb_array_elements_text(
      case when jsonb_typeof(p_payload -> 'destinatarios') = 'array'
           then p_payload -> 'destinatarios' else '[]'::jsonb end
    ) as d(valor)
    where p_papel = 'nomeados'

    union all
    select v.usuario_id from public.vendedores v
    where p_papel = 'vendedor_citado'
      and v.id = public.notificacao__uuid(coalesce(p_payload ->> 'vendedor_id', p_payload ->> 'originador_id'))

    union all
    select v.usuario_id
    from public.sdr_leads l join public.vendedores v on v.id = l.sdr_id
    where p_papel = 'sdr_do_lead'
      and l.id = public.notificacao__uuid(p_payload ->> 'lead_id')

    union all
    select v.usuario_id from public.vendedores v
    where p_papel = 'closer_da_reuniao'
      and v.id = coalesce(
        public.notificacao__uuid(p_payload ->> 'vendedor_destino_id'),
        (select a.vendedor_destino_id from public.sdr_aceites a
          where a.id = public.notificacao__uuid(p_payload ->> 'aceite_id')),
        (select l.vendedor_destino_id from public.sdr_leads l
          where l.id = public.notificacao__uuid(p_payload ->> 'lead_id'))
      )

    union all
    select v.usuario_id
    from public.vendas vd join public.vendedores v on v.id = vd.vendedor_id
    where p_papel = 'vendedor_da_venda'
      and vd.id = public.notificacao__uuid(p_payload ->> 'venda_id')

    union all
    -- O originador ROTEADO da nota ou da pré-autorização (`vendedor_id`, 0120) —
    -- não o titular do cedente, que é outra coisa (ver `dois papéis de carteira`).
    select v.usuario_id from public.vendedores v
    where p_papel = 'originador_da_nota'
      and v.id = coalesce(
        (select n.vendedor_id from public.notas_fiscais n where n.access_key = p_payload ->> 'access_key'),
        (select pa.vendedor_id from public.pre_autorizacoes pa
          where pa.id_externo::text = p_payload ->> 'pre_autorizacao_id')
      )

    union all
    -- O dono da conta: a carteira vigente, originação antes de SDR antes de gestão
    -- passiva — a mesma ordem de `donoDaEmpresa` no worker.
    select v.usuario_id from public.vendedores v
    where p_papel = 'dono_da_empresa'
      and v.id = (
        select vc.vendedor_id from public.vendedor_carteira vc
        where vc.empresa_id = coalesce(p_empresa_id, public.notificacao__uuid(p_payload ->> 'empresa_id'))
          and vc.ate is null
        order by case vc.papel when 'originacao' then 1 when 'sdr' then 2 when 'gestao_passiva' then 3 else 9 end
        limit 1
      )

    union all
    select v.usuario_id
    from public.conversas c join public.vendedores v on v.id = c.responsavel_vendedor_id
    where p_papel = 'responsavel_da_conversa'
      and c.id = public.notificacao__uuid(p_payload ->> 'conversa_id')

    union all
    -- Quem responde pelo número que recebeu; sem conta cadastrada, o vendedor que
    -- o resolvedor sugeriu.
    select coalesce(
      (select w.usuario_responsavel from public.whatsapp_contas w
        where w.numero = p_payload ->> 'conta_recebedora' limit 1),
      (select v.usuario_id from public.vendedores v
        where v.id = public.notificacao__uuid(p_payload ->> 'vendedor_id'))
    )
    where p_papel = 'dono_do_numero'

    union all
    select a.solicitada_por from public.analises_credito a
    where p_papel = 'quem_pediu'
      and a.id = public.notificacao__uuid(coalesce(p_payload ->> 'analise_id', p_payload ->> 'analise_credito_id'))

    union all
    select coalesce(o.criada_por, v.usuario_id)
    from public.mensagens_outbox o left join public.vendedores v on v.id = o.vendedor_id
    where p_papel = 'dono_do_envio'
      and o.id = public.notificacao__uuid(p_payload ->> 'outbox_id')

    union all
    select adv.usuario_id
    from public.processos pr join public.advogados adv on adv.id = pr.advogado_id
    where p_papel = 'advogado_do_processo'
      and pr.numero_cnj = p_payload ->> 'numero_cnj'
  ) x
  where x.usuario_id is not null
$$;

/* Quando entregar: agora, ou na saída do horário de silêncio. */
create or replace function public.notificacao__quando(p_respeita_silencio boolean, p_gravidade text)
returns timestamptz
language plpgsql
stable
set search_path to ''
as $$
declare
  v_cfg public.notificacao_config;
  v_local timestamp;
  v_hora int;
  v_saida timestamp;
begin
  if not p_respeita_silencio or p_gravidade = 'critica' then return now(); end if;

  select * into v_cfg from public.notificacao_config where id;
  if not found or v_cfg.silencio_inicio = v_cfg.silencio_fim then return now(); end if;

  v_local := now() at time zone v_cfg.fuso;
  v_hora := extract(hour from v_local);

  -- Janela que cruza a meia-noite (20h–8h) ou que não cruza (13h–14h).
  if v_cfg.silencio_inicio > v_cfg.silencio_fim then
    if v_hora >= v_cfg.silencio_inicio then
      v_saida := date_trunc('day', v_local) + interval '1 day' + make_interval(hours => v_cfg.silencio_fim);
    elsif v_hora < v_cfg.silencio_fim then
      v_saida := date_trunc('day', v_local) + make_interval(hours => v_cfg.silencio_fim);
    else
      return now();
    end if;
  else
    if v_hora >= v_cfg.silencio_inicio and v_hora < v_cfg.silencio_fim then
      v_saida := date_trunc('day', v_local) + make_interval(hours => v_cfg.silencio_fim);
    else
      return now();
    end if;
  end if;

  return v_saida at time zone v_cfg.fuso;
end $$;

/*
 * O NÚCLEO: entrega um evento segundo as regras. Chamado pelo trigger de
 * `empresa_eventos` e por `notificacao_emitir`. Devolve os ids do sino criados
 * AGORA — quem chamou de Node pode entregar o push em seguida, sem esperar a
 * varredura.
 */
create or replace function public.notificacao__entregar(
  p_tipo text,
  p_empresa_id uuid,
  p_payload jsonb,
  p_ator uuid
)
returns uuid[]
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_catalogo public.notificacao_tipos;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_vars jsonb;
  v_empresa_nome text;
  v_titulo text;
  v_corpo text;
  v_url text;
  v_chave text;
  v_gravidade text := 'normal';
  v_d record;
  v_id uuid;
  v_criados uuid[] := '{}';
  v_quando timestamptz;
  v_canal text;
begin
  -- Tipo sem regra ativa: nada a fazer, e é o caso da maioria dos eventos.
  if not exists (
    select 1 from public.notificacao_regras r where r.ativo and r.tipo_evento = p_tipo
  ) then
    return v_criados;
  end if;

  select * into v_catalogo from public.notificacao_tipos t where t.tipo = p_tipo;
  if found then
    if not v_catalogo.ativo then return v_criados; end if;
    v_gravidade := v_catalogo.gravidade;
  end if;

  if p_empresa_id is not null then
    select coalesce(e.nome_fantasia, e.razao_social, e.cnpj) into v_empresa_nome
    from public.empresas e where e.id = p_empresa_id;
  end if;

  v_vars := v_payload || jsonb_build_object('empresa', coalesce(v_empresa_nome, ''));

  v_titulo := coalesce(
    public.notificacao_renderizar(v_catalogo.titulo_modelo, v_vars),
    nullif(v_payload ->> 'titulo', ''),
    coalesce(v_empresa_nome, 'Empresa') || ' — ' || coalesce(v_catalogo.nome, p_tipo)
  );
  v_corpo := coalesce(
    public.notificacao_renderizar(v_catalogo.corpo_modelo, v_vars),
    nullif(v_payload ->> 'resumo', ''),
    nullif(v_payload ->> 'corpo', '')
  );
  v_url := coalesce(
    public.notificacao_renderizar(v_catalogo.url_modelo, v_vars),
    nullif(v_payload ->> 'url', ''),
    case when p_empresa_id is not null then '/empresas/' || p_empresa_id::text end
  );
  -- Sem chave explícita, a repetição é por tipo + empresa: "o mesmo aviso sobre a
  -- mesma conta" é o que uma janela de repetição quer dizer quase sempre.
  v_chave := coalesce(nullif(v_payload ->> 'chave', ''), p_tipo || ':' || coalesce(p_empresa_id::text, ''));

  for v_d in
    with regras as (
      select r.* from public.notificacao_regras r where r.ativo and r.tipo_evento = p_tipo
    ),
    alvo as (
      select rg.id as regra_id, u.id as usuario_id
      from regras rg join public.usuarios u on u.perfil_id = rg.perfil_id and u.ativo
      where rg.perfil_id is not null
      union all
      select rg.id, u.id
      from regras rg join public.usuarios u on u.id = rg.usuario_id and u.ativo
      where rg.usuario_id is not null
      union all
      select rg.id, u.id
      from regras rg
      cross join lateral public.notificacao_resolver_papel(rg.papel, p_empresa_id, v_payload) as pp(usuario_id)
      join public.usuarios u on u.id = pp.usuario_id and u.ativo
      where rg.papel is not null
    ),
    -- Quem causou o evento não é avisado dele — exceto quando o emissor pede
    -- (o teste de notificação, o "enviar teste para mim" do painel).
    alvo_sem_ator as (
      select a.* from alvo a
      where p_ator is null or a.usuario_id <> p_ator or (v_payload ->> 'incluir_ator') = 'true'
    ),
    -- "Se ninguém, cai para o Admin": a regra que não alcançou ninguém entrega aos
    -- admins, com o mesmo canal e o mesmo ritmo.
    com_fallback as (
      select * from alvo_sem_ator
      union all
      select rg.id, u.id
      from regras rg
      join public.perfis pf on pf.nome = 'Admin'
      join public.usuarios u on u.perfil_id = pf.id and u.ativo
      where rg.fallback_admin
        and not exists (select 1 from alvo_sem_ator a where a.regra_id = rg.id)
        and (p_ator is null or u.id <> p_ator)
    )
    -- Um aviso por pessoa: canais somados, e "na hora" vence "resumo". O `unnest`
    -- antes de agregar porque `array_agg` de arrays de tamanhos diferentes falha.
    select
      cf.usuario_id,
      array_agg(distinct c.canal) as canais_brutos,
      bool_or(rg.frequencia = 'imediato') as imediato,
      bool_and(rg.respeita_silencio) as respeita_silencio,
      max(rg.dedup_horas) as dedup_horas
    from com_fallback cf
    join regras rg on rg.id = cf.regra_id
    cross join lateral unnest(rg.canais) as c(canal)
    group by cf.usuario_id
  loop
    -- Repetição: o mesmo aviso para a mesma pessoa dentro da janela da regra.
    if v_d.dedup_horas > 0 and (
      exists (
        select 1 from public.notificacoes n
        where n.usuario_id = v_d.usuario_id and n.chave = v_chave
          and n.criado_em > now() - make_interval(hours => v_d.dedup_horas)
      )
      or exists (
        select 1 from public.notificacoes_resumo nr
        where nr.usuario_id = v_d.usuario_id and nr.chave = v_chave
          and nr.criado_em > now() - make_interval(hours => v_d.dedup_horas)
      )
    ) then
      continue;
    end if;

    if not v_d.imediato then
      insert into public.notificacoes_resumo (usuario_id, tipo, titulo, corpo, url, chave, canais)
      values (v_d.usuario_id, p_tipo, v_titulo, v_corpo, v_url, v_chave, v_d.canais_brutos);
      continue;
    end if;

    insert into public.notificacoes (usuario_id, titulo, corpo, url, tipo, chave)
    values (v_d.usuario_id, v_titulo, v_corpo, v_url, p_tipo, v_chave)
    returning id into v_id;
    v_criados := v_criados || v_id;

    v_quando := public.notificacao__quando(v_d.respeita_silencio, v_gravidade);
    foreach v_canal in array v_d.canais_brutos loop
      if v_canal in ('push', 'email') then
        insert into public.notificacoes_envios (notificacao_id, usuario_id, canal, agendado_para)
        values (v_id, v_d.usuario_id, v_canal, v_quando);
      end if;
    end loop;
  end loop;

  return v_criados;
exception when others then
  -- O aviso nunca desfaz o fato que o gerou.
  raise warning 'notificacao__entregar(%) falhou: %', p_tipo, sqlerrm;
  return '{}';
end $$;

/*
 * O caminho direto, para Node (service role). Registra o tipo no catálogo se for
 * novo, guarda o último payload para a prévia do painel, e entrega.
 */
create or replace function public.notificacao_emitir(
  p_tipo text,
  p_empresa_id uuid default null,
  p_payload jsonb default '{}'::jsonb,
  p_ator uuid default null
)
returns uuid[]
language plpgsql
security definer
set search_path to ''
as $$
begin
  insert into public.notificacao_tipos (tipo, nome, ultimo_payload, ultimo_em)
  values (p_tipo, p_tipo, p_payload, now())
  on conflict (tipo) do update set ultimo_payload = excluded.ultimo_payload, ultimo_em = excluded.ultimo_em;

  return public.notificacao__entregar(p_tipo, p_empresa_id, p_payload, p_ator);
end $$;

revoke all on function public.notificacao_emitir(text, uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.notificacao_emitir(text, uuid, jsonb, uuid) to service_role;
revoke all on function public.notificacao__entregar(text, uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.notificacao_resolver_papel(text, uuid, jsonb) from public, anon, authenticated;

-- ── 8. O trigger de empresa_eventos passa pelo motor ─────────────────────────

create or replace function public.fanout_evento_para_notificacoes()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_tipo text := new.tipo;
begin
  /*
   * A decisão do aceite reusa o tipo do pedido (`app_decidir_aceite_sdr` grava
   * `sdr.aceite_pendente` com `decisao` no payload). São dois avisos para duas
   * pessoas — o pedido é do closer, a decisão é do SDR — e é aqui que se separam.
   */
  if v_tipo = 'sdr.aceite_pendente' and new.payload ? 'decisao' then
    v_tipo := 'sdr.aceite_decidido';
  end if;

  perform public.notificacao__entregar(v_tipo, new.empresa_id, new.payload, new.ator_usuario_id);
  return new;
end $$;

-- ── 9. Painel: prévia, teste e números ───────────────────────────────────────

/* O payload de exemplo de um tipo: o último evento de empresa, ou o último direto. */
create or replace function public.notificacao__exemplo(p_tipo text)
returns table (empresa_id uuid, payload jsonb)
language sql
stable
security definer
set search_path to ''
as $$
  select x.empresa_id, x.payload from (
    (
      select 1 as prioridade, e.empresa_id, e.payload from public.empresa_eventos e
      where e.tipo = case when p_tipo = 'sdr.aceite_decidido' then 'sdr.aceite_pendente' else p_tipo end
        and (p_tipo <> 'sdr.aceite_decidido' or e.payload ? 'decisao')
        and (p_tipo <> 'sdr.aceite_pendente' or not e.payload ? 'decisao')
      order by e.criado_em desc limit 1
    )
    union all
    select 2, null::uuid, t.ultimo_payload from public.notificacao_tipos t
    where t.tipo = p_tipo and t.ultimo_payload is not null
  ) x
  order by x.prioridade
  limit 1
$$;

create or replace function public.app_notificacao_previa(
  p_tipo text,
  p_titulo text default null,
  p_corpo text default null,
  p_url text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_ex record;
  v_vars jsonb;
  v_empresa_nome text;
  v_nome text;
begin
  if not public.app_is_admin() then
    raise exception 'Só admin configura avisos.' using errcode = '42501';
  end if;

  select * into v_ex from public.notificacao__exemplo(p_tipo);
  select coalesce(e.nome_fantasia, e.razao_social, e.cnpj) into v_empresa_nome
  from public.empresas e where e.id = v_ex.empresa_id;
  select t.nome into v_nome from public.notificacao_tipos t where t.tipo = p_tipo;

  v_vars := coalesce(v_ex.payload, '{}'::jsonb) || jsonb_build_object('empresa', coalesce(v_empresa_nome, ''));

  return jsonb_build_object(
    'tem_exemplo', v_ex.payload is not null,
    'variaveis', coalesce((
      select jsonb_agg(jsonb_build_object('nome', k.key, 'exemplo', left(k.value #>> '{}', 120)) order by k.key)
      from jsonb_each(v_vars) k
      where jsonb_typeof(k.value) in ('string', 'number', 'boolean')
    ), '[]'::jsonb),
    'titulo', coalesce(
      public.notificacao_renderizar(p_titulo, v_vars),
      nullif(v_vars ->> 'titulo', ''),
      coalesce(nullif(v_empresa_nome, ''), 'Empresa') || ' — ' || coalesce(v_nome, p_tipo)
    ),
    'corpo', coalesce(
      public.notificacao_renderizar(p_corpo, v_vars),
      nullif(v_vars ->> 'resumo', ''),
      nullif(v_vars ->> 'corpo', '')
    ),
    'url', coalesce(public.notificacao_renderizar(p_url, v_vars), nullif(v_vars ->> 'url', ''))
  );
end $$;

/*
 * "Enviar teste para mim": o aviso com o texto ATUAL do tipo e o último exemplo,
 * só para quem clicou, sem regra nem silêncio. Devolve o id do sino — a web
 * entrega o push em seguida.
 */
create or replace function public.app_notificacao_testar(p_tipo text)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_previa jsonb;
  v_catalogo public.notificacao_tipos;
  v_id uuid;
begin
  if not public.app_is_admin() then
    raise exception 'Só admin configura avisos.' using errcode = '42501';
  end if;

  select * into v_catalogo from public.notificacao_tipos t where t.tipo = p_tipo;
  v_previa := public.app_notificacao_previa(
    p_tipo, v_catalogo.titulo_modelo, v_catalogo.corpo_modelo, v_catalogo.url_modelo
  );

  insert into public.notificacoes (usuario_id, titulo, corpo, url, tipo, chave)
  values (
    auth.uid(),
    '[Teste] ' || coalesce(v_previa ->> 'titulo', p_tipo),
    v_previa ->> 'corpo',
    v_previa ->> 'url',
    p_tipo,
    null
  )
  returning id into v_id;

  insert into public.notificacoes_envios (notificacao_id, usuario_id, canal)
  values (v_id, auth.uid(), 'push');

  return v_id;
end $$;

/* Volume e leitura dos últimos 30 dias, por tipo — o que torna o ruído visível. */
create or replace function public.app_notificacao_numeros()
returns table (tipo text, enviados bigint, lidos bigint, pessoas bigint, resumidos bigint, ultimo_em timestamptz)
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if not public.app_is_admin() then
    raise exception 'Só admin configura avisos.' using errcode = '42501';
  end if;

  return query
  select
    coalesce(s.tipo, r.tipo),
    coalesce(s.enviados, 0),
    coalesce(s.lidos, 0),
    coalesce(s.pessoas, 0),
    coalesce(r.resumidos, 0),
    s.ultimo_em
  from (
    select n.tipo, count(*) as enviados, count(*) filter (where n.lida) as lidos,
           count(distinct n.usuario_id) as pessoas, max(n.criado_em) as ultimo_em
    from public.notificacoes n
    where n.tipo is not null and n.criado_em > now() - interval '30 days'
    group by n.tipo
  ) s
  full join (
    select nr.tipo, count(*) as resumidos
    from public.notificacoes_resumo nr
    where nr.criado_em > now() - interval '30 days'
    group by nr.tipo
  ) r on r.tipo = s.tipo;
end $$;

grant execute on function public.app_notificacao_previa(text, text, text, text) to authenticated;
grant execute on function public.app_notificacao_testar(text) to authenticated;
grant execute on function public.app_notificacao_numeros() to authenticated;

-- ── 10. O catálogo de partida ────────────────────────────────────────────────
-- Todos os tipos que o core declara, os que só o banco emite, e os que eram
-- escritos direto no código. Nome do rótulo do core; módulo pelo prefixo.

insert into public.notificacao_tipos (tipo, modulo, nome, descricao, gravidade) values
  ('agente.decidiu', 'comunicacao', 'Agente sugeriu um próximo passo', null, 'normal'),
  ('agente.escalou', 'comunicacao', 'Agente escalou para humano', null, 'normal'),
  ('agente.executou', 'comunicacao', 'Agente executou o próximo passo', null, 'normal'),
  ('agente.sugestao', 'comunicacao', 'Próximo passo sugerido', 'O agente sugeriu uma resposta numa conversa.', 'normal'),
  ('analise.aprovada', 'credito', 'Análise de crédito aprovada', null, 'normal'),
  ('analise.aprovada_parcial', 'credito', 'Análise aprovada parcialmente', null, 'normal'),
  ('analise.enviada', 'credito', 'Análise enviada à seguradora', null, 'normal'),
  ('analise.envio_falhou', 'credito', 'Falha ao enviar à seguradora', null, 'normal'),
  ('analise.expirada', 'credito', 'Análise de crédito expirada', null, 'normal'),
  ('analise.limite_alterado', 'credito', 'Limite alterado', null, 'normal'),
  ('analise.limite_reduzido', 'credito', 'Limite reduzido pela seguradora', null, 'normal'),
  ('analise.movida', 'credito', 'Análise de crédito movida', null, 'normal'),
  ('analise.negada', 'credito', 'Análise de crédito negada', null, 'normal'),
  ('analise.pedido_vinculado', 'credito', 'Pedido da seguradora vinculado ao card', null, 'normal'),
  ('analise.sem_cadastro', 'credito', 'Análise aprovada sem cadastro', null, 'normal'),
  ('analise.solicitada', 'credito', 'Análise de crédito solicitada', null, 'normal'),
  ('analise.vinculo_ambiguo', 'credito', 'Cobertura da seguradora sem vínculo certo', null, 'normal'),
  ('analise_plataforma.status_alterado', 'credito', 'Análise da plataforma mudou de status', null, 'normal'),
  ('analise_propria.aguardando_revisao', 'credito', 'Extração aguardando revisão', null, 'normal'),
  ('analise_propria.concluida', 'credito', 'Análise proprietária concluída', null, 'normal'),
  ('analise_propria.divergencia_seguradora', 'credito', 'Divergência com a seguradora', null, 'normal'),
  ('analise_propria.falhou', 'credito', 'Análise proprietária falhou', null, 'normal'),
  ('analise_propria.iniciada', 'credito', 'Análise proprietária iniciada', null, 'normal'),
  ('antecipacao.casada', 'antecipacao', 'Antecipação casada com a nota', null, 'normal'),
  ('antecipacao.regrediu', 'antecipacao', 'Antecipação regrediu — conversão em disputa', null, 'normal'),
  ('antecipacao.sem_nf', 'antecipacao', 'Antecipação sem nota correspondente', null, 'normal'),
  ('antecipacao.sincronizada', 'antecipacao', 'Antecipação sincronizada', null, 'normal'),
  ('antecipacao.status_alterado', 'antecipacao', 'Status da antecipação alterado', null, 'normal'),
  ('apresentacao.solicitada', 'antecipacao', 'Apresentação pedida', null, 'normal'),
  ('beta.alterado', 'plataforma', 'Alterado', null, 'normal'),
  ('calculo.gerado', 'juridico', 'Cálculo da dívida gerado', null, 'normal'),
  ('camada.alterada', 'mercado', 'Camada alterada', null, 'normal'),
  ('campanha.alerta_saude', 'comercial', 'Alerta saude', null, 'normal'),
  ('campanha.aprovada', 'comercial', 'Aprovada', null, 'normal'),
  ('campanha.concluida', 'comercial', 'Concluida', null, 'normal'),
  ('campanha.destinatario_respondeu', 'comercial', 'Destinatario respondeu', null, 'normal'),
  ('campanha.iniciada', 'comercial', 'Iniciada', null, 'normal'),
  ('campanha.pausada', 'comercial', 'Pausada', null, 'normal'),
  ('certificado.renovado', 'empresas', 'Certificado digital renovado', null, 'normal'),
  ('certificado.vencendo', 'empresas', 'Certificado digital vencendo', null, 'normal'),
  ('certificado.vencido', 'empresas', 'Certificado digital vencido', null, 'normal'),
  ('cliente.dormente', 'comercial', 'Cliente dormente', null, 'normal'),
  ('cliente.gestao_alterada', 'comercial', 'Gestão da conta alterada', null, 'normal'),
  ('cliente.limite_quase_esgotado', 'comercial', 'Limite quase esgotado', null, 'normal'),
  ('cliente.novo_detectado', 'comercial', 'Novo cliente detectado', null, 'normal'),
  ('cliente.reativado', 'comercial', 'Cliente reativado', null, 'normal'),
  ('cliente.status_operacional_alterado', 'comercial', 'Status operacional alterado', null, 'normal'),
  ('cliente.tornou_ex', 'comercial', 'Virou ex-cliente', null, 'normal'),
  ('cnpj.lookup_nao_encontrado', 'empresas', 'CNPJ não encontrado no lookup cadastral', null, 'normal'),
  ('comercial.bom_dia', 'comercial', 'Bom dia (resumo do Meu Dia)', 'Resumo da manhã, nos dias úteis, com os itens do Meu Dia de cada vendedor.', 'normal'),
  ('comissao.aprovada', 'comercial', 'Comissão aprovada', null, 'normal'),
  ('comissao.apurada', 'comercial', 'Comissão apurada', null, 'normal'),
  ('comissao.apurada_vendedor', 'comercial', 'Sua comissão foi apurada', 'O total apurado de cada vendedor na competência.', 'normal'),
  ('comissao.estornada', 'comercial', 'Comissão estornada', null, 'normal'),
  ('comissao.estornada_vendedor', 'comercial', 'Sua comissão foi estornada', 'Estorno de uma cessão revertida, para cada vendedor atingido.', 'normal'),
  ('comissao.fechada_vendedor', 'comercial', 'Sua competência foi fechada', 'O total de cada vendedor quando a competência fecha.', 'normal'),
  ('comissao.lancada', 'comercial', 'Comissão lançada', null, 'normal'),
  ('competencia.aprovada', 'comercial', 'Competência aprovada', null, 'normal'),
  ('competencia.fechada', 'comercial', 'Competência fechada', null, 'normal'),
  ('comunicacao.enviada', 'comunicacao', 'Mensagem enviada', null, 'normal'),
  ('comunicacao.falhou', 'comunicacao', 'Falha ao enviar mensagem', null, 'normal'),
  ('comunicacao.recebida', 'comunicacao', 'Mensagem recebida', null, 'normal'),
  ('condicoes.publicadas', 'credito', 'Publicadas', null, 'normal'),
  ('conta.fase_ajustada', 'comercial', 'Fase ajustada', null, 'normal'),
  ('conta.revisao_sugerida', 'comercial', 'Revisão de classificação sugerida', null, 'normal'),
  ('contato.indicado', 'empresas', 'Outro contato foi indicado', null, 'normal'),
  ('contato.ponto_focal_definido', 'empresas', 'Ponto focal definido', null, 'normal'),
  ('contatos.enriquecidos', 'radar', 'Contatos enriquecidos', null, 'normal'),
  ('conversa.nao_vinculada', 'comunicacao', 'Conversa aguardando identificação', null, 'normal'),
  ('conversa.vinculada', 'comunicacao', 'Conversa identificada', null, 'normal'),
  ('credito.analise_solicitada', 'credito', 'Analise solicitada', null, 'normal'),
  ('credito.decisao_registrada', 'credito', 'Decisão de crédito registrada', null, 'normal'),
  ('credito.potencial_atualizado', 'credito', 'Potencial de crédito atualizado', null, 'normal'),
  ('dominio.resolvido', 'radar', 'Domínio resolvido', null, 'normal'),
  ('empresa.criada', 'empresas', 'Empresa criada', null, 'normal'),
  ('empresa.promovida', 'empresas', 'Promovida do universo', null, 'normal'),
  ('estagio.alterado', 'empresas', 'Estágio alterado', null, 'normal'),
  ('estimador.recalibrado', 'mercado', 'Estimador recalibrado', null, 'normal'),
  ('excliente.conflito_dados', 'comercial', 'Ex-cliente com dado conflitante', null, 'normal'),
  ('excliente.motivo_definido', 'comercial', 'Motivo de saída definido', null, 'normal'),
  ('faturamento.reestimado', 'mercado', 'Faturamento reestimado', null, 'normal'),
  ('fornecedor.cadastrado', 'antecipacao', 'Fornecedor cadastrado na plataforma', null, 'normal'),
  ('fornecedor.contatos_encontrados', 'antecipacao', 'Contatos do fornecedor encontrados', null, 'normal'),
  ('fornecedor.entrou_funil', 'antecipacao', 'Fornecedor entrou no funil de cadastro', null, 'normal'),
  ('fornecedor.sem_contato', 'antecipacao', 'Fornecedor sem contato encontrado', null, 'normal'),
  ('fornecedor.sem_interesse', 'antecipacao', 'Fornecedor sem interesse', null, 'normal'),
  ('fornecedor.tipagem_alterada', 'antecipacao', 'Tipagem do fornecedor alterada', null, 'normal'),
  ('funcionarios.atualizado', 'mercado', 'Funcionários atualizados', null, 'normal'),
  ('funil.item_ocultado', 'antecipacao', 'Item ocultado do funil por duplicidade', null, 'normal'),
  ('grupo.protesto_agravado', 'mercado', 'Protesto do grupo agravado', null, 'normal'),
  ('importacao.concluida', 'mercado', 'Importação concluída', null, 'normal'),
  ('importacao.revisao_pendente', 'mercado', 'Importação aguardando revisão', null, 'normal'),
  ('lead.inbound_recebido', 'comercial', 'Inbound recebido', null, 'normal'),
  ('lote.aguardando_aprovacao', 'radar', 'Lote aguardando aprovação', null, 'normal'),
  ('lote.concluido', 'radar', 'Lote concluído', null, 'normal'),
  ('mercado.ingestao_concluida', 'mercado', 'Ingestão concluída', null, 'normal'),
  ('mercado.ingestao_falhou', 'mercado', 'Ingestão falhou', null, 'critica'),
  ('metrica.declarada', 'mercado', 'Métrica declarada pelo cliente', null, 'normal'),
  ('metrica.importada', 'mercado', 'Métrica de lista importada', null, 'normal'),
  ('meu_dia.item_adiado', 'comercial', 'Item adiado', null, 'normal'),
  ('meu_dia.item_irrelevante', 'comercial', 'Item irrelevante', null, 'normal'),
  ('nf.cancelada', 'antecipacao', 'Nota cancelada no emissor', null, 'normal'),
  ('nf.convertida', 'antecipacao', 'Nota convertida', null, 'normal'),
  ('nf.estagio_alterado', 'antecipacao', 'Estágio da nota alterado', null, 'normal'),
  ('nf.expirada', 'antecipacao', 'Nota expirada', null, 'normal'),
  ('nf.faixa_alta', 'antecipacao', 'Notas novas em faixa alta', 'Notas que acabaram de entrar em faixa alta, agrupadas por originador.', 'normal'),
  ('nf.faixa_alterada', 'antecipacao', 'Faixa da nota alterada', null, 'normal'),
  ('nf.perdida', 'antecipacao', 'Nota perdida', null, 'normal'),
  ('nf.sem_originador', 'comercial', 'NFs sem originador', 'Notas vivas que nenhuma carteira de originador cobre.', 'normal'),
  ('nf.sincronizada', 'antecipacao', 'Nota fiscal sincronizada', null, 'normal'),
  ('nota.criada', 'empresas', 'Nota adicionada', null, 'normal'),
  ('optout.registrado', 'comunicacao', 'Pedido de descadastro registrado', null, 'normal'),
  ('orcamento.alerta', 'radar', 'Orçamento em alerta', null, 'normal'),
  ('orcamento.estourado', 'radar', 'Orçamento estourado', null, 'critica'),
  ('orcamento_descoberta.alerta', 'comercial', 'Orçamento de descoberta em alerta', null, 'normal'),
  ('outbox.mensagem_gerada', 'antecipacao', 'Mensagem gerada na outbox', null, 'normal'),
  ('parecer.gerado', 'juridico', 'Parecer jurídico gerado', null, 'normal'),
  ('perfil.recalculado', 'mercado', 'Perfil dos Clientes recalculado', null, 'normal'),
  ('perfil.sugestao_aceita', 'mercado', 'Sugestão do perfil aceita', null, 'normal'),
  ('perfil.sugestao_descartada', 'mercado', 'Sugestão do perfil descartada', null, 'normal'),
  ('plataforma.teste', 'plataforma', 'Notificação de teste', 'Enviada pelo botão de teste nas configurações.', 'normal'),
  ('preauth.expirada', 'antecipacao', 'Pré-autorização expirada', null, 'normal'),
  ('preauth.expirando', 'antecipacao', 'Pré-autorização expirando', null, 'normal'),
  ('preauth.sincronizada', 'antecipacao', 'Pré-autorização sincronizada', null, 'normal'),
  ('preauth.status_alterado', 'antecipacao', 'Status da pré-autorização alterado', null, 'normal'),
  ('processo.encerrado', 'juridico', 'Processo encerrado', null, 'normal'),
  ('processo.fase_alterada', 'juridico', 'Processo mudou de fase', null, 'normal'),
  ('processo.fase_lenta', 'juridico', 'Fase do processo estourou o prazo esperado', null, 'normal'),
  ('processo.importado', 'juridico', 'Processo judicial importado', null, 'normal'),
  ('processo.movimentacao_relevante', 'juridico', 'Movimentação relevante no processo', null, 'normal'),
  ('processo.novo_detectado', 'juridico', 'Novo processo detectado contra nós', null, 'normal'),
  ('processo.prazo_proximo', 'juridico', 'Prazo processual se aproximando', 'Prazo de um processo vence em 1 ou 3 dias. Vai para o advogado do processo.', 'normal'),
  ('processo.sem_movimentacao', 'juridico', 'Processo parado', null, 'normal'),
  ('protesto.agravado', 'radar', 'Protesto agravado', null, 'normal'),
  ('protesto.detectado', 'radar', 'Protesto detectado', null, 'normal'),
  ('protestos.custo_mensal', 'radar', 'Custo mensal de protestos', 'Estimativa do custo da consulta mensal de protestos.', 'normal'),
  ('reanalise.sugerida', 'credito', 'Reanálise sugerida', null, 'normal'),
  ('recuperacao.registrada', 'juridico', 'Recuperação registrada', null, 'normal'),
  ('report.comentado', 'plataforma', 'Comentário em report', 'Novo comentário num report de bug ou melhoria.', 'normal'),
  ('report.criado', 'plataforma', 'Criado', null, 'normal'),
  ('report.enviado', 'plataforma', 'Enviado', null, 'normal'),
  ('report.falhou', 'plataforma', 'Falhou', null, 'normal'),
  ('report.gerado', 'plataforma', 'Gerado', null, 'normal'),
  ('report.status_alterado', 'plataforma', 'Status do seu report mudou', 'O report de bug ou melhoria mudou de status.', 'normal'),
  ('sacado.credito_alterado', 'antecipacao', 'Crédito do sacado alterado', null, 'normal'),
  ('sacado.limite_insuficiente', 'antecipacao', 'Limite do sacado insuficiente', null, 'normal'),
  ('sacado.vinculado', 'antecipacao', 'Sacado vinculado à conta', null, 'normal'),
  ('sacado_prospeccao.aprovado', 'antecipacao', 'Sacado descoberto por fluxo foi aprovado', null, 'normal'),
  ('sacado_prospeccao.decidido', 'antecipacao', 'Sacado aprovado ou recusado', 'A esteira decidiu a análise de um sacado de prospecção.', 'normal'),
  ('sacado_prospeccao.enriquecido', 'antecipacao', 'Sacado por NF enriquecido', null, 'normal'),
  ('sacado_prospeccao.estagio_alterado', 'antecipacao', 'Sacado por NF mudou de estágio', null, 'normal'),
  ('sacado_prospeccao.identificado', 'antecipacao', 'Sacado identificado por fluxo de notas', null, 'normal'),
  ('sacado_prospeccao.novo_relevante', 'antecipacao', 'Novo sacado para você', 'Card novo em Sacados por NF acima do valor mínimo configurado.', 'normal'),
  ('sacado_prospeccao.recusado', 'antecipacao', 'Sacado descoberto por fluxo foi recusado', null, 'normal'),
  ('score.recalculado', 'radar', 'Score de crédito recalculado', null, 'normal'),
  ('sdr.aceite_decidido', 'comercial', 'Decisão do aceite da reunião', 'O closer aceitou ou recusou a reunião do SDR.', 'normal'),
  ('sdr.aceite_pendente', 'comercial', 'Reunião aguardando aceite', null, 'normal'),
  ('sdr.lead_distribuido', 'comercial', 'Lead distribuído', null, 'normal'),
  ('sdr.lead_expirado', 'comercial', 'Lead expirado e devolvido ao pool', null, 'normal'),
  ('sdr.no_show', 'comercial', 'No-show na reunião', null, 'normal'),
  ('sdr.reuniao_agendada', 'comercial', 'Reunião agendada', null, 'normal'),
  ('sdr.sem_fit', 'comercial', 'Lead sem fit', null, 'normal'),
  ('titularidade.atribuida', 'comercial', 'Titularidade atribuída', null, 'normal'),
  ('titularidade.liberada', 'comercial', 'Titularidade liberada', null, 'normal'),
  ('titulo.nao_elegivel_recuperavel', 'antecipacao', 'Título não elegível, mas recuperável', null, 'normal'),
  ('titulo.pago_no_erp', 'antecipacao', 'Título pago no ERP sem antecipar', null, 'normal'),
  ('titulo.sincronizado', 'antecipacao', 'Título Sienge sincronizado', null, 'normal'),
  ('titulo.situacao_alterada', 'antecipacao', 'Situação do título alterada', null, 'normal'),
  ('toque.manual', 'antecipacao', 'Toque manual', null, 'normal'),
  ('venda.credito_decidido', 'comercial', 'Crédito decidido na sua venda', 'A análise de crédito de uma venda foi decidida.', 'normal'),
  ('venda.estagio_alterado', 'comercial', 'Venda mudou de estágio', null, 'normal'),
  ('venda.ganha', 'comercial', 'Venda ganha', null, 'normal'),
  ('venda.perdida', 'comercial', 'Venda perdida', null, 'normal'),
  ('vendedor.sem_atividade', 'comercial', 'Vendedor sem atividade', null, 'normal'),
  ('webhook.nao_entregue', 'plataforma', 'Webhook não entregue', 'Uma integração esgotou as tentativas de entrega.', 'normal')
on conflict (tipo) do nothing;

-- O resumo diário tem tipo próprio: é o aviso que o job das 8h grava, e aparece
-- no painel com volume como qualquer outro. Não tem regra — quem decide o que
-- entra nele são as regras de cada tipo com frequência "resumo diário".
insert into public.notificacao_tipos (tipo, modulo, nome, descricao)
values ('plataforma.resumo_diario', 'plataforma', 'Resumo diário de avisos',
        'Um aviso por pessoa, às 8h, com o que as regras mandaram para o resumo.')
on conflict (tipo) do nothing;

-- Modelos de partida. Só onde o texto do evento não serve a quem recebe: o evento
-- de mensagem recebida fala para a timeline da empresa ("Mensagem recebida por
-- WhatsApp"); para o dono da conversa, o que importa é quem respondeu.
update public.notificacao_tipos
   set titulo_modelo = '{{de}} respondeu', corpo_modelo = '{{resumo}}'
 where tipo = 'comunicacao.recebida' and titulo_modelo is null;

-- Os eventos de aceite nascem em SQL sem título (a timeline os rotula pelo tipo);
-- no sino, o título diz o que a pessoa precisa fazer.
update public.notificacao_tipos
   set titulo_modelo = 'Reunião esperando seu aceite: {{empresa}}', corpo_modelo = '{{resumo}}'
 where tipo = 'sdr.aceite_pendente' and titulo_modelo is null;
update public.notificacao_tipos
   set titulo_modelo = 'Reunião {{decisao}} pelo closer: {{empresa}}', corpo_modelo = '{{resumo}}'
 where tipo = 'sdr.aceite_decidido' and titulo_modelo is null;

-- ── 11. As regras de partida ─────────────────────────────────────────────────
-- (b) Parar: sucesso de rotina não é aviso, e o que é do dono sai do perfil.
update public.notificacao_regras
   set ativo = false, atualizado_em = now()
 where perfil_id is not null
   and tipo_evento in (
     'mercado.ingestao_concluida',   -- 1.604 avisos de sucesso; a falha tem aviso próprio
     'lote.concluido',               -- 695; lote disparado pelo sistema não é notícia
     'nf.convertida',                -- vai ao originador da nota (resumo); a gestão vê no Report Semanal
     'conversa.nao_vinculada',       -- vai ao dono do número que recebeu
     'cliente.tornou_ex',            -- vai ao dono da conta, em resumo
     'sacado.limite_insuficiente',   -- 61% do sino; vira resumo para o dono da conta
     'agente.escalou'                -- vai ao responsável da conversa, com push
   );

-- (b) Resumo diário: o que a gestão acompanha, mas não precisa ver um a um.
update public.notificacao_regras
   set frequencia = 'resumo_diario', atualizado_em = now()
 where perfil_id is not null
   and tipo_evento in (
     'sdr.lead_distribuido', 'sdr.aceite_pendente', 'sdr.lead_expirado', 'sdr.reuniao_agendada',
     'cliente.gestao_alterada', 'cliente.dormente', 'comunicacao.falhou',
     'reanalise.sugerida', 'sacado.credito_alterado'
   );

-- Crédito e Jurídico estão vazios: o que é deles cai para o Admin até haver alguém.
update public.notificacao_regras
   set fallback_admin = true, atualizado_em = now()
 where perfil_id in (select id from public.perfis where nome in ('Crédito', 'Jurídico'));

-- Os que já tinham push pelo código passam a tê-lo pela regra (e o código para).
update public.notificacao_regras
   set canais = '{sino,push}', atualizado_em = now()
 where perfil_id is not null
   and tipo_evento in (
     'analise.solicitada', 'credito.analise_solicitada', 'analise_propria.divergencia_seguradora',
     'analise_propria.aguardando_revisao', 'processo.novo_detectado',
     'comissao.apurada', 'comissao.estornada', 'competencia.fechada'
   );

-- "Vendedor sem atividade" repetia todo dia a mesma pessoa: agora uma vez por semana.
update public.notificacao_regras
   set dedup_horas = 168, atualizado_em = now()
 where tipo_evento = 'vendedor.sem_atividade';

-- Regras por PERFIL para os avisos que o código mandava direto a um perfil.
insert into public.notificacao_regras (tipo_evento, perfil_id, canais, dedup_horas, fallback_admin)
select r.tipo, pf.id, r.canais::text[], r.dedup, pf.nome in ('Crédito', 'Jurídico')
from (values
  ('mercado.ingestao_falhou',     'Admin',     '{sino,push}', 0),
  ('orcamento.estourado',         'Admin',     '{sino,push}', 0),
  ('orcamento_descoberta.alerta', 'Admin',     '{sino,push}', 20),
  ('orcamento_descoberta.alerta', 'Comercial', '{sino,push}', 20),
  ('antecipacao.regrediu',        'Admin',     '{sino,push}', 0),
  ('antecipacao.regrediu',        'Comercial', '{sino,push}', 0),
  ('campanha.alerta_saude',       'Admin',     '{sino,push}', 0),
  ('campanha.alerta_saude',       'Comercial', '{sino,push}', 0),
  ('protesto.detectado',          'Admin',     '{sino,push}', 0),
  ('protesto.detectado',          'Crédito',   '{sino,push}', 0),
  ('grupo.protesto_agravado',     'Admin',     '{sino,push}', 0),
  ('grupo.protesto_agravado',     'Crédito',   '{sino,push}', 0),
  ('protestos.custo_mensal',      'Admin',     '{sino,push}', 0),
  ('protestos.custo_mensal',      'Crédito',   '{sino,push}', 0),
  ('webhook.nao_entregue',        'Admin',     '{sino,push}', 0),
  ('nf.sem_originador',           'Admin',     '{sino,push}', 168),
  ('nf.sem_originador',           'Comercial', '{sino,push}', 168)
) as r(tipo, perfil, canais, dedup)
join public.perfis pf on pf.nome = r.perfil
on conflict do nothing;

-- (a) Regras por PAPEL: quem age passa a receber.
insert into public.notificacao_regras
  (tipo_evento, papel, canais, frequencia, dedup_horas, fallback_admin, respeita_silencio)
select r.tipo, r.papel, r.canais::text[], r.freq, r.dedup, r.fallback, r.silencio
from (values
  -- Comercial: o aviso sai da gestão e chega a quem age.
  ('sdr.aceite_pendente',          'closer_da_reuniao',      '{sino,push}', 'imediato',      0,   false, true),
  ('sdr.aceite_decidido',          'sdr_do_lead',            '{sino,push}', 'imediato',      0,   false, true),
  ('sdr.reuniao_agendada',         'closer_da_reuniao',      '{sino,push}', 'imediato',      0,   false, true),
  ('sdr.lead_distribuido',         'sdr_do_lead',            '{sino,push}', 'imediato',      0,   false, true),
  ('sdr.lead_expirado',            'sdr_do_lead',            '{sino}',      'imediato',      0,   false, true),
  ('comercial.bom_dia',            'nomeados',               '{sino,push}', 'imediato',      0,   false, true),
  ('comissao.apurada_vendedor',    'vendedor_citado',        '{sino,push}', 'imediato',      0,   false, true),
  ('comissao.estornada_vendedor',  'vendedor_citado',        '{sino,push}', 'imediato',      0,   false, true),
  ('comissao.fechada_vendedor',    'vendedor_citado',        '{sino,push}', 'imediato',      0,   false, true),
  ('venda.credito_decidido',       'vendedor_da_venda',      '{sino,push}', 'imediato',      0,   false, true),
  -- Antecipação: as notas de cada um, para cada um.
  ('nf.convertida',                'originador_da_nota',     '{sino}',      'resumo_diario', 0,   true,  true),
  ('nf.faixa_alta',                'vendedor_citado',        '{sino}',      'resumo_diario', 0,   true,  true),
  ('preauth.expirando',            'originador_da_nota',     '{sino,push}', 'imediato',      720, true,  true),
  ('antecipacao.regrediu',         'originador_da_nota',     '{sino,push}', 'imediato',      0,   false, true),
  ('sacado.limite_insuficiente',   'dono_da_empresa',        '{sino}',      'resumo_diario', 24,  true,  true),
  ('cliente.tornou_ex',            'dono_da_empresa',        '{sino}',      'resumo_diario', 0,   true,  true),
  ('sacado_prospeccao.novo_relevante', 'vendedor_citado',    '{sino,push}', 'imediato',      0,   false, true),
  ('sacado_prospeccao.decidido',   'vendedor_citado',        '{sino,push}', 'imediato',      0,   false, true),
  -- Comunicação: a conversa é de quem cuida dela.
  ('conversa.nao_vinculada',       'dono_do_numero',         '{sino,push}', 'imediato',      0,   true,  true),
  ('comunicacao.recebida',         'vendedor_citado',        '{sino,push}', 'imediato',      0,   false, true),
  ('agente.escalou',               'responsavel_da_conversa','{sino,push}', 'imediato',      0,   true,  true),
  ('agente.sugestao',              'responsavel_da_conversa','{sino,push}', 'imediato',      0,   false, true),
  ('optout.registrado',            'responsavel_da_conversa','{sino,push}', 'imediato',      0,   false, true),
  ('comunicacao.falhou',           'dono_do_envio',          '{sino,push}', 'imediato',      0,   false, true),
  -- Crédito: a decisão vai a quem pediu.
  ('analise.aprovada',             'quem_pediu',             '{sino,push}', 'imediato',      0,   false, true),
  ('analise.aprovada_parcial',     'quem_pediu',             '{sino,push}', 'imediato',      0,   false, true),
  ('analise.negada',               'quem_pediu',             '{sino,push}', 'imediato',      0,   false, true),
  ('analise_propria.aguardando_revisao', 'nomeados',         '{sino,push}', 'imediato',      0,   false, true),
  ('analise_propria.concluida',    'nomeados',               '{sino,push}', 'imediato',      0,   false, true),
  -- Jurídico: o advogado do processo; sem advogado da casa, o Admin.
  ('processo.movimentacao_relevante', 'advogado_do_processo','{sino,push}', 'imediato',      0,   true,  true),
  ('processo.fase_lenta',          'advogado_do_processo',   '{sino,push}', 'imediato',      0,   true,  true),
  ('processo.prazo_proximo',       'advogado_do_processo',   '{sino,push}', 'imediato',      0,   true,  true),
  -- Plataforma.
  ('report.status_alterado',       'nomeados',               '{sino,push}', 'imediato',      0,   false, true),
  ('report.comentado',             'nomeados',               '{sino,push}', 'imediato',      0,   false, true),
  ('plataforma.teste',             'nomeados',               '{sino,push}', 'imediato',      0,   false, false)
) as r(tipo, papel, canais, freq, dedup, fallback, silencio)
on conflict do nothing;

-- ── 12. O sino antigo ganha tipo ─────────────────────────────────────────────
-- Para o painel abrir com os números dos últimos 30 dias em vez de zeros. Os
-- avisos do fan-out casam pelo evento gravado no mesmo instante; os do código,
-- pelo título que ele escrevia.
update public.notificacoes n
   set tipo = e.tipo
  from public.empresa_eventos e
 where n.tipo is null
   and e.criado_em = n.criado_em
   and n.titulo = coalesce(e.payload ->> 'titulo', n.titulo);

update public.notificacoes n
   set tipo = x.tipo
  from (values
    ('Pré-autorização expirando:%', 'preauth.expirando'),
    ('% respondeu',                 'comunicacao.recebida'),
    ('Nova nota em faixa alta',     'nf.faixa_alta'),
    ('% novas notas em faixa alta', 'nf.faixa_alta'),
    ('Uma conversa precisa de você','agente.escalou'),
    ('Próximo passo sugerido',      'agente.sugestao'),
    ('Pedido de descadastro',       'optout.registrado'),
    ('NFs sem originador',          'nf.sem_originador'),
    ('Processo lento',              'processo.fase_lenta'),
    ('Movimentação relevante',      'processo.movimentacao_relevante'),
    ('Protesto detectado',          'protesto.detectado'),
    ('Sua mensagem não foi enviada','comunicacao.falhou'),
    ('Vendedores sem atividade',    'vendedor.sem_atividade'),
    ('Leads expirados',             'sdr.lead_expirado'),
    ('Ingestão falhou%',            'mercado.ingestao_falhou'),
    ('Bom dia',                     'comercial.bom_dia'),
    ('Crédito %',                   'venda.credito_decidido'),
    ('Seu report #%',               'report.status_alterado'),
    ('Novo comentário no report%',  'report.comentado')
  ) as x(padrao, tipo)
 where n.tipo is null and n.titulo like x.padrao;

-- ── 13. O último insert solto passa pelo motor ───────────────────────────────

create or replace function public.prospeccao_reagir_a_decisao()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_card public.sacados_prospeccao;
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
   * Desde a 0262 ela passa pelo motor de avisos, como o resto: o tipo
   * `sacado_prospeccao.decidido` tem regra por papel (`vendedor_citado` → o
   * originador do card), e o texto e o canal são mudáveis no painel. O insert
   * direto que estava aqui não tinha push — o comentário prometia que o worker o
   * mandaria, e nenhum worker lia as notificações novas.
   */
  v_nome := coalesce(v_card.sacado_nome, v_card.cnpj_sacado);
  perform public.notificacao__entregar(
    'sacado_prospeccao.decidido',
    v_card.empresa_id,
    jsonb_build_object(
      'titulo', case when new.estagio in ('aprovada', 'aprovada_parcial')
                     then 'Sacado aprovado: ' || v_nome
                     else 'Sacado recusado: ' || v_nome end,
      'resumo', case when new.estagio in ('aprovada', 'aprovada_parcial')
                     then 'A esteira aprovou o limite. Ele entrou na sua carteira e as notas dele caem no funil de NFs.'
                     else coalesce(nullif(new.motivo, ''), 'A esteira não aprovou limite para este CNPJ.') end,
      'url', '/antecipacao/sacados-por-nf',
      'vendedor_id', v_card.originador_id,
      'analise_id', new.id,
      'decisao', new.estagio,
      'sacado', v_nome
    ),
    null
  );

  return new;
end $$;
