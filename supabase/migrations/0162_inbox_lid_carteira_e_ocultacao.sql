-- ============================================================================
-- 0162 — O inbox: o endereçamento novo do WhatsApp, o que sai pelo celular,
--        a carteira de quem lê e o silêncio pessoal.
--
-- Quatro defeitos que a tela mostrava como um só ("o inbox está errado").
--
-- ── §1 O WHATSAPP TROCOU O ENDEREÇO E NINGUÉM AVISOU ────────────────────────
-- Toda conversa recebida nesta base está chaveada por um número que não existe:
-- 43950417129679, 98711384416410, 278472945594535. Não são telefones — são LIDs,
-- o identificador de privacidade que o WhatsApp passou a mandar no `remoteJid` no
-- lugar do número. Três consequências, e as três apareceram como bugs distintos:
--
--   · a thread do que ENTRA é chaveada pelo LID e a do que SAI pelo telefone, de
--     modo que a mesma pessoa tem DUAS conversas e nenhuma delas está completa;
--   · `telefoneLegivel` recebe 15 dígitos e devolve os 15 dígitos crus, porque
--     não há telefone brasileiro ali para formatar;
--   · `resolverRemetente` procura o LID em `contatos.whatsapp` e não acha nada,
--     então TODA conversa recebida cai na fila de identificação.
--
-- O provedor manda o telefone ao lado (`key.cleanedSenderPn`), e o leitor passa a
-- preferi-lo. Mas as conversas já criadas continuam presas ao LID: por isso a
-- coluna `lid` e a função de absorção — quando a pessoa escrever de novo, o
-- webhook traz LID e telefone juntos, e a thread velha é ENGOLIDA pela nova em
-- vez de virar um cemitério paralelo.
--
-- ── §2 O QUE SAI PELO CELULAR TAMBÉM É NOSSO ────────────────────────────────
-- `message.sent` chega quando alguém responde pelo aparelho, fora da plataforma,
-- e era descartado duas vezes: `lerWebhookWasender` recusa `fromMe`, e
-- `lerStatusWasender` só olha eventos de status. O inbox mostrava metade do
-- diálogo — as perguntas do cliente sem as nossas respostas. `origem = 'celular'`
-- é essa procedência, e ela precisa ser DISTINTA de `compositor`: uma mensagem
-- digitada no aparelho não passou pelo portão, e confundi-las faria a auditoria
-- de supressão jurar que passou.
--
-- ── §3 A CARTEIRA É DE QUEM VENDE ───────────────────────────────────────────
-- `comunicacoes` exigia o módulo e mais nada: quem entrava lia a negociação de
-- todo mundo. Agora o recorte é a carteira, e o admin é a exceção — não por
-- hierarquia, mas porque alguém precisa conseguir responder "o que foi dito a
-- este cliente" sem depender de quem estava de férias.
--
-- Conversa SEM responsável continua visível a todos de propósito. É a fila de
-- identificação: esconder o que ainda não tem dono de quem poderia dar-lhe um
-- dono faria a fila parar de andar.
--
-- ── §4 OCULTAR É SILÊNCIO, NÃO SEGREDO ──────────────────────────────────────
-- `conversas_ocultas` é por USUÁRIO. O grupo da família que escreveu no número
-- comercial não precisa virar decisão coletiva, e o que uma pessoa silencia não
-- some para o resto do time. Vale inclusive para o admin — mas só o silêncio que
-- ele mesmo pediu, e a tela lista o que está oculto para que nada fique
-- inalcançável.
-- ============================================================================

-- =============================================================================
-- §1 — O LID ao lado do telefone
-- =============================================================================

alter table public.conversas add column if not exists lid text;

comment on column public.conversas.lid is
  'O identificador de privacidade do WhatsApp (@lid) desta pessoa, quando o provedor '
  'o informa. NÃO é a chave da thread: a chave continua sendo o telefone canônico, e o '
  'LID existe para reencontrar a thread quando o provedor manda SÓ ele.';

/*
 * Único e parcial: dois LIDs iguais em duas threads seriam duas threads para a
 * mesma pessoa — exatamente o que a 0144 existe para impedir. Nulo é a maioria
 * das linhas (e-mail não tem LID), e nulos não colidem entre si.
 */
create unique index if not exists conversas_lid_idx
  on public.conversas (lid) where lid is not null;

alter table public.conversas_nao_vinculadas add column if not exists lid text;

-- =============================================================================
-- §2 — A procedência "celular"
-- =============================================================================

/*
 * A lista vem do banco VIVO, não da 0144: `campanha` foi acrescentada depois, e
 * recriar o CHECK a partir do arquivo original apagaria silenciosamente um valor
 * que existe em produção.
 */
alter table public.comunicacoes drop constraint if exists comunicacoes_origem_check;
alter table public.comunicacoes add constraint comunicacoes_origem_check
  check (origem is null or origem in (
    'compositor', 'outbox', 'agente', 'app_toque', 'inbox', 'sistema', 'campanha', 'celular'
  ));

comment on column public.comunicacoes.origem is
  'De onde a mensagem partiu. `celular` é a que alguém digitou no APARELHO, fora da '
  'plataforma: ela entra no ledger pelo webhook `message.sent` para o histórico não '
  'mentir, mas não passou pelo portão — e por isso não pode ser confundida com '
  '`compositor`.';

-- =============================================================================
-- §1b — Absorver a thread presa ao LID
-- =============================================================================

/*
 * Chamada quando o webhook traz LID e telefone JUNTOS. A thread do telefone é a
 * que sobrevive — ela é a que tem o mesmo identificador do que a equipe ENVIA, e
 * é a única das duas que o cooldown, a supressão e o compositor sabem encontrar.
 *
 * Move o histórico em vez de apagá-lo: as mensagens recebidas nas últimas semanas
 * são a única memória que existe dessas conversas.
 */
create or replace function public.app__conversa_absorver_lid(p_lid text, p_conversa uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_velha public.conversas;
  v_nova  public.conversas;
begin
  if p_lid is null or btrim(p_lid) = '' or p_conversa is null then
    return;
  end if;

  select * into v_nova from public.conversas where id = p_conversa;
  if v_nova.id is null then
    return;
  end if;

  -- A thread velha é a que tem o LID COMO identificador — o estado que a 0144
  -- criou sem saber. Uma thread que já tem `lid` preenchido é a nova, e absorver
  -- a si mesma seria apagá-la.
  select * into v_velha
    from public.conversas
    where canal = 'whatsapp' and identificador_externo = p_lid and id <> p_conversa;

  if v_velha.id is not null then
    update public.comunicacoes set conversa_id = v_nova.id where conversa_id = v_velha.id;
    update public.mensagens_outbox set conversa_id = v_nova.id where conversa_id = v_velha.id;
    update public.agente_decisoes set conversa_id = v_nova.id where conversa_id = v_velha.id;

    /*
     * O que a thread velha sabia e a nova não sabe. `coalesce` com a NOVA na
     * frente: uma vinculação feita à mão no inbox é mais confiável que qualquer
     * coisa herdada, e sobrescrevê-la desidentificaria o que alguém já resolveu.
     */
    update public.conversas set
      empresa_id = coalesce(v_nova.empresa_id, v_velha.empresa_id),
      contato_id = coalesce(v_nova.contato_id, v_velha.contato_id),
      responsavel_vendedor_id =
        coalesce(v_nova.responsavel_vendedor_id, v_velha.responsavel_vendedor_id),
      objetivo    = coalesce(v_nova.objetivo, v_velha.objetivo),
      playbook_id = coalesce(v_nova.playbook_id, v_velha.playbook_id),
      nao_lidas   = v_nova.nao_lidas + v_velha.nao_lidas,
      ultima_mensagem_em = greatest(
        coalesce(v_nova.ultima_mensagem_em, v_velha.ultima_mensagem_em),
        coalesce(v_velha.ultima_mensagem_em, v_nova.ultima_mensagem_em)
      ),
      criada_em = least(v_nova.criada_em, v_velha.criada_em)
      where id = v_nova.id;

    -- O silêncio pessoal segue a conversa. Quem calou o LID não quer ouvir o
    -- telefone da mesma pessoa.
    insert into public.conversas_ocultas (usuario_id, conversa_id, motivo, ocultada_em)
      select o.usuario_id, v_nova.id, o.motivo, o.ocultada_em
        from public.conversas_ocultas o where o.conversa_id = v_velha.id
      on conflict (usuario_id, conversa_id) do nothing;

    delete from public.conversas where id = v_velha.id;
  end if;

  -- A fila de identificação também estava chaveada pelo LID.
  update public.conversas_nao_vinculadas nv set
    identificador_externo = v_nova.identificador_externo,
    lid = p_lid
    where nv.canal = 'whatsapp' and nv.identificador_externo = p_lid
      and not exists (
        select 1 from public.conversas_nao_vinculadas outra
        where outra.canal = 'whatsapp'
          and outra.identificador_externo = v_nova.identificador_externo
      );
  delete from public.conversas_nao_vinculadas
    where canal = 'whatsapp' and identificador_externo = p_lid;

  update public.conversas set lid = p_lid where id = v_nova.id;
end $$;

revoke execute on function public.app__conversa_absorver_lid(text, uuid) from public, anon, authenticated;
grant execute on function public.app__conversa_absorver_lid(text, uuid) to service_role;

/*
 * O caminho inverso: o provedor mandou SÓ o LID (acontece em reação, em mídia e
 * em alguns eventos de grupo). Sem isto, uma mensagem sem telefone recriaria a
 * thread paralela que acabamos de absorver.
 */
create or replace function public.app__conversa_por_lid(p_lid text)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.conversas where lid = p_lid limit 1;
$$;

revoke execute on function public.app__conversa_por_lid(text) from public, anon, authenticated;
grant execute on function public.app__conversa_por_lid(text) to service_role;

-- =============================================================================
-- §4 — O silêncio pessoal
-- =============================================================================

create table if not exists public.conversas_ocultas (
  usuario_id  uuid not null references public.usuarios (id) on delete cascade,
  conversa_id uuid not null references public.conversas (id) on delete cascade,
  /* Opcional e livre: "grupo da obra", "meu contato pessoal", "spam". */
  motivo text,
  ocultada_em timestamptz not null default now(),
  primary key (usuario_id, conversa_id)
);

create index if not exists conversas_ocultas_conversa_idx
  on public.conversas_ocultas (conversa_id);

comment on table public.conversas_ocultas is
  'Silêncio POR PESSOA. Ocultar não resolve a conversa nem a esconde do time: tira-a da '
  'lista de quem pediu, e só. Por isso a chave é (usuario_id, conversa_id) e não uma '
  'coluna em `conversas` — uma coluna faria o silêncio de um virar decisão de todos.';

-- =============================================================================
-- §3 — Quem enxerga o quê
--
-- As duas funções abaixo são SECURITY DEFINER por uma razão estrutural, não de
-- conveniência: se a policy de `conversas` consultasse `comunicacoes` diretamente
-- e a de `comunicacoes` consultasse `conversas`, cada policy dispararia a outra e
-- o Postgres recursaria até estourar. DEFINER corta o ciclo — a função lê sem
-- RLS, e QUEM decide continua sendo a policy que a chama.
-- =============================================================================

/*
 * A conversa é minha quando eu sou o responsável, quando ninguém é, ou quando eu
 * mesmo falei nela.
 *
 * "Ninguém é" é a parte deliberada: a conversa de um desconhecido não tem dono
 * até alguém identificá-la, e escondê-la de quem poderia dar-lhe um dono deixaria
 * a fila de identificação parada para sempre.
 *
 * "Eu falei nela" cobre o caso em que o SDR abriu a conversa e o closer respondeu:
 * o closer não é o responsável da carteira, mas a mensagem é dele, e um histórico
 * que esconde a própria mensagem de quem a escreveu não é histórico.
 */
create or replace function public.app__conversa_minha(p_conversa uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_conversa is not null and exists (
    select 1 from public.conversas cv
    where cv.id = p_conversa
      and (
        cv.responsavel_vendedor_id is null
        or cv.responsavel_vendedor_id = public.app_vendedor_atual()
        or exists (
          select 1 from public.comunicacoes m
          where m.conversa_id = cv.id
            and (m.usuario_id = auth.uid() or m.vendedor_id = public.app_vendedor_atual())
        )
      )
  );
$$;

revoke execute on function public.app__conversa_minha(uuid) from public, anon;
grant execute on function public.app__conversa_minha(uuid) to authenticated, service_role;

create or replace function public.app__conversa_oculta(p_conversa uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_conversa is not null and exists (
    select 1 from public.conversas_ocultas o
    where o.conversa_id = p_conversa and o.usuario_id = auth.uid()
  );
$$;

revoke execute on function public.app__conversa_oculta(uuid) from public, anon;
grant execute on function public.app__conversa_oculta(uuid) to authenticated, service_role;

/* O mesmo silêncio, visto da fila de identificação — que é chaveada pelo par
   (canal, identificador) e não pelo id da conversa. */
create or replace function public.app__identificador_oculto(p_canal text, p_ident text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.conversas_ocultas o
    join public.conversas cv on cv.id = o.conversa_id
    where o.usuario_id = auth.uid()
      and cv.canal = p_canal
      and (cv.identificador_externo = p_ident or cv.lid = p_ident)
  );
$$;

revoke execute on function public.app__identificador_oculto(text, text) from public, anon;
grant execute on function public.app__identificador_oculto(text, text) to authenticated, service_role;

/*
 * Índices para o `exists` de `app__conversa_minha`. Sem eles a checagem varreria o
 * ledger por linha de conversa listada, e o inbox abre até 200 por tela.
 */
create index if not exists comunicacoes_autor_conversa_idx
  on public.comunicacoes (usuario_id, conversa_id) where usuario_id is not null;
create index if not exists comunicacoes_vendedor_conversa_idx
  on public.comunicacoes (vendedor_id, conversa_id) where vendedor_id is not null;

-- ─── As policies ────────────────────────────────────────────────────────────

drop policy if exists conversas_select on public.conversas;
create policy conversas_select on public.conversas
  for select to authenticated
  using (
    ((select public.app_tem_modulo('comunicacao')) or (select public.app_tem_modulo('empresas')))
    -- O silêncio vale para TODO MUNDO, admin incluído — mas só o silêncio que a
    -- própria pessoa pediu. Ninguém herda o "ocultar" de outro, e `app_conversas_ocultas`
    -- devolve o que foi calado para que nada fique inalcançável.
    and not public.app__conversa_oculta(id)
    and ((select public.app_is_admin()) or public.app__conversa_minha(id))
  );

drop policy if exists comunicacoes_select on public.comunicacoes;
create policy comunicacoes_select on public.comunicacoes
  for select to authenticated
  using (
    (select public.app_tem_modulo('comunicacao'))
    and not public.app__conversa_oculta(conversa_id)
    and (
      (select public.app_is_admin())
      -- A própria mensagem é sempre visível a quem a escreveu, mesmo que a
      -- carteira tenha mudado de mão depois.
      or usuario_id = (select auth.uid())
      or vendedor_id = (select public.app_vendedor_atual())
      or public.app__conversa_minha(conversa_id)
    )
  );

drop policy if exists conversas_nv_select on public.conversas_nao_vinculadas;
create policy conversas_nv_select on public.conversas_nao_vinculadas
  for select to authenticated
  using (
    (select public.app_tem_modulo('comunicacao'))
    and not public.app__identificador_oculto(canal, identificador_externo)
  );

revoke all on public.conversas_ocultas from anon, authenticated;
grant select on public.conversas_ocultas to authenticated;

alter table public.conversas_ocultas enable row level security;

/* Só as SUAS. Saber o que o colega silenciou não é dado de equipe. */
drop policy if exists conversas_ocultas_propria on public.conversas_ocultas;
create policy conversas_ocultas_propria on public.conversas_ocultas
  for select to authenticated
  using (usuario_id = (select auth.uid()));

-- =============================================================================
-- §4b — Ocultar, reexibir, e ver o que foi ocultado
-- =============================================================================

/*
 * Aceita o id da CONVERSA ou o da linha da fila de identificação, e a razão é a
 * tela: o pedido nasce no painel de vinculação, onde a pessoa está olhando para
 * "quem é este número?" e conclui que é o grupo do condomínio. Obrigá-la a
 * descobrir o id da conversa para calá-la seria pedir que ela resolvesse o
 * problema antes de poder dispensá-lo.
 *
 * Ocultar NÃO resolve a fila: a linha continua pendente para o resto do time, que
 * pode conhecer o número que esta pessoa não conhece.
 */
create or replace function public.app_conversa_ocultar(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_conversa uuid := nullif(p ->> 'conversa_id', '')::uuid;
  v_nv public.conversas_nao_vinculadas;
begin
  if not public.app_tem_modulo('comunicacao') then
    raise exception 'Sem acesso ao módulo Comunicação.' using errcode = '42501';
  end if;

  if v_conversa is null and nullif(p ->> 'nao_vinculada_id', '') is not null then
    select * into v_nv from public.conversas_nao_vinculadas
      where id = (p ->> 'nao_vinculada_id')::uuid;
    if v_nv.id is null then
      raise exception 'Conversa não encontrada na fila.' using errcode = 'no_data_found';
    end if;
    select cv.id into v_conversa from public.conversas cv
      where cv.canal = v_nv.canal
        and (cv.identificador_externo = v_nv.identificador_externo
             or cv.lid = v_nv.identificador_externo)
      limit 1;
  end if;

  if v_conversa is null then
    raise exception 'Não há conversa para ocultar.' using errcode = 'no_data_found';
  end if;

  insert into public.conversas_ocultas (usuario_id, conversa_id, motivo)
  values (v_ator, v_conversa, nullif(p ->> 'motivo', ''))
  on conflict (usuario_id, conversa_id) do update set motivo = excluded.motivo;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'comunicacao.conversa_ocultada', 'conversas', v_conversa::text, p);
end $$;

create or replace function public.app_conversa_reexibir(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ator uuid := auth.uid();
begin
  if not public.app_tem_modulo('comunicacao') then
    raise exception 'Sem acesso ao módulo Comunicação.' using errcode = '42501';
  end if;
  delete from public.conversas_ocultas
    where usuario_id = v_ator and conversa_id = (p ->> 'conversa_id')::uuid;
end $$;

/*
 * O que EU calei. Existe porque a policy de `conversas` esconde de verdade: sem
 * esta função a pessoa não teria como desfazer o próprio silêncio, e "ocultar"
 * viraria "apagar" — que é a diferença entre uma preferência e um estrago.
 */
create or replace function public.app_conversas_ocultas()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(l order by l ->> 'ocultada_em' desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'conversa_id', cv.id,
      'canal', cv.canal,
      'identificador_externo', cv.identificador_externo,
      'empresa_nome', coalesce(e.razao_social, e.nome_fantasia),
      'contato_nome', ct.nome,
      'motivo', o.motivo,
      'ocultada_em', o.ocultada_em,
      'ultima_mensagem_em', cv.ultima_mensagem_em
    ) as l
    from public.conversas_ocultas o
    join public.conversas cv on cv.id = o.conversa_id
    left join public.empresas e  on e.id  = cv.empresa_id
    left join public.contatos ct on ct.id = cv.contato_id
    where o.usuario_id = auth.uid()
      and public.app_tem_modulo('comunicacao')
  ) s;
$$;

revoke execute on function
  public.app_conversa_ocultar(jsonb), public.app_conversa_reexibir(jsonb),
  public.app_conversas_ocultas()
from public, anon;

grant execute on function
  public.app_conversa_ocultar(jsonb), public.app_conversa_reexibir(jsonb),
  public.app_conversas_ocultas()
to authenticated, service_role;
