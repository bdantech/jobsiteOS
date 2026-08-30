-- ═════════════════════════════════════════════════════════════════════════════
-- 0147 — Campanhas (Prompt 05B)
--
-- O 05A resolveu UMA relação: uma thread, um destinatário, um portão. Aqui o
-- problema é MUITOS destinatários — e a frase que organiza tudo é a do prompt:
-- toda campanha é uma forma de gerar mensagens individuais que, **assim que
-- alguém responde, deixam de ser campanha e viram conversa do Agente**.
--
-- ─── A DECISÃO DE ARQUITETURA QUE VALE LER ANTES DO SQL ─────────────────────
-- Campanha NÃO tem transporte próprio. Ela materializa destinatários e, no ritmo
-- configurado, empurra linhas para `mensagens_outbox` — a MESMA fila que o
-- compositor, a régua e o agente usam. Quem envia continua sendo
-- `jobs/comunicacao/enviar-fila`, que já aplica `podeEnviar()` no instante do
-- envio, tem retry com backoff, grava no ledger e toca a conversa.
--
-- Três coisas que só ficam certas por causa disso:
--
--   1. O teto por número é um só. Se campanha tivesse fila própria, os dois
--      remetentes contariam o mesmo número separadamente e o warmup viraria
--      ficção — cada um respeitando metade do limite, os dois juntos estourando.
--   2. "O individual tem prioridade" (§7) vira um ORDER BY, não um acordo entre
--      dois processos.
--   3. O portão é aplicado no envio e não só na simulação, porque o envio é o
--      mesmo código de sempre. Quem virou suprimido no meio do caminho é barrado
--      sem que campanha precise saber que supressão existe.
--
-- O preço é o vínculo de volta: a outbox ganha `campanha_destinatario_id` e um
-- trigger propaga o desfecho. Trigger e não código no worker porque o worker de
-- envio não deve aprender o que é campanha — no dia em que existir uma quarta
-- origem, ela também não vai precisar ensinar nada a ele.
-- ═════════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- §1 — Modelo
-- =============================================================================

create table public.campanhas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  tipo text not null
    constraint campanhas_tipo_check check (tipo in ('prospeccao', 'winback', 'operacional', 'anuncio')),
  /* Herdado pela conversa ao iniciar. Mesmos objetivos do 05A, de propósito: o
     Agente lê `conversas.objetivo` e não sabe (nem precisa saber) que a conversa
     nasceu de campanha. */
  objetivo text,
  canal text not null
    constraint campanhas_canal_check check (canal in ('whatsapp', 'email')),

  -- ── público ──────────────────────────────────────────────────────────────
  origem_publico text not null
    constraint campanhas_origem_publico_check
    check (origem_publico in ('segmento', 'filtro', 'lista_manual', 'preset')),
  segmento_id uuid references public.segmentos (id) on delete set null,
  definicao_filtro jsonb,
  preset text
    constraint campanhas_preset_check check (preset is null or preset in
      ('winback_ex_clientes', 'spes_sem_certificado', 'docs_pendentes', 'fornecedores_a_cadastrar')),
  /* Parâmetros do preset (motivo de saída, dias parados, potencial mínimo…).
     Ficam separados de `definicao_filtro` porque um preset editado depois vira
     `origem_publico = 'filtro'` e a definição passa a mandar. */
  preset_params jsonb not null default '{}'::jsonb,
  /* `lista_manual`: empresas escolhidas a dedo. */
  empresas_manuais uuid[] not null default '{}',

  -- ── conteúdo ─────────────────────────────────────────────────────────────
  /* [{ id, template_id, peso, passo, dias_apos }] — 1 ou mais (teste A/B),
     até 3 passos (§5). O CHECK só garante que é array não vazio; a forma é
     validada no RPC contra o zod do core, que é onde a regra é legível. */
  variantes jsonb not null default '[]'::jsonb
    constraint campanhas_variantes_check check (jsonb_typeof(variantes) = 'array'),

  -- ── execução ─────────────────────────────────────────────────────────────
  contas_remetentes uuid[] not null default '{}',
  vendedor_id uuid references public.vendedores (id) on delete set null,
  inicio_em timestamptz,
  ritmo_por_dia int not null default 50
    constraint campanhas_ritmo_check check (ritmo_por_dia > 0 and ritmo_por_dia <= 5000),
  respeitar_janela boolean not null default true,

  -- ── guardrails ───────────────────────────────────────────────────────────
  excluir_contatados_dias int not null default 14
    constraint campanhas_contatados_check check (excluir_contatados_dias >= 0 and excluir_contatados_dias <= 3650),
  excluir_conversa_aberta boolean not null default true,
  modo_agente_ao_responder text not null default 'sugestao'
    constraint campanhas_modo_agente_check check (modo_agente_ao_responder in ('sugestao', 'autonomo')),

  -- ── estado ───────────────────────────────────────────────────────────────
  status text not null default 'rascunho'
    constraint campanhas_status_check check (status in
      ('rascunho', 'aguardando_aprovacao', 'agendada', 'executando', 'pausada', 'concluida', 'cancelada')),
  /* O retrato do dry-run que embasou a aprovação. Guardado, e não recalculado:
     "quantos seriam excluídos por supressão quando eu aprovei" é uma pergunta
     sobre o passado, e recalcular responderia sobre o presente. */
  simulacao jsonb,
  simulada_em timestamptz,
  aprovada_por uuid references public.usuarios (id) on delete set null,
  aprovada_em timestamptz,
  pausa_motivo text,
  criada_por uuid references public.usuarios (id) on delete set null,
  criada_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now(),
  concluida_em timestamptz,

  /* Aprovada é aprovada POR ALGUÉM. Sem isto, um update de status direto no
     banco produziria campanha aprovada por ninguém — e o §3 inteiro existe para
     que esse passo tenha um dono com nome. */
  constraint campanhas_aprovacao_tem_dono
    check ((aprovada_em is null) = (aprovada_por is null)),
  /* Cada origem de público exige a sua fonte. Uma campanha `segmento` sem
     segmento é uma campanha que só descobre que não tem público na hora de
     executar, quando já foi aprovada. */
  constraint campanhas_publico_tem_fonte check (
    case origem_publico
      when 'segmento' then segmento_id is not null
      when 'filtro' then definicao_filtro is not null
      when 'preset' then preset is not null
      when 'lista_manual' then array_length(empresas_manuais, 1) is not null
    end
  )
);

create index campanhas_status_idx on public.campanhas (status, inicio_em);
create index campanhas_vendedor_idx on public.campanhas (vendedor_id) where vendedor_id is not null;

comment on table public.campanhas is
  'Disparo em massa a partir de segmento, filtro, lista ou preset. Não tem transporte '
  'próprio: empurra para `mensagens_outbox` no ritmo configurado e quem envia é o job de '
  'comunicação, que aplica o portão do 05A no instante do envio.';

create trigger campanhas_touch before update on public.campanhas
  for each row execute function public.set_atualizada_em();

-- ─── Destinatários ──────────────────────────────────────────────────────────

create table public.campanha_destinatarios (
  id uuid primary key default gen_random_uuid(),
  campanha_id uuid not null references public.campanhas (id) on delete cascade,
  empresa_id uuid references public.empresas (id) on delete cascade,
  contato_id uuid references public.contatos (id) on delete set null,
  variante_id text,
  /* Em qual toque da sequência este destinatário está (1..3). */
  passo int not null default 1
    constraint campanha_dest_passo_check check (passo between 1 and 3),
  status text not null default 'pendente'
    constraint campanha_dest_status_check check (status in
      ('pendente', 'agendada', 'enviada', 'falhou', 'excluida', 'respondida', 'optout')),
  motivo_exclusao text
    constraint campanha_dest_motivo_check check (motivo_exclusao is null or motivo_exclusao in
      ('suprimido', 'sem_contato', 'contatado_recente', 'conversa_aberta', 'sem_base_legal',
       'teto_diario', 'duplicado', 'processo_juridico', 'passivo', 'outra_campanha',
       'frequencia_90d', 'cancelada')),
  comunicacao_id uuid references public.comunicacoes (id) on delete set null,
  conversa_id uuid references public.conversas (id) on delete set null,
  agendada_para timestamptz,
  enviada_em timestamptz,
  respondida_em timestamptz,
  erro text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  /* Uma empresa gera UM destinatário (§2). O unique é por contato porque é o
     contato que recebe; a unicidade por empresa é garantida na materialização,
     que resolve um contato por empresa antes de inserir. */
  unique (campanha_id, contato_id),
  /* Excluída sempre tem motivo. Sem isto o painel de exclusões — que é metade do
     valor do dry-run — teria uma fatia "sem motivo" que ninguém sabe explicar. */
  constraint campanha_dest_exclusao_tem_motivo
    check (status <> 'excluida' or motivo_exclusao is not null)
);

create index campanha_dest_campanha_idx on public.campanha_destinatarios (campanha_id, status);
create index campanha_dest_contato_idx on public.campanha_destinatarios (contato_id, criado_em desc)
  where contato_id is not null;
create index campanha_dest_empresa_idx on public.campanha_destinatarios (empresa_id);
/* O trigger de resposta procura por aqui a cada mensagem de ENTRADA no ledger —
   sem índice, cada resposta recebida viria com uma varredura da tabela inteira. */
create index campanha_dest_conversa_idx on public.campanha_destinatarios (conversa_id)
  where conversa_id is not null;
/* A varredura do executor: quem está pronto para virar linha de outbox. */
create index campanha_dest_fila_idx on public.campanha_destinatarios (campanha_id, agendada_para)
  where status in ('pendente', 'agendada');

comment on table public.campanha_destinatarios is
  'Uma linha por pessoa por campanha. `status = respondida` é o fim da campanha para ela: '
  'a conversa passa a ser do Agente e nenhum passo seguinte sai.';

create or replace function set_atualizado_em_campanha_dest()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.atualizado_em := now();
  return new;
end; $$;
revoke execute on function set_atualizado_em_campanha_dest() from public, anon, authenticated;

create trigger campanha_dest_touch before update on public.campanha_destinatarios
  for each row execute function public.set_atualizado_em_campanha_dest();

-- ─── Config ─────────────────────────────────────────────────────────────────

create table public.campanhas_config (
  chave text primary key,
  valor jsonb not null,
  atualizado_por uuid references public.usuarios (id) on delete set null,
  atualizado_em timestamptz not null default now()
);

comment on table public.campanhas_config is
  'Tetos de massa e limiares de saúde de canal. Mesmo desenho de comunicacao_config.';

insert into public.campanhas_config (chave, valor) values
  ('limites', jsonb_build_object(
    -- Duas campanhas ativas já disputam o mesmo teto de número. Três é o ponto em
    -- que ninguém mais sabe qual delas está queimando a base.
    'max_campanhas_ativas', 3,
    'max_campanhas_por_contato_90d', 2,
    -- Percentuais, não frações: é como a tela mostra e como a pessoa pensa.
    'alerta_optout_pct', 2.0,
    'alerta_bounce_pct', 5.0,
    -- Amostra mínima antes de alertar. Sem ela, 1 opt-out em 3 enviadas dispara
    -- alerta de 33% e o alerta perde o sentido antes da primeira campanha real.
    'minimo_para_alertar', 50
  ));

-- =============================================================================
-- §2 — A ponte com a fila de envio do 05A
-- =============================================================================

/* `campanha` entra nas duas listas de origem: a da fila e a do ledger. */
alter table public.mensagens_outbox drop constraint mensagens_outbox_origem_check;
alter table public.mensagens_outbox add constraint mensagens_outbox_origem_check
  check (origem in ('compositor', 'outbox', 'agente', 'campanha'));

alter table public.comunicacoes drop constraint comunicacoes_origem_check;
alter table public.comunicacoes add constraint comunicacoes_origem_check
  check (origem is null or origem in
    ('compositor', 'outbox', 'agente', 'app_toque', 'inbox', 'sistema', 'campanha'));

alter table public.comunicacoes
  add column campanha_id uuid references public.campanhas (id) on delete set null;
create index comunicacoes_campanha_idx on public.comunicacoes (campanha_id, criado_em desc)
  where campanha_id is not null;

alter table public.mensagens_outbox
  add column campanha_destinatario_id uuid
    references public.campanha_destinatarios (id) on delete set null,
  add column campanha_id uuid references public.campanhas (id) on delete set null;
create index mensagens_outbox_campanha_idx on public.mensagens_outbox (campanha_destinatario_id)
  where campanha_destinatario_id is not null;

/*
 * O desfecho volta da fila para o destinatário.
 *
 * O worker de envio não sabe o que é campanha, e não deve saber: no dia em que
 * existir uma quarta origem, ela também não vai querer ensinar nada a ele. O
 * trigger é o acoplamento mínimo — lê o que a fila já escreveu e traduz.
 */
create or replace function public.campanha_propagar_desfecho()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.campanha_destinatario_id is null then return new; end if;
  if new.status is not distinct from old.status
     and new.comunicacao_id is not distinct from old.comunicacao_id then
    return new;
  end if;
  /* Pausar e cancelar descartam o que ainda não saiu, e isso NÃO é recusa do
     portão: as RPCs que escreveram esses descartes cuidam dos destinatários
     delas. Sem esta saída, o trigger carimbaria "excluída por teto" antes de a
     RPC conseguir devolver a pessoa à fila. */
  if new.motivo_descarte in ('campanha_pausada', 'campanha_cancelada') then
    return new;
  end if;

  update public.campanha_destinatarios set
    status = case new.status
      when 'enviada' then 'enviada'
      when 'falhou' then 'falhou'
      when 'descartada' then 'excluida'
      else status
    end,
    /* O motivo do portão vira o motivo de exclusão do painel. Os dois vocabulários
       coincidem de propósito: `suprimido` na recusa do envio e `suprimido` na
       exclusão da campanha são a mesma coisa, e traduzir criaria a chance de
       divergirem. */
    motivo_exclusao = case
      when new.status = 'descartada' then
        case new.motivo_descarte
          when 'suprimido' then 'suprimido'
          when 'sem_base_legal' then 'sem_base_legal'
          when 'teto_conta' then 'teto_diario'
          when 'teto_thread' then 'teto_diario'
          when 'cooldown' then 'contatado_recente'
          else 'teto_diario'
        end
      else motivo_exclusao
    end,
    comunicacao_id = coalesce(new.comunicacao_id, comunicacao_id),
    conversa_id = coalesce(new.conversa_id, conversa_id),
    enviada_em = case when new.status = 'enviada' then now() else enviada_em end,
    erro = case when new.status in ('falhou', 'descartada') then new.erro else erro end
  where id = new.campanha_destinatario_id;

  return new;
end; $$;

create trigger mensagens_outbox_campanha_desfecho
  after update on public.mensagens_outbox
  for each row execute function public.campanha_propagar_desfecho();

/*
 * RESPOSTA ENCERRA A CAMPANHA (§4), e o gatilho é o LEDGER.
 *
 * Podia estar no webhook do WhatsApp, mas então o Gmail precisaria da sua cópia,
 * e o Resend da dele — três lugares para a mesma regra é a receita para que um
 * deles não seja atualizado. Toda entrada passa por `comunicacoes`; é o único
 * ponto que nenhum canal consegue contornar.
 */
create or replace function public.campanha_marcar_resposta()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_dest uuid;
  v_campanha uuid;
  v_status text;
begin
  if new.direcao <> 'entrada' then return new; end if;
  if new.conversa_id is null and new.contato_id is null then return new; end if;

  select d.id, d.campanha_id, d.status into v_dest, v_campanha, v_status
  from public.campanha_destinatarios d
  where d.status in ('enviada', 'agendada', 'pendente')
    and (
      (new.conversa_id is not null and d.conversa_id = new.conversa_id)
      or (new.contato_id is not null and d.contato_id = new.contato_id)
    )
  order by d.enviada_em desc nulls last
  limit 1;

  if v_dest is null then return new; end if;

  /*
   * Duas situações diferentes, e chamá-las pelo mesmo nome apagaria a mais
   * interessante das duas:
   *
   *   já ENVIAMOS e a pessoa respondeu  → `respondida`. Entra na taxa de
   *     resposta, que é a métrica que diz se a campanha presta.
   *
   *   ainda NÃO enviamos e a pessoa escreveu → `excluida` por conversa aberta.
   *     Contar isso como resposta inflaria a taxa com gente que respondeu a
   *     outra coisa — e mandar o disparo por cima de uma conversa que já começou
   *     é o erro que o §5 chama de "parar no primeiro sinal".
   */
  if v_status = 'enviada' then
    update public.campanha_destinatarios
      set status = 'respondida', respondida_em = now()
      where id = v_dest;
  else
    update public.campanha_destinatarios
      set status = 'excluida', motivo_exclusao = 'conversa_aberta'
      where id = v_dest;
  end if;

  if new.empresa_id is not null then
    insert into public.empresa_eventos (empresa_id, tipo, payload)
    values (new.empresa_id, 'campanha.destinatario_respondeu', jsonb_build_object(
      'campanha_id', v_campanha, 'destinatario_id', v_dest, 'comunicacao_id', new.id,
      'ja_enviada', v_status = 'enviada'
    ));
  end if;

  return new;
end; $$;

create trigger comunicacoes_campanha_resposta
  after insert on public.comunicacoes
  for each row execute function public.campanha_marcar_resposta();

-- =============================================================================
-- §3 — RLS e grants
-- =============================================================================

alter table public.campanhas             enable row level security;
alter table public.campanha_destinatarios enable row level security;
alter table public.campanhas_config      enable row level security;

revoke all on public.campanhas, public.campanha_destinatarios, public.campanhas_config
  from anon, authenticated;

grant select on public.campanhas, public.campanha_destinatarios, public.campanhas_config
  to authenticated;

/*
 * Leitura para quem tem Comercial ou Comunicação: a campanha nasce no Comercial,
 * mas quem cuida da saúde do canal vive na Comunicação, e um alerta de bounce que
 * só o Comercial enxerga é um alerta que chega tarde.
 *
 * NENHUMA das três ganha INSERT/UPDATE. Todo caminho de escrita é RPC — o que
 * torna "aprovar uma campanha sem simular" inexprimível em vez de desencorajado.
 */
create policy campanhas_select on public.campanhas
  for select to authenticated
  using (
    (select public.app_tem_modulo('comercial'))
    or (select public.app_tem_modulo('comunicacao'))
  );

create policy campanha_destinatarios_select on public.campanha_destinatarios
  for select to authenticated
  using (
    (select public.app_tem_modulo('comercial'))
    or (select public.app_tem_modulo('comunicacao'))
  );

create policy campanhas_config_select on public.campanhas_config
  for select to authenticated
  using (
    (select public.app_tem_modulo('comercial'))
    or (select public.app_tem_modulo('comunicacao'))
  );

-- =============================================================================
-- §4 — Views de leitura
-- =============================================================================

/*
 * A lista de campanhas com o placar já somado. Sem isto a tela faria uma
 * contagem por linha, que é o jeito mais barato de transformar dez campanhas em
 * cinquenta consultas.
 */
create view public.campanhas_lista
with (security_invoker = true) as
select
  c.id, c.nome, c.tipo, c.canal, c.status, c.objetivo,
  c.origem_publico, c.preset, c.segmento_id,
  c.ritmo_por_dia, c.inicio_em, c.criada_em, c.aprovada_em, c.concluida_em,
  c.vendedor_id,
  v.nome as vendedor_nome,
  s.nome as segmento_nome,
  u.nome as criada_por_nome,
  ua.nome as aprovada_por_nome,
  coalesce(d.total, 0) as total,
  coalesce(d.enviadas, 0) as enviadas,
  coalesce(d.respondidas, 0) as respondidas,
  coalesce(d.excluidas, 0) as excluidas,
  coalesce(d.falhas, 0) as falhas,
  coalesce(d.optouts, 0) as optouts,
  coalesce(d.pendentes, 0) as pendentes
from public.campanhas c
left join public.vendedores v on v.id = c.vendedor_id
left join public.segmentos s on s.id = c.segmento_id
left join public.usuarios u on u.id = c.criada_por
left join public.usuarios ua on ua.id = c.aprovada_por
left join lateral (
  select
    count(*)::int as total,
    /* `respondida` já foi enviada — contá-la fora de `enviadas` faria a taxa de
       resposta ser calculada sobre um denominador que encolhe quando o
       numerador cresce, e a métrica pioraria justamente quando a campanha
       melhorasse. */
    count(*) filter (where status in ('enviada', 'respondida'))::int as enviadas,
    count(*) filter (where status = 'respondida')::int as respondidas,
    count(*) filter (where status = 'excluida')::int as excluidas,
    count(*) filter (where status = 'falhou')::int as falhas,
    count(*) filter (where status = 'optout')::int as optouts,
    count(*) filter (where status in ('pendente', 'agendada'))::int as pendentes
  from public.campanha_destinatarios where campanha_id = c.id
) d on true;

comment on view public.campanhas_lista is
  'Campanha com o placar já somado. `enviadas` INCLUI as respondidas: uma resposta não '
  'desfaz o envio que a provocou.';

/* Os destinatários como a tela lê: com nome de empresa e de contato. */
create view public.campanha_destinatarios_lista
with (security_invoker = true) as
select
  d.id, d.campanha_id, d.empresa_id, d.contato_id, d.variante_id, d.passo,
  d.status, d.motivo_exclusao, d.agendada_para, d.enviada_em, d.respondida_em,
  d.conversa_id, d.comunicacao_id, d.erro, d.criado_em,
  e.razao_social as empresa_nome,
  e.cnpj as empresa_cnpj,
  ct.nome as contato_nome,
  ct.cargo as contato_cargo,
  ct.email as contato_email,
  ct.whatsapp as contato_whatsapp,
  cm.status_envio,
  cm.conta_remetente,
  cm.triagem
from public.campanha_destinatarios d
left join public.empresas e on e.id = d.empresa_id
left join public.contatos ct on ct.id = d.contato_id
left join public.comunicacoes cm on cm.id = d.comunicacao_id;

/*
 * O badge "em campanha X" do Company 360 (§8).
 *
 * Existe para responder uma pergunta antes de ela virar constrangimento: o
 * vendedor liga sem saber que a pessoa recebeu um disparo nosso hoje de manhã.
 * Só campanhas VIVAS e só destinatários que ainda estão no jogo — um contato de
 * campanha concluída há dois meses não é informação, é ruído no cabeçalho.
 */
create view public.contatos_em_campanha
with (security_invoker = true) as
select
  d.contato_id,
  d.empresa_id,
  d.campanha_id,
  c.nome as campanha_nome,
  c.canal,
  d.status as destinatario_status,
  d.agendada_para,
  d.enviada_em
from public.campanha_destinatarios d
join public.campanhas c on c.id = d.campanha_id
where c.status in ('agendada', 'executando', 'pausada')
  and d.status in ('pendente', 'agendada', 'enviada')
  and d.contato_id is not null;

grant select on
  public.campanhas_lista, public.campanha_destinatarios_lista, public.contatos_em_campanha
to authenticated;

-- =============================================================================
-- §5 — Escritas (RPC). Nenhuma tabela aceita INSERT/UPDATE direto.
-- =============================================================================

/*
 * Quem manda em campanha: gestor comercial. É a mesma régua de `app_atribuir_nf`
 * e do resto do Comercial — e aqui ela pesa mais, porque uma campanha errada não
 * estraga um card, estraga um domínio.
 */
create or replace function public.app_campanha_pode_gerir()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.app_gestor_comercial();
$$;
grant execute on function public.app_campanha_pode_gerir() to authenticated, service_role;

-- ─── Criar / editar (só em rascunho) ────────────────────────────────────────

create or replace function app_salvar_campanha(p jsonb)
returns campanhas language plpgsql security definer set search_path = '' as $$
declare
  v_c public.campanhas;
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_ator uuid := auth.uid();
begin
  if not public.app_campanha_pode_gerir() then
    raise exception 'Só gestores do Comercial criam e editam campanhas.' using errcode = '42501';
  end if;

  if v_id is not null then
    select * into v_c from public.campanhas where id = v_id for update;
    if v_c.id is null then
      raise exception 'Campanha não encontrada.' using errcode = 'P0002';
    end if;
    /*
     * Editar é privilégio do rascunho. Depois da aprovação, o público, o texto e
     * o ritmo são o que foi aprovado — mudar qualquer um deles depois faria a
     * assinatura de quem aprovou valer para uma campanha que ele não viu.
     * Para mudar, cancela-se e duplica-se.
     */
    if v_c.status not in ('rascunho', 'aguardando_aprovacao') then
      raise exception 'Campanha % não é mais editável. Cancele e duplique para mudar o conteúdo.', v_c.status
        using errcode = '42501';
    end if;
  end if;

  if v_id is null then
    insert into public.campanhas (
      nome, tipo, objetivo, canal, origem_publico, segmento_id, definicao_filtro,
      preset, preset_params, empresas_manuais, variantes, contas_remetentes, vendedor_id,
      inicio_em, ritmo_por_dia, respeitar_janela, excluir_contatados_dias,
      excluir_conversa_aberta, modo_agente_ao_responder, criada_por
    ) values (
      p ->> 'nome',
      p ->> 'tipo',
      nullif(p ->> 'objetivo', ''),
      p ->> 'canal',
      p ->> 'origem_publico',
      nullif(p ->> 'segmento_id', '')::uuid,
      case when p ? 'definicao_filtro' then p -> 'definicao_filtro' else null end,
      nullif(p ->> 'preset', ''),
      coalesce(p -> 'preset_params', '{}'::jsonb),
      coalesce(
        (select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p -> 'empresas_manuais', '[]'::jsonb)) x),
        '{}'::uuid[]
      ),
      coalesce(p -> 'variantes', '[]'::jsonb),
      coalesce(
        (select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p -> 'contas_remetentes', '[]'::jsonb)) x),
        '{}'::uuid[]
      ),
      nullif(p ->> 'vendedor_id', '')::uuid,
      nullif(p ->> 'inicio_em', '')::timestamptz,
      coalesce((p ->> 'ritmo_por_dia')::int, 50),
      coalesce((p ->> 'respeitar_janela')::boolean, true),
      coalesce((p ->> 'excluir_contatados_dias')::int, 14),
      coalesce((p ->> 'excluir_conversa_aberta')::boolean, true),
      coalesce(nullif(p ->> 'modo_agente_ao_responder', ''), 'sugestao'),
      v_ator
    )
    returning * into v_c;
  else
    update public.campanhas set
      nome = coalesce(p ->> 'nome', nome),
      tipo = coalesce(p ->> 'tipo', tipo),
      objetivo = case when p ? 'objetivo' then nullif(p ->> 'objetivo', '') else objetivo end,
      canal = coalesce(p ->> 'canal', canal),
      origem_publico = coalesce(p ->> 'origem_publico', origem_publico),
      segmento_id = case when p ? 'segmento_id' then nullif(p ->> 'segmento_id', '')::uuid else segmento_id end,
      definicao_filtro = case when p ? 'definicao_filtro' then p -> 'definicao_filtro' else definicao_filtro end,
      preset = case when p ? 'preset' then nullif(p ->> 'preset', '') else preset end,
      preset_params = coalesce(p -> 'preset_params', preset_params),
      empresas_manuais = case when p ? 'empresas_manuais' then coalesce(
        (select array_agg(x::uuid) from jsonb_array_elements_text(p -> 'empresas_manuais') x), '{}'::uuid[]
      ) else empresas_manuais end,
      variantes = coalesce(p -> 'variantes', variantes),
      contas_remetentes = case when p ? 'contas_remetentes' then coalesce(
        (select array_agg(x::uuid) from jsonb_array_elements_text(p -> 'contas_remetentes') x), '{}'::uuid[]
      ) else contas_remetentes end,
      vendedor_id = case when p ? 'vendedor_id' then nullif(p ->> 'vendedor_id', '')::uuid else vendedor_id end,
      inicio_em = case when p ? 'inicio_em' then nullif(p ->> 'inicio_em', '')::timestamptz else inicio_em end,
      ritmo_por_dia = coalesce((p ->> 'ritmo_por_dia')::int, ritmo_por_dia),
      respeitar_janela = coalesce((p ->> 'respeitar_janela')::boolean, respeitar_janela),
      excluir_contatados_dias = coalesce((p ->> 'excluir_contatados_dias')::int, excluir_contatados_dias),
      excluir_conversa_aberta = coalesce((p ->> 'excluir_conversa_aberta')::boolean, excluir_conversa_aberta),
      modo_agente_ao_responder = coalesce(nullif(p ->> 'modo_agente_ao_responder', ''), modo_agente_ao_responder),
      /* Qualquer edição invalida a simulação: aprovar sobre um dry-run de um
         público que já mudou é exatamente o que o §3 existe para impedir. */
      simulacao = null,
      simulada_em = null,
      status = 'rascunho'
    where id = v_id
    returning * into v_c;
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'campanha.salva', 'campanhas', v_c.id::text, p);

  return v_c;
end; $$;

comment on function app_salvar_campanha(jsonb) is
  'Cria/edita campanha. Editar só em rascunho, e QUALQUER edição zera a simulação — '
  'aprovar sobre um dry-run vencido é o que o §3 existe para impedir.';

-- ─── Guardar a simulação (worker) ───────────────────────────────────────────

create or replace function app_campanha_registrar_simulacao(p jsonb)
returns campanhas language plpgsql security definer set search_path = '' as $$
declare
  v_c public.campanhas;
begin
  /* Só o worker — e a régua é o GRANT no fim do bloco, não um teste aqui. É o
     mesmo desenho de `app__segredo_vault`: quem não pode chamar não chega a
     executar a primeira linha, o que é mais forte do que uma checagem que
     alguém pode esquecer de repetir na próxima função. */
  update public.campanhas set
    simulacao = p -> 'simulacao',
    simulada_em = now(),
    status = case when status = 'rascunho' then 'aguardando_aprovacao' else status end
  where id = (p ->> 'campanha_id')::uuid
  returning * into v_c;

  if v_c.id is null then
    raise exception 'Campanha não encontrada.' using errcode = 'P0002';
  end if;
  return v_c;
end; $$;

revoke all on function app_campanha_registrar_simulacao(jsonb) from public, anon, authenticated;
grant execute on function app_campanha_registrar_simulacao(jsonb) to service_role;

-- ─── Aprovar ────────────────────────────────────────────────────────────────

create or replace function app_aprovar_campanha(p jsonb)
returns campanhas language plpgsql security definer set search_path = '' as $$
declare
  v_c public.campanhas;
  v_ator uuid := auth.uid();
  v_ativas int;
  v_max int;
begin
  if not public.app_campanha_pode_gerir() then
    raise exception 'Só gestores do Comercial aprovam campanhas.' using errcode = '42501';
  end if;

  select * into v_c from public.campanhas where id = (p ->> 'id')::uuid for update;
  if v_c.id is null then
    raise exception 'Campanha não encontrada.' using errcode = 'P0002';
  end if;
  if v_c.status <> 'aguardando_aprovacao' then
    raise exception 'Só uma campanha simulada e aguardando aprovação pode ser aprovada.'
      using errcode = '42501';
  end if;
  /* A simulação obrigatória do §3, dita como constraint e não como convenção:
     sem retrato do público, não há aprovação. */
  if v_c.simulacao is null then
    raise exception 'Rode a simulação antes de aprovar.' using errcode = '23514';
  end if;
  if coalesce((v_c.simulacao ->> 'elegiveis')::int, 0) = 0 then
    raise exception 'A simulação não encontrou nenhum destinatário elegível.' using errcode = '23514';
  end if;

  select coalesce((valor ->> 'max_campanhas_ativas')::int, 3) into v_max
  from public.campanhas_config where chave = 'limites';

  select count(*)::int into v_ativas from public.campanhas
  where status in ('agendada', 'executando') and id <> v_c.id;

  if v_ativas >= coalesce(v_max, 3) then
    raise exception
      'Já há % campanha(s) ativa(s), e o teto é %. Pause ou conclua uma antes de aprovar esta.',
      v_ativas, v_max using errcode = '23514';
  end if;

  update public.campanhas set
    status = 'agendada',
    aprovada_por = v_ator,
    aprovada_em = now(),
    inicio_em = coalesce(inicio_em, now())
  where id = v_c.id
  returning * into v_c;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'campanha.aprovada', 'campanhas', v_c.id::text,
    jsonb_build_object('simulacao', v_c.simulacao));

  return v_c;
end; $$;

-- ─── Pausar / retomar / cancelar ────────────────────────────────────────────

create or replace function app_pausar_campanha(p jsonb)
returns campanhas language plpgsql security definer set search_path = '' as $$
declare
  v_c public.campanhas;
  v_ator uuid := auth.uid();
begin
  if not public.app_campanha_pode_gerir() then
    raise exception 'Só gestores do Comercial pausam campanhas.' using errcode = '42501';
  end if;

  update public.campanhas set
    status = 'pausada',
    pausa_motivo = nullif(p ->> 'motivo', '')
  where id = (p ->> 'id')::uuid and status in ('agendada', 'executando')
  returning * into v_c;

  if v_c.id is null then
    raise exception 'Só uma campanha agendada ou executando pode ser pausada.' using errcode = '42501';
  end if;

  /* O que já foi para a fila e ainda não saiu volta atrás. Pausar e deixar a
     fila drenar seria pausar amanhã, e quem aperta "pausar" está justamente
     tentando impedir o que sairia daqui a pouco. */
  update public.mensagens_outbox set status = 'descartada', motivo_descarte = 'campanha_pausada'
  where campanha_id = v_c.id and status in ('pendente_envio', 'aprovada');

  update public.campanha_destinatarios set status = 'pendente', agendada_para = null
  where campanha_id = v_c.id and status = 'agendada';

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'campanha.pausada', 'campanhas', v_c.id::text, p);

  return v_c;
end; $$;

create or replace function app_retomar_campanha(p jsonb)
returns campanhas language plpgsql security definer set search_path = '' as $$
declare
  v_c public.campanhas;
  v_ator uuid := auth.uid();
begin
  if not public.app_campanha_pode_gerir() then
    raise exception 'Só gestores do Comercial retomam campanhas.' using errcode = '42501';
  end if;

  update public.campanhas set status = 'agendada', pausa_motivo = null
  where id = (p ->> 'id')::uuid and status = 'pausada'
  returning * into v_c;

  if v_c.id is null then
    raise exception 'Só uma campanha pausada pode ser retomada.' using errcode = '42501';
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'campanha.retomada', 'campanhas', v_c.id::text, p);

  return v_c;
end; $$;

create or replace function app_cancelar_campanha(p jsonb)
returns campanhas language plpgsql security definer set search_path = '' as $$
declare
  v_c public.campanhas;
  v_ator uuid := auth.uid();
begin
  if not public.app_campanha_pode_gerir() then
    raise exception 'Só gestores do Comercial cancelam campanhas.' using errcode = '42501';
  end if;

  update public.campanhas set
    status = 'cancelada',
    concluida_em = now(),
    pausa_motivo = nullif(p ->> 'motivo', '')
  where id = (p ->> 'id')::uuid and status <> 'concluida'
  returning * into v_c;

  if v_c.id is null then
    raise exception 'Campanha não encontrada, ou já concluída.' using errcode = 'P0002';
  end if;

  update public.mensagens_outbox set status = 'descartada', motivo_descarte = 'campanha_cancelada'
  where campanha_id = v_c.id and status in ('pendente_envio', 'aprovada');

  /* O que não saiu não sai (§4). Quem já recebeu continua na história — cancelar
     uma campanha não desfaz a mensagem que a pessoa leu. */
  update public.campanha_destinatarios
    set status = 'excluida', motivo_exclusao = 'cancelada', agendada_para = null
  where campanha_id = v_c.id and status in ('pendente', 'agendada');

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'campanha.cancelada', 'campanhas', v_c.id::text, p);

  return v_c;
end; $$;

-- ─── Estado, para o worker ──────────────────────────────────────────────────

create or replace function app_campanha_definir_status(p jsonb)
returns campanhas language plpgsql security definer set search_path = '' as $$
declare
  v_c public.campanhas;
  v_status text := p ->> 'status';
begin
  if v_status not in ('executando', 'concluida') then
    raise exception 'Estado inválido para o executor: %.', v_status using errcode = '23514';
  end if;

  update public.campanhas set
    status = v_status,
    concluida_em = case when v_status = 'concluida' then now() else concluida_em end
  where id = (p ->> 'campanha_id')::uuid
    /* Pausada e cancelada NÃO voltam a executar por decisão de job. O executor
       pode concluir o que já estava rodando, nunca ressuscitar o que uma pessoa
       parou — essa é a diferença entre um controle e uma sugestão. */
    and status in ('agendada', 'executando')
  returning * into v_c;

  return v_c;
end; $$;

revoke all on function app_campanha_definir_status(jsonb) from public, anon, authenticated;
grant execute on function app_campanha_definir_status(jsonb) to service_role;

grant execute on function
  app_salvar_campanha(jsonb), app_aprovar_campanha(jsonb), app_pausar_campanha(jsonb),
  app_retomar_campanha(jsonb), app_cancelar_campanha(jsonb)
to authenticated, service_role;

-- =============================================================================
-- §6 — Métricas e atribuição
-- =============================================================================

/*
 * O painel de uma campanha, calculado sob demanda.
 *
 * Não é view materializada nem tabela de agregado: quem abre a tela quer o
 * número de AGORA, e uma campanha executando muda a cada minuto. O custo é uma
 * função com sete consultas; o benefício é não existir um segundo lugar onde o
 * número pode estar velho.
 *
 * `entregues` e `falhas` vêm do LEDGER e não do destinatário, porque quem sabe
 * se a mensagem chegou é o webhook do provedor — e ele escreve em `comunicacoes`.
 */
create or replace function app_campanha_metricas(p jsonb)
returns jsonb language plpgsql security definer stable set search_path = '' as $$
declare
  v_id uuid := (p ->> 'campanha_id')::uuid;
  v_c public.campanhas;
  v_cfg jsonb;
  v_resumo jsonb;
  v_variantes jsonb;
  v_contas jsonb;
  v_intencoes jsonb;
  v_exclusoes jsonb;
  v_funil jsonb;
  v_enviadas int;
  v_optouts int;
  v_bounces int;
begin
  if not (public.app_tem_modulo('comercial') or public.app_tem_modulo('comunicacao')) then
    raise exception 'Sem acesso a campanhas.' using errcode = '42501';
  end if;

  select * into v_c from public.campanhas where id = v_id;
  if v_c.id is null then
    raise exception 'Campanha não encontrada.' using errcode = 'P0002';
  end if;

  select valor into v_cfg from public.campanhas_config where chave = 'limites';

  select jsonb_build_object(
    'total', count(*)::int,
    'enviadas', count(*) filter (where d.status in ('enviada', 'respondida'))::int,
    'entregues', count(*) filter (where cm.status_envio in ('entregue', 'lida'))::int,
    'falhas', count(*) filter (where d.status = 'falhou' or cm.status_envio = 'falhou')::int,
    'respondidas', count(*) filter (where d.status = 'respondida')::int,
    'optouts', count(*) filter (where d.status = 'optout')::int,
    'pendentes', count(*) filter (where d.status in ('pendente', 'agendada'))::int,
    'excluidas', count(*) filter (where d.status = 'excluida')::int
  ) into v_resumo
  from public.campanha_destinatarios d
  left join public.comunicacoes cm on cm.id = d.comunicacao_id
  where d.campanha_id = v_id;

  v_enviadas := coalesce((v_resumo ->> 'enviadas')::int, 0);
  v_optouts := coalesce((v_resumo ->> 'optouts')::int, 0);
  v_bounces := coalesce((v_resumo ->> 'falhas')::int, 0);

  select coalesce(jsonb_agg(x order by x ->> 'variante_id'), '[]'::jsonb) into v_variantes
  from (
    select jsonb_build_object(
      'variante_id', coalesce(d.variante_id, '—'),
      'enviadas', count(*) filter (where d.status in ('enviada', 'respondida'))::int,
      'respondidas', count(*) filter (where d.status = 'respondida')::int,
      'optouts', count(*) filter (where d.status = 'optout')::int
    ) as x
    from public.campanha_destinatarios d
    where d.campanha_id = v_id
    group by coalesce(d.variante_id, '—')
  ) t;

  /* Comparar contas ENTRE SI dentro da mesma campanha é o que isola a variável:
     mesmo texto, mesmo público, mesma janela. Uma conta muito abaixo das irmãs
     é a conta, não a mensagem. */
  select coalesce(jsonb_agg(x order by x ->> 'conta'), '[]'::jsonb) into v_contas
  from (
    select jsonb_build_object(
      'conta', coalesce(cm.conta_remetente, '—'),
      'enviadas', count(*)::int,
      'entregues', count(*) filter (where cm.status_envio in ('entregue', 'lida'))::int,
      'falhas', count(*) filter (where cm.status_envio = 'falhou')::int
    ) as x
    from public.campanha_destinatarios d
    join public.comunicacoes cm on cm.id = d.comunicacao_id
    where d.campanha_id = v_id
    group by coalesce(cm.conta_remetente, '—')
  ) t;

  select coalesce(jsonb_object_agg(intencao, n), '{}'::jsonb) into v_intencoes
  from (
    select coalesce(cm.triagem ->> 'intencao', 'sem_triagem') as intencao, count(*)::int as n
    from public.campanha_destinatarios d
    join public.comunicacoes cm
      on cm.conversa_id = d.conversa_id
     and cm.direcao = 'entrada'
     and cm.criado_em >= d.enviada_em
    where d.campanha_id = v_id and d.status = 'respondida'
    group by 1
  ) t;

  select coalesce(jsonb_object_agg(motivo, n), '{}'::jsonb) into v_exclusoes
  from (
    select coalesce(motivo_exclusao, 'sem_motivo') as motivo, count(*)::int as n
    from public.campanha_destinatarios
    where campanha_id = v_id and status = 'excluida'
    group by 1
  ) t;

  /*
   * ATRIBUIÇÃO POR JANELA, e é honesto dizer o que isso é: correlação temporal,
   * não prova de causa. A empresa recebeu a mensagem e DEPOIS avançou; pode ter
   * avançado por outro motivo. Um modelo de atribuição de verdade precisaria de
   * grupo de controle, e inventar precisão aqui seria pior que declarar a régua.
   */
  select jsonb_build_object(
    'reunioes_agendadas', count(*) filter (where l.tem_reuniao)::int,
    'vendas_abertas', count(*) filter (where l.tem_venda)::int,
    'ganhos', count(*) filter (where l.tem_ganho)::int,
    'valor_esperado_mensal', coalesce(sum(l.valor) filter (where l.tem_reuniao), 0)
  ) into v_funil
  from (
    select
      d.empresa_id,
      e.valor_esperado_mensal as valor,
      exists (
        select 1 from public.sdr_leads sl
        where sl.empresa_id = d.empresa_id
          and sl.reuniao_em is not null
          and sl.atualizado_em >= d.enviada_em
      ) as tem_reuniao,
      exists (
        select 1 from public.vendas v
        where v.empresa_id = d.empresa_id and v.criada_em >= d.enviada_em
      ) as tem_venda,
      exists (
        select 1 from public.vendas v
        where v.empresa_id = d.empresa_id and v.estagio = 'ganho'
          and v.atualizada_em >= d.enviada_em
      ) as tem_ganho
    from public.campanha_destinatarios d
    join public.empresas e on e.id = d.empresa_id
    where d.campanha_id = v_id and d.enviada_em is not null
  ) l;

  return jsonb_build_object(
    'campanha', jsonb_build_object(
      'id', v_c.id, 'nome', v_c.nome, 'status', v_c.status, 'canal', v_c.canal,
      'tipo', v_c.tipo, 'ritmo_por_dia', v_c.ritmo_por_dia, 'inicio_em', v_c.inicio_em
    ),
    'resumo', v_resumo,
    'taxa_resposta_pct', case when v_enviadas > 0
      then round(100.0 * coalesce((v_resumo ->> 'respondidas')::int, 0) / v_enviadas, 1) else null end,
    'por_variante', v_variantes,
    'por_conta', v_contas,
    'por_intencao', v_intencoes,
    'exclusoes', v_exclusoes,
    'funil', v_funil,
    'saude', jsonb_build_object(
      'optout_pct', case when v_enviadas > 0 then round(100.0 * v_optouts / v_enviadas, 2) else null end,
      'bounce_pct', case when v_enviadas > 0 then round(100.0 * v_bounces / v_enviadas, 2) else null end,
      'limiar_optout_pct', coalesce((v_cfg ->> 'alerta_optout_pct')::numeric, 2.0),
      'limiar_bounce_pct', coalesce((v_cfg ->> 'alerta_bounce_pct')::numeric, 5.0),
      'minimo_para_alertar', coalesce((v_cfg ->> 'minimo_para_alertar')::int, 50),
      -- 1 opt-out em 3 enviadas é 33% e não significa nada. Sem piso de amostra,
      -- o primeiro alerta chega antes da primeira campanha de verdade e ensina o
      -- time a ignorar alertas.
      'amostra_suficiente', v_enviadas >= coalesce((v_cfg ->> 'minimo_para_alertar')::int, 50)
    )
  );
end; $$;

comment on function app_campanha_metricas(jsonb) is
  'Painel de uma campanha. O funil é atribuição POR JANELA: a empresa recebeu e depois '
  'avançou. É correlação temporal, não prova de causa — sem grupo de controle não dá '
  'para afirmar mais que isso.';

grant execute on function app_campanha_metricas(jsonb) to authenticated, service_role;
