-- =============================================================================
-- 0120 — Leads & formulários (04i, fase 1: captar e rotear)
--
-- Uma porta ABERTA PARA A INTERNET escrevendo no CRM. Todo o desenho aqui parte
-- disso: o público lê um recorte mínimo por RPC, nunca a tabela; a escrita vem só
-- pela service role do endpoint; e o que chega é sempre gravado, mesmo quando é lixo
-- — `descartada_spam` é uma linha, não um silêncio, porque uma porta que descarta sem
-- registro é uma porta em que ninguém confia quando o lead "sumiu".
--
-- ─── Por que `campos_snapshot` ──────────────────────────────────────────────
--
-- O formulário é editável e as submissões são eternas. Sem o retrato da estrutura no
-- momento do envio, renomear um campo em outubro reescreveria retroativamente o que a
-- pessoa respondeu em março — e a análise passaria a ler perguntas que ninguém fez.
--
-- ─── Por que supressão não bloqueia ─────────────────────────────────────────
--
-- Quem preenche o formulário está PEDINDO contato. O "não me procure" de seis meses
-- atrás não vale contra isso. Mas ignorá-lo em silêncio também não: `revisao` é o
-- meio-termo — não bloqueia, não atropela, e um humano decide.
-- =============================================================================

create table public.formularios (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null
    constraint formularios_slug_check check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  nome text not null,
  descricao text,
  titulo text,
  subtitulo text,
  texto_botao text not null default 'Enviar',
  mensagem_sucesso text,
  -- O microtexto sob o CNPJ. Ele reduz desistência: pedir CNPJ numa landing page
  -- assusta, e dizer para que serve é mais barato que perder o lead.
  ajuda_cnpj text,
  campos jsonb not null,
  pergunta_intencao jsonb,
  consentimento_texto text,
  consentimento_obrigatorio boolean not null default true,
  vendedor_destino_id uuid references public.vendedores (id) on delete set null,
  auto_resposta_habilitada boolean not null default true,
  auto_resposta_assunto text,
  auto_resposta_corpo text,
  enriquecimento_pago boolean not null default false,
  ativo boolean not null default true,
  criado_por uuid references public.usuarios (id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table public.formularios is
  'Formulários embutíveis nas landing pages. O slug vira URL, nome de arquivo do '
  'script e id de elemento no DOM da página hospedeira — daí o CHECK restritivo.';

create table public.formulario_submissoes (
  id uuid primary key default gen_random_uuid(),
  formulario_id uuid references public.formularios (id) on delete set null,
  dados jsonb not null,
  campos_snapshot jsonb not null,
  intencao text
    constraint formulario_submissoes_intencao_check
    check (intencao is null or intencao in ('cedente', 'sacado', 'erp')),
  utm_source text, utm_medium text, utm_campaign text, utm_term text, utm_content text,
  referrer text, pagina_url text, user_agent text,
  -- IP só como HASH: serve para rate limit e para investigar um ataque, e não é
  -- guardado em claro porque nunca precisou ser.
  ip_hash text,
  cnpj text,
  empresa_id uuid references public.empresas (id) on delete set null,
  contato_id uuid references public.contatos (id) on delete set null,
  sdr_lead_id uuid references public.sdr_leads (id) on delete set null,
  status text not null default 'recebida'
    constraint formulario_submissoes_status_check check (status in
      ('recebida', 'processada', 'revisao', 'descartada_spam', 'erro')),
  motivo_revisao text,
  divergencia_papel boolean not null default false,
  consentimento_aceito boolean,
  consentimento_em timestamptz,
  erro text,
  criada_em timestamptz not null default now(),
  processada_em timestamptz
);

create index formulario_submissoes_form_idx
  on public.formulario_submissoes (formulario_id, criada_em desc);
create index formulario_submissoes_cnpj_idx on public.formulario_submissoes (cnpj);
-- A varredura do worker: o que ainda não foi enriquecido.
create index formulario_submissoes_pendentes_idx
  on public.formulario_submissoes (criada_em)
  where status in ('recebida', 'processada') and processada_em is null;
-- Rate limit por IP: sempre uma janela curta sobre o hash.
create index formulario_submissoes_ip_idx
  on public.formulario_submissoes (ip_hash, criada_em desc)
  where ip_hash is not null;

create table public.formulario_visualizacoes (
  id bigserial primary key,
  formulario_id uuid references public.formularios (id) on delete cascade,
  utm_source text, utm_campaign text, pagina_url text,
  visto_em timestamptz not null default now()
);

create index formulario_visualizacoes_form_idx
  on public.formulario_visualizacoes (formulario_id, visto_em desc);

comment on table public.formulario_visualizacoes is
  'Uma linha por render do formulário. É o denominador da taxa de conversão — sem ele '
  'só se sabe quantos enviaram, nunca quantos viram e desistiram.';

-- ─── RLS ────────────────────────────────────────────────────────────────────
-- Nenhuma das três é legível pelo público. O formulário chega ao anônimo por
-- `formulario_publico(slug)`, que devolve só o que a tela precisa renderizar; as
-- submissões e as visualizações são escritas pela service role do endpoint.

alter table public.formularios enable row level security;
alter table public.formulario_submissoes enable row level security;
alter table public.formulario_visualizacoes enable row level security;

create policy formularios_select on public.formularios
  for select to authenticated using (public.app_tem_modulo('comercial'));
create policy formulario_submissoes_select on public.formulario_submissoes
  for select to authenticated using (public.app_tem_modulo('comercial'));
create policy formulario_visualizacoes_select on public.formulario_visualizacoes
  for select to authenticated using (public.app_tem_modulo('comercial'));

grant select on public.formularios to authenticated;
grant select on public.formulario_submissoes to authenticated;
grant select on public.formulario_visualizacoes to authenticated;

-- ─── O teto do enriquecimento pago ──────────────────────────────────────────
-- Nasce em 300 e não em zero: teto zero faria o toggle do formulário existir sem
-- nunca fazer nada, e alguém levaria um dia para descobrir por quê.

insert into public.comercial_config (chave, valor)
values ('orcamento_inbound_mensal', jsonb_build_object('teto', 300, 'alerta_pct', 80))
on conflict (chave) do nothing;

-- ─── O que o público pode ler ───────────────────────────────────────────────

create or replace function public.formulario_publico(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', f.id, 'slug', f.slug,
    'titulo', f.titulo, 'subtitulo', f.subtitulo,
    'texto_botao', f.texto_botao, 'mensagem_sucesso', f.mensagem_sucesso,
    'ajuda_cnpj', f.ajuda_cnpj,
    'campos', f.campos, 'pergunta_intencao', f.pergunta_intencao,
    'consentimento_texto', f.consentimento_texto,
    'consentimento_obrigatorio', f.consentimento_obrigatorio
  )
  from public.formularios f
  where f.slug = p_slug and f.ativo;
$$;

comment on function public.formulario_publico(text) is
  'O recorte que o anônimo pode ver: só o necessário para RENDERIZAR. Fora daqui '
  'ficam vendedor de destino, toggle de enriquecimento pago e textos de auto-resposta '
  '— saber para quem o lead vai e quanto custa não é assunto de quem preenche.';

grant execute on function public.formulario_publico(text) to anon, authenticated;

-- ─── Salvar o formulário (construtor) ───────────────────────────────────────

create or replace function public.app_salvar_formulario(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_slug text := p ->> 'slug';
begin
  if not public.app_gestor_comercial() then
    raise exception 'Só gestor do Comercial edita formulário.' using errcode = '42501';
  end if;
  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'Slug inválido: use minúsculas, números e hífen.' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.formularios (
      slug, nome, descricao, titulo, subtitulo, texto_botao, mensagem_sucesso, ajuda_cnpj,
      campos, pergunta_intencao, consentimento_texto, consentimento_obrigatorio,
      vendedor_destino_id, auto_resposta_habilitada, auto_resposta_assunto,
      auto_resposta_corpo, enriquecimento_pago, ativo, criado_por
    ) values (
      v_slug, p ->> 'nome', p ->> 'descricao', p ->> 'titulo', p ->> 'subtitulo',
      coalesce(nullif(p ->> 'texto_botao', ''), 'Enviar'), p ->> 'mensagem_sucesso',
      p ->> 'ajuda_cnpj', p -> 'campos', p -> 'pergunta_intencao',
      p ->> 'consentimento_texto', coalesce((p ->> 'consentimento_obrigatorio')::boolean, true),
      nullif(p ->> 'vendedor_destino_id', '')::uuid,
      coalesce((p ->> 'auto_resposta_habilitada')::boolean, true),
      p ->> 'auto_resposta_assunto', p ->> 'auto_resposta_corpo',
      coalesce((p ->> 'enriquecimento_pago')::boolean, false),
      coalesce((p ->> 'ativo')::boolean, true), auth.uid()
    ) returning id into v_id;
  else
    update public.formularios set
      slug = v_slug, nome = p ->> 'nome', descricao = p ->> 'descricao',
      titulo = p ->> 'titulo', subtitulo = p ->> 'subtitulo',
      texto_botao = coalesce(nullif(p ->> 'texto_botao', ''), 'Enviar'),
      mensagem_sucesso = p ->> 'mensagem_sucesso', ajuda_cnpj = p ->> 'ajuda_cnpj',
      campos = p -> 'campos', pergunta_intencao = p -> 'pergunta_intencao',
      consentimento_texto = p ->> 'consentimento_texto',
      consentimento_obrigatorio = coalesce((p ->> 'consentimento_obrigatorio')::boolean, true),
      vendedor_destino_id = nullif(p ->> 'vendedor_destino_id', '')::uuid,
      auto_resposta_habilitada = coalesce((p ->> 'auto_resposta_habilitada')::boolean, true),
      auto_resposta_assunto = p ->> 'auto_resposta_assunto',
      auto_resposta_corpo = p ->> 'auto_resposta_corpo',
      enriquecimento_pago = coalesce((p ->> 'enriquecimento_pago')::boolean, false),
      ativo = coalesce((p ->> 'ativo')::boolean, true),
      atualizado_em = now()
    where id = v_id;
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (auth.uid(), 'formulario.salvo', 'formularios', v_id::text,
          jsonb_build_object('slug', v_slug));

  return jsonb_build_object('id', v_id, 'slug', v_slug);
end $$;

revoke all on function public.app_salvar_formulario(jsonb) from public;
grant execute on function public.app_salvar_formulario(jsonb) to authenticated;

-- ─── A lista, com as métricas do funil ──────────────────────────────────────

create or replace function public.formularios_lista()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.criado_em desc), '[]'::jsonb)
  from (
    select
      f.id, f.slug, f.nome, f.descricao, f.ativo, f.criado_em,
      f.enriquecimento_pago, f.vendedor_destino_id, v.nome as vendedor_destino_nome,
      (select count(*) from public.formulario_visualizacoes w where w.formulario_id = f.id)::int as visualizacoes,
      (select count(*) from public.formulario_submissoes s
        where s.formulario_id = f.id and s.status <> 'descartada_spam')::int as submissoes,
      (select count(*) from public.formulario_submissoes s
        where s.formulario_id = f.id and s.status = 'revisao')::int as em_revisao,
      (select count(*) from public.formulario_submissoes s
        where s.formulario_id = f.id and s.status = 'descartada_spam')::int as spam,
      -- Reuniões e clientes vêm pelo lead de SDR: é o fio que liga o formulário ao
      -- resultado, e sem ele o dashboard mede volume em vez de valor.
      (select count(*) from public.formulario_submissoes s
        join public.sdr_leads l on l.id = s.sdr_lead_id
        where s.formulario_id = f.id and l.reuniao_em is not null)::int as reunioes
    from public.formularios f
    left join public.vendedores v on v.id = f.vendedor_destino_id
  ) t;
$$;

grant execute on function public.formularios_lista() to authenticated;

-- ─── O pipeline síncrono da submissão ───────────────────────────────────────
--
-- Tudo numa transação só: submissão, empresa, contato e lead nascem juntos ou não
-- nascem. Um lead de SDR apontando para uma submissão que falhou pela metade é pior
-- que uma submissão perdida — o SDR liga sem saber o que a pessoa pediu.
--
-- O SDR escolhido vem de FORA (`sdr_id`), calculado pelo motor em packages/core. A
-- regra de território/carga já existe em TypeScript e reescrevê-la aqui criaria duas
-- opiniões sobre quem atende inbound.

create or replace function public.app_processar_submissao(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub uuid;
  v_cnpj text := p ->> 'cnpj';
  v_email text := nullif(p ->> 'email', '');
  v_telefone text := nullif(p ->> 'telefone', '');
  v_empresa uuid;
  v_contato uuid;
  v_lead uuid;
  v_sdr uuid := nullif(p ->> 'sdr_id', '')::uuid;
  v_status text := coalesce(p ->> 'status', 'processada');
  v_criar_lead boolean := coalesce((p ->> 'criar_lead')::boolean, true);
  v_tipagem text := nullif(p ->> 'tipagem_antecipacao', '');
  v_nome_empresa text := nullif(p ->> 'razao_social', '');
  v_tem_focal boolean;
begin
  insert into public.formulario_submissoes (
    formulario_id, dados, campos_snapshot, intencao,
    utm_source, utm_medium, utm_campaign, utm_term, utm_content,
    referrer, pagina_url, user_agent, ip_hash, cnpj, status, motivo_revisao,
    consentimento_aceito, consentimento_em
  ) values (
    nullif(p ->> 'formulario_id', '')::uuid, p -> 'dados', p -> 'campos_snapshot',
    nullif(p ->> 'intencao', ''),
    p ->> 'utm_source', p ->> 'utm_medium', p ->> 'utm_campaign', p ->> 'utm_term',
    p ->> 'utm_content', p ->> 'referrer', p ->> 'pagina_url', p ->> 'user_agent',
    p ->> 'ip_hash', v_cnpj, v_status, nullif(p ->> 'motivo_revisao', ''),
    (p ->> 'consentimento_aceito')::boolean,
    case when (p ->> 'consentimento_aceito')::boolean then now() end
  ) returning id into v_sub;

  -- Spam morre aqui: a linha fica para auditoria e nada mais acontece.
  if v_status = 'descartada_spam' then
    return jsonb_build_object('submissao_id', v_sub, 'status', v_status);
  end if;

  -- ── Empresa: enriquece, NUNCA duplica ──
  select id into v_empresa from public.empresas where cnpj = v_cnpj;
  if v_empresa is null then
    insert into public.empresas (cnpj, razao_social, estagio, origem)
    values (v_cnpj, v_nome_empresa, 'lead', 'formulario')
    returning id into v_empresa;

    insert into public.cnpj_lookup_fila (cnpj, motivo)
    values (v_cnpj, 'manual') on conflict (cnpj) do nothing;

    insert into public.empresa_eventos (empresa_id, tipo, payload)
    values (v_empresa, 'empresa.criada',
            jsonb_build_object('origem', 'formulario', 'slug', p ->> 'slug'));
  else
    -- Preenche vazio, nunca sobrescreve: o que veio da Receita vale mais que o que a
    -- pessoa digitou com pressa num celular.
    update public.empresas set
      razao_social = coalesce(razao_social, v_nome_empresa),
      uf = coalesce(uf, nullif(p ->> 'uf', '')),
      municipio = coalesce(municipio, nullif(p ->> 'municipio', '')),
      erp_atual = coalesce(erp_atual, nullif(p ->> 'erp_atual', ''))
    where id = v_empresa;
  end if;

  if v_tipagem is not null then
    update public.empresas set tipagem_antecipacao = v_tipagem
    where id = v_empresa and tipagem_antecipacao is null;
  end if;

  -- ── Contato: dedup por e-mail ou telefone DENTRO da empresa ──
  if v_email is not null or v_telefone is not null then
    select id into v_contato from public.contatos
    where empresa_id = v_empresa
      and ((v_email is not null and lower(email) = v_email)
        or (v_telefone is not null and telefone = v_telefone))
    limit 1;

    select exists (select 1 from public.contatos where empresa_id = v_empresa and ponto_focal)
      into v_tem_focal;

    if v_contato is null then
      insert into public.contatos (empresa_id, nome, cargo, email, telefone, whatsapp, origem, ponto_focal)
      values (v_empresa, nullif(p ->> 'nome', ''), nullif(p ->> 'cargo', ''), v_email,
              v_telefone, nullif(p ->> 'whatsapp', ''),
              'formulario:' || coalesce(p ->> 'slug', '?'),
              -- Primeiro contato da empresa vira ponto focal. Quem se apresentou é o
              -- canal que existe; deixar a empresa sem focal é deixá-la sem porta.
              not v_tem_focal)
      returning id into v_contato;
    else
      update public.contatos set
        nome = coalesce(nome, nullif(p ->> 'nome', '')),
        cargo = coalesce(cargo, nullif(p ->> 'cargo', '')),
        email = coalesce(email, v_email),
        telefone = coalesce(telefone, v_telefone),
        whatsapp = coalesce(whatsapp, nullif(p ->> 'whatsapp', ''))
      where id = v_contato;
    end if;
  end if;

  -- ── Lead de SDR ──
  if v_criar_lead and v_sdr is not null then
    -- Um lead vivo já existente NÃO vira dois: dois SDRs na mesma porta é pior que
    -- nenhum. O inbound reaproveita o card e carimba o toque.
    select id into v_lead from public.sdr_leads
    where empresa_id = v_empresa and encerrado_em is null
    order by distribuido_em desc limit 1;

    if v_lead is null then
      insert into public.sdr_leads (empresa_id, sdr_id, origem, estagio, ultimo_toque_em)
      values (v_empresa, v_sdr, 'inbound', 'a_contatar', now())
      returning id into v_lead;
    else
      update public.sdr_leads set ultimo_toque_em = now(), atualizado_em = now()
      where id = v_lead;
    end if;
  end if;

  update public.formulario_submissoes set
    empresa_id = v_empresa, contato_id = v_contato, sdr_lead_id = v_lead
  where id = v_sub;

  insert into public.empresa_eventos (empresa_id, tipo, payload)
  values (v_empresa, 'lead.inbound_recebido', jsonb_build_object(
    'submissao_id', v_sub, 'slug', p ->> 'slug', 'intencao', p ->> 'intencao',
    'utm_source', p ->> 'utm_source', 'utm_campaign', p ->> 'utm_campaign',
    'status', v_status
  ));

  return jsonb_build_object(
    'submissao_id', v_sub, 'empresa_id', v_empresa, 'contato_id', v_contato,
    'sdr_lead_id', v_lead, 'status', v_status
  );
end $$;

comment on function public.app_processar_submissao(jsonb) is
  'Pipeline síncrono da submissão: grava, deduplica empresa e contato, cria o lead de '
  'SDR e emite o evento — tudo numa transação. Chamada só pela service role do '
  'endpoint público; o SDR escolhido vem calculado de packages/core.';

revoke all on function public.app_processar_submissao(jsonb) from public, anon, authenticated;
