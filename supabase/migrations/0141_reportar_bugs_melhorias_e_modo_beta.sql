-- ============================================================================
-- 0141 — Reportar bugs & melhorias + modo beta (Prompt 04m)
--
-- ── NÃO É UM MÓDULO, E ISSO DECIDE A RLS ────────────────────────────────────
-- O botão de reportar fica na barra de topo, em TODA a aplicação. Quem escreve
-- um report é qualquer usuário ativo — inclusive um perfil que não tem módulo
-- nenhum liberado, que é justamente o perfil com mais motivo para dizer que a
-- tela está quebrada. Por isso a permissão de escrita é `app_usuario_ativo()`, e
-- não `app_tem_modulo(...)`: amarrar o feedback a um módulo faria a ferramenta
-- calar exatamente quem mais precisa dela.
--
-- Ler é o contrário: cada um vê o que escreveu, e o admin vê tudo (§3).
--
-- ── STATUS É POR TIPO, E O BANCO SABE DISSO ─────────────────────────────────
-- São duas esteiras, não uma com dez estados:
--   bug       aberto · em_analise · em_correcao · resolvido · nao_procede · duplicado
--   melhoria  aberto · em_analise · planejado · em_desenvolvimento · entregue ·
--             nao_planejado · duplicado
-- Um CHECK único com a união dos dez deixaria o painel oferecer "entregue" para
-- um bug — uma transição que não quer dizer nada e que ninguém consegue desfazer
-- sem explicar. O CHECK aqui é CRUZADO: o status tem de pertencer à esteira do
-- tipo. É a mesma régua do TypeScript em packages/core/src/reports/schemas.ts, e
-- as duas precisam concordar porque quem descobre a divergência é o usuário.
--
-- ── TODA ESCRITA POR RPC ────────────────────────────────────────────────────
-- `authenticated` recebe SELECT e nada mais. Não há policy de INSERT/UPDATE
-- porque não há grant de INSERT/UPDATE: criar, comentar e mudar status passam
-- por funções SECURITY DEFINER que autorizam por dentro. Isso vale sobretudo
-- para `contexto`, que é jsonb vindo do cliente — a RPC monta o objeto a partir
-- de uma lista fechada de chaves, então um cliente que mandar `{"token": "..."}`
-- junto vê o campo ser descartado, e não gravado.
--
-- ── DEFAULT PRIVILEGES ──────────────────────────────────────────────────────
-- O Supabase concede ALL a anon/authenticated em toda tabela nova de `public`.
-- Cada tabela abaixo revoga tudo explicitamente antes de conceder o que precisa.
-- ============================================================================

-- ─── §1 As três tabelas ─────────────────────────────────────────────────────

create table reports (
  id uuid primary key default gen_random_uuid(),
  -- Identificador curto e humano. "#42" é o que a pessoa fala em voz alta e o
  -- que aparece no toast, na notificação e no assunto da conversa; o uuid é o
  -- que o sistema usa. Os dois existem porque servem a interlocutores diferentes.
  numero serial not null unique,
  tipo text not null check (tipo in ('bug', 'melhoria')),
  titulo text not null check (length(btrim(titulo)) between 3 and 140),
  descricao text not null check (length(btrim(descricao)) between 5 and 5000),
  status text not null default 'aberto',
  prioridade text check (prioridade in ('baixa', 'media', 'alta', 'critica')),
  duplicado_de uuid references reports (id) on delete set null,

  -- Contexto capturado automaticamente (§2). Chaves fechadas, montadas pela RPC.
  -- O teto de tamanho não é paranoia de espaço: é o que impede alguém de usar o
  -- campo como canal para despejar um dump inteiro de estado do cliente.
  contexto jsonb not null default '{}'::jsonb
    check (length(contexto::text) <= 4000),

  -- Caminho no bucket PRIVADO `report-anexos`, não uma URL. Uma URL pública num
  -- print de tela seria um vazamento de dado de cliente com link permanente.
  anexo_url text,

  /*
   * SEM `on delete cascade`, de propósito.
   *
   * Um report é registro do PRODUTO, não do usuário: o bug que a pessoa descreveu
   * continua existindo depois de ela sair da empresa. Com cascade, apagar uma
   * linha de `usuarios` levaria junto os reports abertos que ela escreveu — em
   * silêncio, sem erro nenhum. `no action` faz a exclusão FALHAR e pedir uma
   * decisão explícita, que é a resposta certa: a alternativa seria decidir
   * sozinho, e a decisão silenciosa é apagar prova.
   *
   * (Hoje a plataforma DESATIVA usuários e nunca os apaga. Isto fecha o caminho,
   * não conserta um vazamento em curso.)
   */
  criado_por uuid not null references usuarios (id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  resolvido_em timestamptz,

  -- O status tem de pertencer à esteira do tipo.
  constraint reports_status_do_tipo check (
    (tipo = 'bug' and status in (
      'aberto', 'em_analise', 'em_correcao', 'resolvido', 'nao_procede', 'duplicado'))
    or
    (tipo = 'melhoria' and status in (
      'aberto', 'em_analise', 'planejado', 'em_desenvolvimento', 'entregue',
      'nao_planejado', 'duplicado'))
  ),

  -- "Duplicado" sem apontar para o original é a informação pela metade: diz que
  -- não vamos tratar e não diz onde a conversa continua. Os dois lados juntos.
  constraint reports_duplicado_aponta check (
    (status = 'duplicado') = (duplicado_de is not null)
  ),
  constraint reports_duplicado_nao_e_ele_mesmo check (duplicado_de is null or duplicado_de <> id)
);

create index reports_status_idx on reports (status, criado_em desc);
create index reports_autor_idx on reports (criado_por, criado_em desc);
-- O painel conta "resolvidos no mês" e a lista filtra por tipo; os dois varrem
-- por essas colunas e nada mais.
create index reports_tipo_idx on reports (tipo, criado_em desc);
create index reports_resolvidos_idx on reports (resolvido_em desc) where resolvido_em is not null;

create trigger reports_atualizado_em
  before update on reports
  for each row execute function set_atualizado_em();

create table report_comentarios (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports (id) on delete cascade,
  -- Idem `reports.criado_por`: o comentário de um admin numa thread de outra
  -- pessoa não pode sumir porque a conta dele foi apagada, deixando um buraco na
  -- conversa. A cascata que fica é a de `report_id`, logo acima: um comentário
  -- existe POR CAUSA do report, e sem ele não é nada.
  autor_id uuid not null references usuarios (id),
  texto text not null check (length(btrim(texto)) between 1 and 5000),
  -- `interno` é o comentário que o autor do report NUNCA vê. Ele não é escondido
  -- na tela: a policy de SELECT abaixo não entrega a linha. Esconder no cliente
  -- seria mandar o texto para o navegador de quem não pode lê-lo.
  interno boolean not null default false,
  criado_em timestamptz not null default now()
);

create index report_comentarios_report_idx on report_comentarios (report_id, criado_em);

create table report_historico (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports (id) on delete cascade,
  status_anterior text,
  status_novo text not null,
  alterado_por uuid not null references usuarios (id),
  alterado_em timestamptz not null default now()
);

create index report_historico_report_idx on report_historico (report_id, alterado_em);

comment on table reports is
  'Bugs e melhorias reportados de dentro da aplicação (04m). Não pertence a módulo '
  'nenhum: escrever é direito de qualquer usuário ativo, ler é do autor e do admin.';
comment on column reports.contexto is
  'Rota, URL, plataforma, user agent, viewport e versão — capturados sem o usuário '
  'digitar. Chaves fechadas, montadas por app_report_criar: o jsonb do cliente nunca '
  'é gravado como veio.';
comment on column reports.anexo_url is
  'CAMINHO no bucket privado report-anexos ({usuario_id}/{arquivo}), nunca uma URL '
  'pública. A leitura sai por URL assinada de validade curta.';

-- ─── RLS ────────────────────────────────────────────────────────────────────
alter table reports enable row level security;
alter table report_comentarios enable row level security;
alter table report_historico enable row level security;

/*
 * `(select ...)` em volta das funções STABLE não é enfeite: sem ele o Postgres
 * chama `app_is_admin()` UMA VEZ POR LINHA VARRIDA, e a lista do painel varre a
 * tabela inteira. Com o select vira InitPlan — uma chamada por consulta.
 */
create policy reports_select on reports
  for select to authenticated
  using (criado_por = (select auth.uid()) or (select app_is_admin()));

create policy report_comentarios_select on report_comentarios
  for select to authenticated
  using (
    (select app_is_admin())
    or (
      not interno
      and exists (
        select 1 from reports r
        where r.id = report_comentarios.report_id
          and r.criado_por = (select auth.uid())
      )
    )
  );

create policy report_historico_select on report_historico
  for select to authenticated
  using (
    (select app_is_admin())
    or exists (
      select 1 from reports r
      where r.id = report_historico.report_id
        and r.criado_por = (select auth.uid())
    )
  );

revoke all on reports, report_comentarios, report_historico from anon, authenticated;
grant select on reports, report_comentarios, report_historico to authenticated;
-- A sequência de `numero` é do serial: sem escrita direta, ninguém precisa dela.
revoke all on sequence reports_numero_seq from anon, authenticated;

-- ─── §2 Criar ───────────────────────────────────────────────────────────────
--
-- O `contexto` é montado aqui a partir de SEIS chaves e nada mais. O cliente
-- manda um jsonb inteiro e a função escolhe o que entra: é a diferença entre
-- "campo de contexto" e "campo livre no banco preenchido pelo navegador".
create or replace function app_report_criar(p jsonb)
returns public.reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_report public.reports;
  v_contexto jsonb;
  v_anexo text := nullif(btrim(p ->> 'anexo_url'), '');
  v_tipo text := p ->> 'tipo';
begin
  if not public.app_usuario_ativo() then
    raise exception 'Sessão inválida.' using errcode = '42501';
  end if;

  if v_tipo is null or v_tipo not in ('bug', 'melhoria') then
    raise exception 'Escolha se é um bug ou uma melhoria.' using errcode = '22023';
  end if;

  -- O anexo é aceito só dentro da pasta de quem envia. A policy do Storage já
  -- exige isso na hora do upload; repetir aqui impede que alguém registre no
  -- report o caminho de um arquivo de outra pessoa e ganhe uma URL assinada.
  if v_anexo is not null and v_anexo !~ ('^' || v_ator::text || '/') then
    raise exception 'Anexo fora da sua pasta.' using errcode = '42501';
  end if;

  v_contexto := jsonb_strip_nulls(jsonb_build_object(
    'rota',       left(nullif(btrim(p #>> '{contexto,rota}'), ''), 200),
    'url',        left(nullif(btrim(p #>> '{contexto,url}'), ''), 500),
    'plataforma', nullif(btrim(p #>> '{contexto,plataforma}'), ''),
    'user_agent', left(nullif(btrim(p #>> '{contexto,user_agent}'), ''), 500),
    'viewport',   left(nullif(btrim(p #>> '{contexto,viewport}'), ''), 40),
    'app_versao', left(nullif(btrim(p #>> '{contexto,app_versao}'), ''), 40)
  ));

  insert into public.reports (tipo, titulo, descricao, contexto, anexo_url, criado_por)
  values (
    v_tipo,
    btrim(p ->> 'titulo'),
    btrim(p ->> 'descricao'),
    v_contexto,
    v_anexo,
    v_ator
  )
  returning * into v_report;

  insert into public.report_historico (report_id, status_anterior, status_novo, alterado_por)
  values (v_report.id, null, v_report.status, v_ator);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'report.criado', 'reports', v_report.id::text,
    jsonb_build_object('numero', v_report.numero, 'tipo', v_report.tipo));

  /*
   * O sino dos admins sai daqui, pelo mesmo fan-out de todo evento do sistema
   * (`notificacao_regras` + trigger da 0003/0014).
   *
   * O RESUMO NÃO CARREGA O TÍTULO DO REPORT, DE PROPÓSITO. `empresa_eventos` é
   * legível por quem tem o módulo `empresas` — quase todo mundo —, enquanto o
   * report em si só o autor e o admin leem (§3). Copiar o título para o evento
   * publicaria para a empresa inteira exatamente o texto que a policy acima
   * acabou de restringir. O sino é um ponteiro; o conteúdo está na página.
   *
   * Sem push: um report novo é trabalho de triagem, não interrupção de tela de
   * bloqueio. Push existe para o AUTOR, quando o report dele anda (§4).
   */
  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (null, 'report.criado',
    jsonb_build_object(
      'titulo', case when v_tipo = 'bug' then 'Novo report de bug' else 'Nova sugestão de melhoria' end,
      'resumo', 'Report #' || v_report.numero || ' aguardando triagem.',
      'url', '/admin/reports?r=' || v_report.id::text,
      'report_id', v_report.id, 'numero', v_report.numero, 'tipo', v_tipo),
    v_ator);

  return v_report;
end;
$$;

-- ─── §3 Triagem: status, prioridade, duplicado ──────────────────────────────
--
-- Devolve jsonb (e não a linha) porque quem chama precisa de UMA coisa que não
-- está na linha: se o status mudou de fato. Notificar o autor a cada clique de
-- "salvar" que não mudou nada é como um sino perde o sentido.
create or replace function app_report_atualizar(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_antes public.reports;
  v_depois public.reports;
  v_status text := nullif(btrim(p ->> 'status'), '');
  v_prioridade text;
  v_duplicado uuid := nullif(p ->> 'duplicado_de', '')::uuid;
  v_mudou boolean;
  v_terminais constant text[] :=
    array['resolvido', 'entregue', 'nao_procede', 'nao_planejado', 'duplicado'];
begin
  if not public.app_is_admin() then
    raise exception 'Somente a administração altera um report.' using errcode = '42501';
  end if;

  select * into v_antes from public.reports where id = (p ->> 'report_id')::uuid;
  if v_antes.id is null then
    raise exception 'Report não encontrado.' using errcode = 'P0002';
  end if;

  v_status := coalesce(v_status, v_antes.status);

  -- O CHECK cruzado da tabela já barra "bug entregue", mas barra com um erro de
  -- constraint — texto de banco de dados na cara de quem clicou. A esteira é
  -- conferida aqui para o recado ser em português e dizer o que fazer.
  if not v_status = any(case v_antes.tipo
        when 'bug' then array['aberto', 'em_analise', 'em_correcao', 'resolvido', 'nao_procede', 'duplicado']
        else array['aberto', 'em_analise', 'planejado', 'em_desenvolvimento', 'entregue', 'nao_planejado', 'duplicado']
      end) then
    raise exception '"%" não é um status de %.', v_status,
      case v_antes.tipo when 'bug' then 'bug' else 'melhoria' end
      using errcode = '22023';
  end if;

  -- `prioridade` distingue "não mandaram" de "mandaram vazio": a chave ausente
  -- mantém o que estava; a chave com null LIMPA. Sem essa distinção não haveria
  -- como desfazer uma prioridade posta por engano.
  v_prioridade := case
    when p ? 'prioridade' then nullif(btrim(p ->> 'prioridade'), '')
    else v_antes.prioridade
  end;

  if v_status = 'duplicado' then
    if v_duplicado is null then
      raise exception 'Marcar como duplicado exige apontar o report original.' using errcode = '22023';
    end if;
    if v_duplicado = v_antes.id then
      raise exception 'Um report não duplica a si mesmo.' using errcode = '22023';
    end if;
    if not exists (select 1 from public.reports r where r.id = v_duplicado) then
      raise exception 'O report original não existe.' using errcode = 'P0002';
    end if;
  else
    -- Sair de "duplicado" desfaz o vínculo. O CHECK exige os dois juntos, e
    -- deixar o ponteiro para trás faria a tela mostrar um original para um
    -- report que voltou a ser tratado por conta própria.
    v_duplicado := null;
  end if;

  update public.reports
     set status = v_status,
         prioridade = v_prioridade,
         duplicado_de = v_duplicado,
         resolvido_em = case
           when v_status = any(v_terminais)
             -- Já era terminal: preserva a data original. Trocar "resolvido" por
             -- "entregue" não é resolver de novo.
             then coalesce(v_antes.resolvido_em, now())
           else null
         end
   where id = v_antes.id
   returning * into v_depois;

  v_mudou := v_depois.status is distinct from v_antes.status;

  if v_mudou then
    insert into public.report_historico (report_id, status_anterior, status_novo, alterado_por)
    values (v_depois.id, v_antes.status, v_depois.status, v_ator);
  end if;

  /*
   * A AÇÃO CARREGA A DISTINÇÃO. A pergunta que se faz ao audit_log meses depois é
   * "quem mudou o status deste report, e quando" — com tudo gravado sob um nome
   * só, respondê-la exigiria abrir o payload de cada linha para descobrir se
   * aquela era a certa. O nome é o do vocabulário do §4.
   */
  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator,
    case when v_mudou then 'report.status_alterado' else 'report.atualizado' end,
    'reports', v_depois.id::text,
    jsonb_build_object(
      'numero', v_depois.numero,
      'status_anterior', v_antes.status, 'status_novo', v_depois.status,
      'prioridade_anterior', v_antes.prioridade, 'prioridade_nova', v_depois.prioridade,
      'duplicado_de', v_depois.duplicado_de));

  return jsonb_build_object(
    'report_id', v_depois.id,
    'numero', v_depois.numero,
    'tipo', v_depois.tipo,
    'autor_id', v_depois.criado_por,
    'status_anterior', v_antes.status,
    'status', v_depois.status,
    'prioridade', v_depois.prioridade,
    'mudou_status', v_mudou);
end;
$$;

-- ─── §3/§4 Comentar ─────────────────────────────────────────────────────────
--
-- Duas portas, e é isso que faz disto uma THREAD e não um mural: o admin comenta
-- em qualquer report; o autor comenta no dele. Um canal onde só um lado escreve
-- transforma "qual navegador você usou?" numa pergunta sem resposta possível.
--
-- `interno` é privilégio de admin, e a função IGNORA a flag vinda do autor em vez
-- de recusar: quem não pode marcar como interno também não deveria descobrir que
-- a marca existe.
create or replace function app_report_comentar(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_admin boolean := public.app_is_admin();
  v_report public.reports;
  v_comentario public.report_comentarios;
  v_interno boolean;
  v_texto text := btrim(p ->> 'texto');
begin
  if not public.app_usuario_ativo() then
    raise exception 'Sessão inválida.' using errcode = '42501';
  end if;

  select * into v_report from public.reports where id = (p ->> 'report_id')::uuid;
  if v_report.id is null then
    raise exception 'Report não encontrado.' using errcode = 'P0002';
  end if;

  if not v_admin and v_report.criado_por <> v_ator then
    raise exception 'Sem acesso a este report.' using errcode = '42501';
  end if;

  if v_texto is null or length(v_texto) = 0 then
    raise exception 'O comentário está vazio.' using errcode = '22023';
  end if;

  v_interno := v_admin and coalesce((p ->> 'interno')::boolean, false);

  insert into public.report_comentarios (report_id, autor_id, texto, interno)
  values (v_report.id, v_ator, v_texto, v_interno)
  returning * into v_comentario;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'report.comentario', 'reports', v_report.id::text,
    jsonb_build_object('numero', v_report.numero, 'interno', v_interno));

  return jsonb_build_object(
    'comentario_id', v_comentario.id,
    'report_id', v_report.id,
    'numero', v_report.numero,
    'autor_do_report', v_report.criado_por,
    'interno', v_interno,
    'ator_e_admin', v_admin);
end;
$$;

-- ─── §3 Contadores do topo ──────────────────────────────────────────────────
--
-- Uma RPC, e não uma contagem sobre a lista já carregada: a lista tem limite de
-- página, e um contador derivado dela diria "12 abertos" com 40 abertos no banco.
-- Um número errado no topo de uma tela de triagem é pior que nenhum número.
create or replace function reports_painel()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not public.app_is_admin() then jsonb_build_object('tem_acesso', false)
    else jsonb_build_object(
      'tem_acesso', true,
      'abertos', count(*) filter (where r.status = 'aberto'),
      'em_andamento', count(*) filter (
        where r.status in ('em_analise', 'em_correcao', 'planejado', 'em_desenvolvimento')),
      -- "Resolvidos no mês" conta o que foi CONSERTADO ou ENTREGUE. `nao_procede`,
      -- `nao_planejado` e `duplicado` também fecham o report, mas contá-los aqui
      -- faria o número subir ao arquivar sem fazer nada — a métrica exata que
      -- ninguém quer ver otimizada.
      'resolvidos_mes', count(*) filter (
        where r.status in ('resolvido', 'entregue')
          and r.resolvido_em >= date_trunc('month', (now() at time zone 'America/Sao_Paulo'))
                                  at time zone 'America/Sao_Paulo'),
      'bugs_abertos', count(*) filter (where r.tipo = 'bug' and r.status = 'aberto'),
      'melhorias_abertas', count(*) filter (where r.tipo = 'melhoria' and r.status = 'aberto'),
      'total', count(*))
  end
  from public.reports r;
$$;

revoke execute on function app_report_criar(jsonb) from public, anon;
revoke execute on function app_report_atualizar(jsonb) from public, anon;
revoke execute on function app_report_comentar(jsonb) from public, anon;
revoke execute on function reports_painel() from public, anon;
grant execute on function app_report_criar(jsonb) to authenticated, service_role;
grant execute on function app_report_atualizar(jsonb) to authenticated, service_role;
grant execute on function app_report_comentar(jsonb) to authenticated, service_role;
grant execute on function reports_painel() to authenticated, service_role;

-- ─── §2 O bucket do print ───────────────────────────────────────────────────
--
-- PRIVADO. Um print de tela de dentro do sistema mostra dados de cliente — nome,
-- CNPJ, limite, comissão. Bucket público seria um link permanente e adivinhável
-- para isso, e o "anexo opcional" viraria o maior vazamento da plataforma.
--
-- O caminho começa pelo id de quem envia (`{usuario_id}/{arquivo}`), e é esse
-- primeiro segmento que a policy usa como âncora: sem ele não há como amarrar o
-- objeto a ninguém antes de o report existir — e o upload acontece antes.
--
-- Limite e mime-types ficam NO BUCKET, não no cliente: uma checagem em JavaScript
-- é uma sugestão, e o Storage aceita qualquer coisa que chegue pela API.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'report-anexos', 'report-anexos', false, 5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;

create policy report_anexos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'report-anexos'
    and (select public.app_usuario_ativo())
    and nullif(split_part(name, '/', 1), '') = (select auth.uid())::text
  );

create policy report_anexos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'report-anexos'
    and (
      nullif(split_part(name, '/', 1), '') = (select auth.uid())::text
      or (select public.app_is_admin())
    )
  );

-- Sem DELETE para o autor. O anexo é a prova de que o bug existe; apagá-lo depois
-- de a triagem começar deixaria o admin com um report que descreve uma tela que
-- ninguém mais pode ver. Limpeza é da administração.
create policy report_anexos_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'report-anexos' and (select public.app_is_admin()));

-- ─── §5 Modo beta ───────────────────────────────────────────────────────────
--
-- Mora em `app_config`, que já existe (0016) e já é legível por qualquer usuário
-- ativo — que é exatamente o público do banner.
--
-- REGRA QUE PASSA A VALER PARA `app_config`: a tabela é lida por TODA a empresa e
-- agora chega ao cliente por Realtime. Nada de credencial, chave ou segredo pode
-- entrar aqui. É a mesma régua de `fornecedores_config`.
insert into app_config (chave, valor, descricao)
values (
  'beta',
  '{"habilitado": false, "texto": "Plataforma em fase beta — sua opinião ajuda a melhorar."}'::jsonb,
  'Banner de aviso no topo de toda a aplicação (web e mobile). Ligado/desligado e texto em Admin → Configurações.'
)
on conflict (chave) do nothing;

/*
 * Existe `app_definir_config` genérica (0016) e mesmo assim esta função existe.
 * Duas razões:
 *
 *   (1) o §5 pede o evento `beta.alterado`, e emiti-lo dentro da genérica faria
 *       toda troca de configuração da plataforma disparar um evento de beta;
 *   (2) a genérica aceita qualquer jsonb no `valor`. Um `{"habilitado": "sim"}`
 *       gravaria liso e o banner sumiria sem erro nenhum — o pior tipo de falha
 *       para um estado que a empresa inteira vê.
 */
create or replace function app_definir_beta(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_habilitado boolean;
  v_texto text := btrim(coalesce(p ->> 'texto', ''));
  v_valor jsonb;
begin
  if not public.app_is_admin() then
    raise exception 'Somente a administração altera o modo beta.' using errcode = '42501';
  end if;

  if jsonb_typeof(p -> 'habilitado') <> 'boolean' then
    raise exception 'O estado do modo beta precisa ser verdadeiro ou falso.' using errcode = '22023';
  end if;
  v_habilitado := (p ->> 'habilitado')::boolean;

  if v_habilitado and length(v_texto) = 0 then
    raise exception 'Ligar o modo beta sem texto deixaria uma tarja vazia no topo de todas as telas.'
      using errcode = '22023';
  end if;
  if length(v_texto) > 200 then
    raise exception 'O texto do banner precisa caber numa linha (até 200 caracteres).'
      using errcode = '22023';
  end if;

  v_valor := jsonb_build_object('habilitado', v_habilitado, 'texto', v_texto);

  insert into public.app_config (chave, valor, atualizado_por, atualizado_em)
  values ('beta', v_valor, v_ator, now())
  on conflict (chave) do update
    set valor = excluded.valor, atualizado_por = excluded.atualizado_por, atualizado_em = now();

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'beta.alterado', 'app_config', 'beta', v_valor);

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (null, 'beta.alterado',
    jsonb_build_object(
      'titulo', case when v_habilitado then 'Modo beta ligado' else 'Modo beta desligado' end,
      'resumo', case when v_habilitado
        then 'A tarja de beta passou a aparecer no topo de todas as telas.'
        else 'A tarja de beta saiu do topo das telas.' end,
      'url', '/admin/configuracoes'),
    v_ator);

  return v_valor;
end;
$$;

revoke execute on function app_definir_beta(jsonb) from public, anon;
grant execute on function app_definir_beta(jsonb) to authenticated, service_role;

/*
 * Realtime em `app_config`: ligar/desligar o beta tem de refletir sem novo login
 * (§5). Sem a tabela na publicação a assinatura conecta, reporta SUBSCRIBED e não
 * emite nada — o mesmo no-op silencioso que a 0010 documentou para o sino.
 *
 * Não é bypass de RLS: o Realtime avalia `app_config_select` (usuário ativo) com o
 * JWT de cada assinante, linha a linha.
 */
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_config'
  ) then
    alter publication supabase_realtime add table public.app_config;
  end if;
end
$$;

-- ─── §4 Quem é avisado de quê ───────────────────────────────────────────────
--
-- Só DOIS eventos são semeados aqui, e a ausência dos outros dois é decisão, não
-- esquecimento:
--
--   report.criado / beta.alterado  → regra por PERFIL. O alvo é "quem administra",
--                                    que é um conjunto fixo e conhecido.
--
--   report.status_alterado / report.comentario → NÃO têm regra, e não podem ter:
--                                    o destinatário é o AUTOR DAQUELE report, e
--                                    `notificacao_regras` só sabe endereçar perfil
--                                    ou usuário fixo. Além disso o §4 exige PUSH, e
--                                    o trigger só escreve o sino. Esses dois saem
--                                    por `notificar()` na server action — um caminho
--                                    por evento, como a 0016 estabeleceu, para não
--                                    tocar dois sinos pela mesma coisa.
--
-- O alvo é o perfil que tem o MÓDULO admin, não o perfil chamado "Admin": renomear
-- um perfil não pode desligar a triagem em silêncio.
insert into notificacao_regras (tipo_evento, perfil_id, ativo)
select t.tipo, p.id, true
from (values ('report.criado'), ('beta.alterado')) as t(tipo)
join perfis p on true
join perfil_modulos pm on pm.perfil_id = p.id and pm.modulo_id = 'admin'
on conflict do nothing;
