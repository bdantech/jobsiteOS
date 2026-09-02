-- ═════════════════════════════════════════════════════════════════════════════
-- 0159 — API de Crédito para a plataforma de produção (04n)
--
-- Dois lados de uma integração: a plataforma de produção CRIA análises aqui, e
-- precisa ser avisada a cada mudança de estágio delas.
--
-- ─── POR QUE CHAVE DE API, E NÃO USUÁRIO ────────────────────────────────────
-- Quem chama é um SISTEMA. Um usuário de serviço teria perfil, módulos e RLS
-- desenhados para gente — e a primeira pergunta "qual vendedor é esse?" não teria
-- resposta. A chave tem escopo próprio e morre sozinha quando revogada.
--
-- Guardada como HASH: ela nunca é reexibida depois da criação, então não existe
-- caminho que a devolva — nem para o service role. O `prefixo` (8 primeiros
-- caracteres) é o que a UI mostra para alguém saber qual chave revogar.
-- ═════════════════════════════════════════════════════════════════════════════

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  key_hash text not null unique,
  prefixo text not null,
  escopos text[] not null default '{credito:write,credito:read}',
  ativa boolean not null default true,
  ultimo_uso_em timestamptz,
  criada_por uuid references public.usuarios(id) on delete set null,
  criada_em timestamptz not null default now(),
  revogada_em timestamptz
);

create index if not exists api_keys_ativa_idx on public.api_keys (ativa) where ativa;

/*
 * IDEMPOTÊNCIA: a mesma `Idempotency-Key` devolve a MESMA resposta.
 *
 * Guardar só "já vi esta chave" não basta — o cliente que perdeu a resposta por
 * timeout precisa recebê-la igual no reenvio, não um 409 que ele não sabe
 * interpretar. Por isso a resposta inteira fica aqui.
 *
 * A unicidade é por (chave de API, idempotency key): duas integrações diferentes
 * podem usar o mesmo identificador sem colidir.
 */
create table if not exists public.api_idempotencia (
  id uuid primary key default gen_random_uuid(),
  api_key_id uuid not null references public.api_keys(id) on delete cascade,
  chave text not null,
  rota text not null,
  status_http int not null,
  resposta jsonb not null,
  criada_em timestamptz not null default now(),
  unique (api_key_id, chave)
);

create table if not exists public.api_requests_log (
  id uuid primary key default gen_random_uuid(),
  api_key_id uuid references public.api_keys(id) on delete set null,
  rota text not null,
  metodo text not null,
  status_http int not null,
  duracao_ms int,
  idempotency_key text,
  erro text,
  criado_em timestamptz not null default now()
);

create index if not exists api_requests_log_tempo_idx on public.api_requests_log (criado_em desc);
create index if not exists api_requests_log_key_idx on public.api_requests_log (api_key_id, criado_em desc);

-- ═════════════════════════════════════════════════════════════════════════════
-- WEBHOOK DE SAÍDA
-- ═════════════════════════════════════════════════════════════════════════════

create table if not exists public.webhooks_saida (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  url text not null,
  secret text not null,
  eventos text[] not null,
  ativo boolean not null default true,
  criado_por uuid references public.usuarios(id) on delete set null,
  criado_em timestamptz not null default now()
);

/*
 * A FILA. Uma linha por (evento × webhook inscrito).
 *
 * `evento_id` é compartilhado entre as linhas do mesmo evento: é ele que o
 * consumidor usa para deduplicar, e dois webhooks recebendo ids diferentes do
 * mesmo fato quebrariam essa promessa.
 *
 * `payload` nasce com uma SEMENTE (o que o gatilho sabe) e é substituído pelo
 * payload completo no momento da entrega, montado pelo builder único do core. O
 * gatilho não monta o payload de propósito: ele teria de reimplementar em SQL o
 * mesmo `montarPayloadCredito()` que o GET usa, e duas montagens divergem na
 * primeira mudança feita em só uma. Depois da entrega, esta coluna guarda
 * exatamente o que foi enviado — que é o que a auditoria precisa.
 */
create table if not exists public.webhook_entregas (
  id uuid primary key default gen_random_uuid(),
  webhook_id uuid not null references public.webhooks_saida(id) on delete cascade,
  evento text not null,
  evento_id uuid not null,
  analise_id uuid references public.analises_credito(id) on delete set null,
  payload jsonb not null,
  tentativas int not null default 0,
  status text not null default 'pendente' check (status in ('pendente', 'entregue', 'falhou')),
  ultimo_status_http int,
  ultima_resposta text,
  ultimo_erro text,
  proxima_tentativa_em timestamptz not null default now(),
  criado_em timestamptz not null default now(),
  entregue_em timestamptz
);

create index if not exists webhook_entregas_fila_idx
  on public.webhook_entregas (status, proxima_tentativa_em)
  where status = 'pendente';
create index if not exists webhook_entregas_tempo_idx on public.webhook_entregas (criado_em desc);

-- ═════════════════════════════════════════════════════════════════════════════
-- A ANÁLISE PASSA A SABER DE ONDE VEIO
-- ═════════════════════════════════════════════════════════════════════════════

alter table public.analises_credito add column if not exists external_id text;
alter table public.analises_credito add column if not exists origem_externa text;
alter table public.analises_credito add column if not exists contato_externo jsonb;

create unique index if not exists analises_credito_external_id_idx
  on public.analises_credito (external_id) where external_id is not null;

alter table public.analise_docs add column if not exists origem text not null default 'jobsiteos';
alter table public.analise_docs add column if not exists exercicio int;
alter table public.analise_docs add column if not exists external_id text;

-- ═════════════════════════════════════════════════════════════════════════════
-- A EMISSÃO É DA TABELA, NÃO DE QUEM ESCREVE NELA
--
-- O estágio muda por cinco caminhos hoje: a RPC do kanban, o sync da Atradius, o
-- job de expiração, a API deste prompt e a mão de um admin no SQL. Pendurar a
-- emissão em cada um garantiria esquecê-la no sexto — e um webhook que não sai é
-- uma integração que mente em silêncio. No gatilho, a regra é da tabela.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.app__enfileirar_webhook(
  p_evento text,
  p_analise uuid,
  p_semente jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_evento_id uuid := gen_random_uuid();
begin
  insert into public.webhook_entregas (webhook_id, evento, evento_id, analise_id, payload)
  select w.id, p_evento, v_evento_id, p_analise,
         jsonb_build_object('_semente', p_semente, 'evento', p_evento, 'evento_id', v_evento_id)
    from public.webhooks_saida w
   where w.ativo and p_evento = any(w.eventos);
end $$;

comment on function public.app__enfileirar_webhook is
  'Enfileira um evento para todos os webhooks ativos inscritos nele. O payload aqui é '
  'semente: o worker o substitui pelo completo, montado pelo builder único do core.';

create or replace function public.analises_credito__notificar() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.app__enfileirar_webhook(
      'credito.analise_criada', new.id,
      jsonb_build_object('estagio_anterior', null, 'estagio_atual', new.estagio)
    );
    return null;
  end if;

  if new.estagio is distinct from old.estagio then
    perform public.app__enfileirar_webhook(
      'credito.estagio_alterado', new.id,
      jsonb_build_object('estagio_anterior', old.estagio, 'estagio_atual', new.estagio)
    );
  end if;

  /*
   * Limite alterado é evento próprio porque a REDUÇÃO pela seguradora é sinal de
   * risco e costuma acontecer sem mudar o estágio: continua 'aprovada', com menos
   * dinheiro. Quem só escuta estágio não veria.
   */
  if new.limite_aprovado is distinct from old.limite_aprovado then
    perform public.app__enfileirar_webhook(
      'credito.limite_alterado', new.id,
      jsonb_build_object(
        'limite_anterior', old.limite_aprovado,
        'limite_atual', new.limite_aprovado,
        'estagio_atual', new.estagio
      )
    );
  end if;

  if new.decisao_interna is distinct from old.decisao_interna and new.decisao_interna is not null then
    perform public.app__enfileirar_webhook(
      'credito.decisao_registrada', new.id,
      jsonb_build_object('decisao', new.decisao_interna, 'estagio_atual', new.estagio)
    );
  end if;

  return null;
end $$;

drop trigger if exists analises_credito_notificar on public.analises_credito;
create trigger analises_credito_notificar
  after insert or update on public.analises_credito
  for each row execute function public.analises_credito__notificar();

create or replace function public.analise_docs__notificar() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.app__enfileirar_webhook(
    'credito.documento_recebido', new.analise_id,
    jsonb_build_object('tipo', new.tipo, 'nome_arquivo', new.nome_arquivo, 'origem', new.origem)
  );
  return null;
end $$;

drop trigger if exists analise_docs_notificar on public.analise_docs;
create trigger analise_docs_notificar
  after insert on public.analise_docs
  for each row execute function public.analise_docs__notificar();

-- ═════════════════════════════════════════════════════════════════════════════
-- RLS — tudo aqui é operação de integração: Crédito lê, admin administra.
-- O worker e as rotas de API usam service role e não passam por estas policies.
-- ═════════════════════════════════════════════════════════════════════════════

alter table public.api_keys enable row level security;
alter table public.api_idempotencia enable row level security;
alter table public.api_requests_log enable row level security;
alter table public.webhooks_saida enable row level security;
alter table public.webhook_entregas enable row level security;

-- O hash nunca sai: a policy libera a linha, e a UI seleciona colunas explícitas.
create policy api_keys_select on public.api_keys
  for select using ((select public.app_tem_modulo('credito')));
create policy webhooks_saida_select on public.webhooks_saida
  for select using ((select public.app_tem_modulo('credito')));
create policy webhook_entregas_select on public.webhook_entregas
  for select using ((select public.app_tem_modulo('credito')));
create policy api_requests_log_select on public.api_requests_log
  for select using ((select public.app_tem_modulo('credito')));

-- Escrita só por RPC (security definer). Sem policy de insert/update/delete,
-- nenhum client — nem o do admin — escreve direto nestas tabelas.

-- ═════════════════════════════════════════════════════════════════════════════
-- As escritas, por RPC. A CHAVE NUNCA CHEGA AQUI — só o hash e o prefixo: gerar
-- e derivar acontece no Node, e o banco guarda o que não reconstrói o segredo.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.app_criar_api_key(p jsonb)
returns public.api_keys language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_row public.api_keys;
begin
  if not public.app_is_admin() then
    raise exception 'Só administradores criam chaves de API.' using errcode = '42501';
  end if;

  insert into public.api_keys (nome, key_hash, prefixo, escopos, criada_por)
  values (
    nullif(btrim(coalesce(p ->> 'nome', '')), ''),
    p ->> 'key_hash',
    p ->> 'prefixo',
    coalesce(
      (select array_agg(value::text) from jsonb_array_elements_text(p -> 'escopos')),
      array['credito:write', 'credito:read']
    ),
    v_ator
  )
  returning * into v_row;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'api_key.criada', 'api_keys', v_row.id::text,
          jsonb_build_object('nome', v_row.nome, 'prefixo', v_row.prefixo));

  return v_row;
end $$;

create or replace function public.app_revogar_api_key(p jsonb)
returns public.api_keys language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_row public.api_keys;
begin
  if not public.app_is_admin() then
    raise exception 'Só administradores revogam chaves de API.' using errcode = '42501';
  end if;

  update public.api_keys
     set ativa = false, revogada_em = now()
   where id = (p ->> 'id')::uuid
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Chave não encontrada.' using errcode = 'no_data_found';
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'api_key.revogada', 'api_keys', v_row.id::text, jsonb_build_object('prefixo', v_row.prefixo));

  return v_row;
end $$;

create or replace function public.app_salvar_webhook(p jsonb)
returns public.webhooks_saida language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_row public.webhooks_saida;
  v_eventos text[] := coalesce(
    (select array_agg(value::text) from jsonb_array_elements_text(p -> 'eventos')),
    array['credito.estagio_alterado']
  );
begin
  if not public.app_tem_modulo('credito') then
    raise exception 'Sem acesso ao módulo Crédito.' using errcode = '42501';
  end if;

  if p ->> 'url' !~ '^https://' then
    raise exception 'A URL do webhook precisa ser https.' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.webhooks_saida (nome, url, secret, eventos, criado_por)
    values (coalesce(nullif(btrim(p ->> 'nome'), ''), 'Plataforma de produção'),
            p ->> 'url', p ->> 'secret', v_eventos, v_ator)
    returning * into v_row;
  else
    update public.webhooks_saida
       set nome = coalesce(nullif(btrim(p ->> 'nome'), ''), nome),
           url = p ->> 'url',
           -- Sem `secret` no payload, o antigo permanece: rotacionar é uma ação
           -- deliberada, e um salvamento de URL não pode derrubar a assinatura
           -- que o consumidor já validou.
           secret = coalesce(nullif(p ->> 'secret', ''), secret),
           eventos = v_eventos,
           ativo = coalesce((p ->> 'ativo')::boolean, ativo)
     where id = v_id
    returning * into v_row;
  end if;

  if v_row.id is null then
    raise exception 'Webhook não encontrado.' using errcode = 'no_data_found';
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'webhook.salvo', 'webhooks_saida', v_row.id::text,
          jsonb_build_object('url', v_row.url, 'eventos', v_row.eventos));

  return v_row;
end $$;

/*
 * Reenvio manual: devolve a entrega para a fila em vez de criar outra.
 *
 * A linha guarda a história de tentativas daquele evento, e uma cópia nova a
 * partiria em duas — o log deixaria de responder "quantas vezes tentamos entregar
 * ISTO". O `evento_id` também é preservado, então o consumidor deduplica igual.
 */
create or replace function public.app_reenviar_entrega(p jsonb)
returns public.webhook_entregas language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_row public.webhook_entregas;
begin
  if not public.app_tem_modulo('credito') then
    raise exception 'Sem acesso ao módulo Crédito.' using errcode = '42501';
  end if;

  update public.webhook_entregas
     set status = 'pendente', proxima_tentativa_em = now(), ultimo_erro = null
   where id = (p ->> 'id')::uuid
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Entrega não encontrada.' using errcode = 'no_data_found';
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'webhook.reenviado', 'webhook_entregas', v_row.id::text,
          jsonb_build_object('evento', v_row.evento, 'tentativas', v_row.tentativas));

  return v_row;
end $$;

/** O "enviar evento de teste" da UI: um evento real, com análise nula. */
create or replace function public.app_webhook_teste(p jsonb)
returns public.webhook_entregas language plpgsql security definer set search_path = '' as $$
declare
  v_row public.webhook_entregas;
begin
  if not public.app_tem_modulo('credito') then
    raise exception 'Sem acesso ao módulo Crédito.' using errcode = '42501';
  end if;

  insert into public.webhook_entregas (webhook_id, evento, evento_id, analise_id, payload)
  values (
    (p ->> 'webhook_id')::uuid, 'webhook.teste', gen_random_uuid(), null,
    jsonb_build_object('_semente', jsonb_build_object('teste', true), 'evento', 'webhook.teste')
  )
  returning * into v_row;

  return v_row;
end $$;

revoke execute on function public.app__enfileirar_webhook(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.app__enfileirar_webhook(text, uuid, jsonb) to service_role;

revoke execute on function public.app_criar_api_key(jsonb) from public, anon;
revoke execute on function public.app_revogar_api_key(jsonb) from public, anon;
revoke execute on function public.app_salvar_webhook(jsonb) from public, anon;
revoke execute on function public.app_reenviar_entrega(jsonb) from public, anon;
revoke execute on function public.app_webhook_teste(jsonb) from public, anon;
grant execute on function public.app_criar_api_key(jsonb) to authenticated, service_role;
grant execute on function public.app_revogar_api_key(jsonb) to authenticated, service_role;
grant execute on function public.app_salvar_webhook(jsonb) to authenticated, service_role;
grant execute on function public.app_reenviar_entrega(jsonb) to authenticated, service_role;
grant execute on function public.app_webhook_teste(jsonb) to authenticated, service_role;
