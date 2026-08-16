-- =============================================================================
-- 0116 — Funil de certificados digitais
--
-- Certificado ausente = cegueira de NF-e naquele CNPJ. O grid (0062/0063) já mostra
-- ONDE está a cegueira; o que não existia é o lugar onde alguém TRABALHA para
-- fechá-la. Um grid é uma foto: você olha, fecha a aba e nada aconteceu.
--
-- O CARD É POR CLIENTE, NÃO POR CNPJ. A ligação é uma só — fala-se com a construtora,
-- não com cada SPE —, e 961 dos 970 CNPJs de SPE hoje estão sem certificado. Um card
-- por CNPJ seria uma fila de mil itens que ninguém encara; um card por cliente são 48
-- conversas, que é o tamanho real do trabalho.
--
-- A ALIMENTAÇÃO É AUTOMÁTICA e a fonte é o sync diário de certificados. `sincronizar()`
-- é idempotente e roda depois dele: abre o que falta, move o que avançou, reabre o que
-- regrediu. Um funil de manutenção que dependesse de alguém lembrar de cadastrar a
-- linha teria exatamente as empresas que alguém lembrou.
--
-- ─── As duas regras que o usuário fixou, e que o banco garante ──────────────
--
-- 1. NUNCA GANHO SEM O CERTIFICADO DA MATRIZ. É a matriz que destrava a ingestão; um
--    card fechado com a matriz descoberta seria uma cegueira marcada como resolvida.
--    Isso é CHECK de banco (`app_mover_certificado_card`), não validação de tela.
--
-- 2. `pendente_spes` é uma coluna que a MÁQUINA preenche: matriz coberta, SPE faltando.
--    Separa "ainda não falei com o cliente" de "o cliente resolveu o principal e
--    sobrou a cauda" — dois trabalhos com ligações diferentes na mesma coluna são
--    dois trabalhos que ninguém prioriza.
--
-- ─── Por que fechar não é para sempre ───────────────────────────────────────
--
-- Perdido "sai até o fato mudar". O perigo é o oposto: reabrir na hora, porque o
-- certificado continua faltando — que foi exatamente o motivo de perder. Por isso o
-- fecho grava um RETRATO da cobertura (`fechado_matriz_coberta`, `fechado_cobertos`) e
-- a reabertura compara contra ELE, não contra o absoluto. Sem esse retrato, todo card
-- perdido voltaria no dia seguinte e a coluna de perdidos seria decorativa.
--
-- COBERTO = certificado válido com MAIS de 30 dias. Uma definição só, usada pelo
-- percentual, pela lista de pendências e pela regra de reabertura — a lição da 0115:
-- três consumidores com três recortes é como se produz um número que contradiz o
-- outro sem que nenhum esteja errado.
-- =============================================================================

-- ─── Motivos de perda ganham o contexto ─────────────────────────────────────

alter table public.motivos_perda drop constraint if exists motivos_perda_contexto_check;
alter table public.motivos_perda add constraint motivos_perda_contexto_check
  check (contexto in ('funil_vendedor', 'sdr_sem_fit', 'ex_cliente', 'certificado'));

insert into public.motivos_perda (contexto, motivo, ordem) values
  ('certificado', 'Cliente não quer emitir', 10),
  ('certificado', 'Custo do certificado', 20),
  ('certificado', 'Já emite por outro sistema', 30),
  ('certificado', 'Contabilidade não libera', 40),
  ('certificado', 'Sem contato / não responde', 50),
  ('certificado', 'Obra encerrada / SPE inativa', 60),
  ('certificado', 'Cliente saiu da plataforma', 70)
on conflict (contexto, motivo) do nothing;

-- ─── O card ─────────────────────────────────────────────────────────────────

create table public.certificado_cards (
  id uuid primary key default gen_random_uuid(),
  -- UNIQUE: o card é a conversa com aquele cliente, e ela é uma só. Reabrir reusa a
  -- linha; o histórico mora em `certificado_card_eventos`.
  empresa_id uuid not null unique references public.empresas (id) on delete cascade,
  estagio text not null default 'universo'
    constraint certificado_cards_estagio_check check (estagio in (
      'universo', 'prospeccao', 'emissao_agendada', 'pendente_spes', 'ganho', 'perdido'
    )),
  -- Para onde voltar quando a matriz descobre estando em `pendente_spes`: devolver
  -- para 'universo' apagaria a prospecção que já foi feita.
  estagio_anterior text,
  perdido_motivo uuid references public.motivos_perda (id),
  perdido_em timestamptz,
  ganho_em timestamptz,
  -- O retrato da cobertura no momento do fecho. Sem ele a reabertura é impossível de
  -- distinguir de "continua como estava".
  fechado_matriz_coberta boolean,
  fechado_cobertos int,
  observacao text,
  aberto_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references public.usuarios (id),
  constraint certificado_cards_perdido_exige_motivo
    check (estagio <> 'perdido' or perdido_motivo is not null)
);

create index certificado_cards_estagio_idx on public.certificado_cards (estagio);

comment on table public.certificado_cards is
  'Funil de captura de certificados digitais: um card por cliente (matriz), com as '
  'SPEs do grupo dentro. Alimentado pelo sync diário — abre, move e reabre sozinho.';

comment on column public.certificado_cards.fechado_cobertos is
  'Quantos CNPJs do grupo estavam cobertos quando o card fechou. A reabertura compara '
  'contra este retrato: sem ele, um card perdido por falta de certificado voltaria no '
  'dia seguinte pela mesma falta que o fez perder.';

create table public.certificado_card_eventos (
  id bigserial primary key,
  card_id uuid not null references public.certificado_cards (id) on delete cascade,
  de text,
  para text not null,
  motivo uuid references public.motivos_perda (id),
  -- Quem moveu: o sync ou uma pessoa. Sem esta coluna, "o card andou sozinho" e "o
  -- vendedor trabalhou" viram a mesma linha no histórico.
  automatico boolean not null default false,
  detalhe text,
  usuario_id uuid references public.usuarios (id),
  criado_em timestamptz not null default now()
);

create index certificado_card_eventos_card_idx
  on public.certificado_card_eventos (card_id, criado_em desc);

comment on table public.certificado_card_eventos is
  'Histórico do card. O card reusa a linha ao reabrir; o que aconteceu em cada ciclo '
  'fica aqui.';

alter table public.certificado_cards enable row level security;
alter table public.certificado_card_eventos enable row level security;

create policy certificado_cards_select on public.certificado_cards
  for select to authenticated using (public.app_tem_modulo('comercial'));
create policy certificado_card_eventos_select on public.certificado_card_eventos
  for select to authenticated using (public.app_tem_modulo('comercial'));

grant select on public.certificado_cards to authenticated;
grant select on public.certificado_card_eventos to authenticated;

-- ─── O universo: uma linha por CNPJ que deveria ter certificado ─────────────
--
-- SECURITY DEFINER na função que a lê, porque as SPEs vivem em `mercado_universo`, que
-- o módulo comercial não enxerga. A view em si é o lugar onde "coberto" é definido UMA
-- vez — quem quiser mudar os 30 dias muda aqui e o percentual, a lista de pendências e
-- a reabertura mudam juntos.

create or replace view public.certificado_universo as
  select
    cli.empresa_id,
    u.cnpj,
    u.razao_social,
    false as e_matriz,
    c.expires_at,
    c.status as certificado_status,
    (c.expires_at is not null and c.expires_at > now() + interval '30 days') as coberto
  from (
    select e.id as empresa_id, e.grupo_id, e.cnpj
    from public.empresas e
    join public.clientes_onepay co on co.cnpj = e.cnpj
    where e.tipo = 'construtora' and e.grupo_id is not null
  ) cli
  join public.mercado_universo u
    on u.grupo_id = cli.grupo_id and u.is_spe and u.cnpj <> cli.cnpj
  left join public.certificados c on c.cnpj = u.cnpj
  where not exists (select 1 from public.certificados_ocultos o where o.cnpj = u.cnpj)
  union all
  select
    e.id,
    e.cnpj,
    coalesce(e.razao_social, e.nome_fantasia, e.cnpj),
    true,
    c.expires_at,
    c.status,
    (c.expires_at is not null and c.expires_at > now() + interval '30 days')
  from public.empresas e
  join public.clientes_onepay co on co.cnpj = e.cnpj
  left join public.certificados c on c.cnpj = e.cnpj
  where e.tipo = 'construtora';

comment on view public.certificado_universo is
  'Todo CNPJ que deveria ter certificado: a matriz de cada construtora cliente e as '
  'SPEs visíveis do grupo. COBERTO = certificado com mais de 30 dias de validade — a '
  'definição única usada pelo percentual, pela lista e pela regra de reabertura.';

/*
 * REVOKE EXPLÍCITO, e não "basta não conceder".
 *
 * O projeto tem default privileges concedendo select em public para `anon` e
 * `authenticated`: a view nasceu legível pelos dois. Como ela é SECURITY DEFINER (tem
 * de ser — lê `mercado_universo`, que o módulo comercial não enxerga), isso a
 * transformava numa porta lateral em /rest/v1/certificado_universo servindo o CNPJ e o
 * vencimento de certificado de todo cliente e toda SPE, sem RLS e sem login.
 *
 * Pego pelo advisor de segurança depois de aplicada. Ela é lida só de dentro das
 * funções DEFINER abaixo, que rodam como dono e não precisam do grant.
 */
revoke all on public.certificado_universo from anon, authenticated;

-- ─── O sync: abre, move e reabre ────────────────────────────────────────────

create or replace function public.certificado_funil_sincronizar()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_abertos int := 0;
  v_ganhos int := 0;
  v_pendente_spes int := 0;
  v_reabertos int := 0;
  v_devolvidos int := 0;
  r record;
  v_card_id uuid;
  v_alvo text;
begin
  for r in
    select
      s.empresa_id,
      s.total,
      s.cobertos,
      s.tem_spe,
      s.matriz_coberta,
      k.id as card_id,
      k.estagio,
      k.estagio_anterior,
      k.fechado_matriz_coberta,
      k.fechado_cobertos
    from (
      select
        empresa_id,
        count(*)::int as total,
        count(*) filter (where coberto)::int as cobertos,
        bool_or(not e_matriz) as tem_spe,
        coalesce(bool_or(coberto) filter (where e_matriz), false) as matriz_coberta
      from public.certificado_universo
      group by empresa_id
    ) s
    left join public.certificado_cards k on k.empresa_id = s.empresa_id
  loop
    -- 1. Nada pendente e nenhum card: não há trabalho, não se inventa linha.
    --    O estágio de nascimento já respeita a matriz: um card que nasce em 'universo'
    --    com a matriz coberta seria movido para `pendente_spes` na passada seguinte, e
    --    o funil levaria dois dias para dizer a verdade sobre o primeiro dia.
    if r.card_id is null then
      if r.cobertos >= r.total then continue; end if;
      v_alvo := case when r.matriz_coberta then 'pendente_spes' else 'universo' end;
      insert into public.certificado_cards (empresa_id, estagio)
      values (r.empresa_id, v_alvo)
      returning id into v_card_id;
      insert into public.certificado_card_eventos (card_id, de, para, automatico, detalhe)
      values (v_card_id, null, v_alvo, true,
              format('%s de %s CNPJs sem certificado.', r.total - r.cobertos, r.total));
      v_abertos := v_abertos + 1;
      continue;
    end if;

    -- 2. Card FECHADO: só volta se o retrato mudou.
    if r.estagio in ('ganho', 'perdido') then
      -- Regrediu: a matriz perdeu a cobertura, ou um certificado que existia venceu.
      if (coalesce(r.fechado_matriz_coberta, false) and not r.matriz_coberta)
         or r.cobertos < coalesce(r.fechado_cobertos, 0) then
        update public.certificado_cards
        set estagio = 'universo', estagio_anterior = null, perdido_motivo = null,
            perdido_em = null, ganho_em = null,
            fechado_matriz_coberta = null, fechado_cobertos = null,
            atualizado_em = now(), atualizado_por = null
        where id = r.card_id;
        insert into public.certificado_card_eventos (card_id, de, para, automatico, detalhe)
        values (r.card_id, r.estagio, 'universo', true,
                case when coalesce(r.fechado_matriz_coberta, false) and not r.matriz_coberta
                  then 'O certificado da matriz venceu ou está a menos de 30 dias.'
                  else 'Um certificado que existia deixou de valer.' end);
        v_reabertos := v_reabertos + 1;

      -- Melhorou o que faltava: o card foi perdido sem a matriz e a matriz apareceu.
      -- O fato mudou na direção boa, e insistir no "perdido" seria ignorar o cliente
      -- que resolveu sozinho.
      elsif r.estagio = 'perdido' and r.matriz_coberta
            and not coalesce(r.fechado_matriz_coberta, false) then
        if r.cobertos >= r.total then
          update public.certificado_cards
          set estagio = 'ganho', ganho_em = now(), perdido_motivo = null, perdido_em = null,
              fechado_matriz_coberta = true, fechado_cobertos = r.cobertos,
              atualizado_em = now(), atualizado_por = null
          where id = r.card_id;
          v_ganhos := v_ganhos + 1;
          v_alvo := 'ganho';
        else
          update public.certificado_cards
          set estagio = 'pendente_spes', estagio_anterior = 'prospeccao',
              perdido_motivo = null, perdido_em = null,
              fechado_matriz_coberta = null, fechado_cobertos = null,
              atualizado_em = now(), atualizado_por = null
          where id = r.card_id;
          v_pendente_spes := v_pendente_spes + 1;
          v_alvo := 'pendente_spes';
        end if;
        insert into public.certificado_card_eventos (card_id, de, para, automatico, detalhe)
        values (r.card_id, 'perdido', v_alvo, true,
                'O certificado da matriz apareceu depois da perda.');
      end if;
      continue;
    end if;

    -- 3. Card ABERTO. Cobertura total encerra sozinho: não sobrou trabalho, e pedir
    --    confirmação humana para fechar o que já está fechado é fila inventada.
    if r.cobertos >= r.total then
      update public.certificado_cards
      set estagio = 'ganho', ganho_em = now(), estagio_anterior = null,
          fechado_matriz_coberta = true, fechado_cobertos = r.cobertos,
          atualizado_em = now(), atualizado_por = null
      where id = r.card_id;
      insert into public.certificado_card_eventos (card_id, de, para, automatico, detalhe)
      values (r.card_id, r.estagio, 'ganho', true,
              case when r.tem_spe then 'Matriz e todas as SPEs cobertas.'
                   else 'Certificado da matriz capturado (cliente sem SPE).' end);
      v_ganhos := v_ganhos + 1;

    -- 4. Matriz coberta e sobrou SPE: a coluna que a máquina preenche.
    elsif r.matriz_coberta and r.estagio <> 'pendente_spes' then
      update public.certificado_cards
      set estagio = 'pendente_spes', estagio_anterior = r.estagio,
          atualizado_em = now(), atualizado_por = null
      where id = r.card_id;
      insert into public.certificado_card_eventos (card_id, de, para, automatico, detalhe)
      values (r.card_id, r.estagio, 'pendente_spes', true,
              format('Matriz coberta; faltam %s SPEs.', r.total - r.cobertos));
      v_pendente_spes := v_pendente_spes + 1;

    -- 5. Estava em `pendente_spes` e a matriz descobriu: volta ao trabalho que era
    --    feito antes, não para o começo da fila.
    elsif not r.matriz_coberta and r.estagio = 'pendente_spes' then
      v_alvo := coalesce(r.estagio_anterior, 'universo');
      update public.certificado_cards
      set estagio = v_alvo, estagio_anterior = null, atualizado_em = now(), atualizado_por = null
      where id = r.card_id;
      insert into public.certificado_card_eventos (card_id, de, para, automatico, detalhe)
      values (r.card_id, 'pendente_spes', v_alvo, true,
              'O certificado da matriz venceu ou está a menos de 30 dias.');
      v_devolvidos := v_devolvidos + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'abertos', v_abertos, 'ganhos', v_ganhos, 'pendente_spes', v_pendente_spes,
    'reabertos', v_reabertos, 'devolvidos', v_devolvidos, 'em', now()
  );
end $$;

comment on function public.certificado_funil_sincronizar() is
  'Reconcilia o funil de certificados com a realidade da tabela `certificados`. '
  'Idempotente: roda depois do sync diário e a qualquer momento pelo botão. Fecha '
  'sozinho só quando não sobra pendência; o resto é decisão humana.';

revoke all on function public.certificado_funil_sincronizar() from public;
grant execute on function public.certificado_funil_sincronizar() to authenticated;

-- ─── A leitura do funil ─────────────────────────────────────────────────────

create or replace function public.certificado_funil()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_vendedor uuid;
  v_gestor boolean;
  v_escopo uuid[];
  v_cards jsonb;
begin
  if not public.app_tem_modulo('comercial') then
    return jsonb_build_object('tem_acesso', false);
  end if;

  v_gestor := public.app_gestor_comercial();
  v_vendedor := public.app_vendedor_atual();

  -- O originador vê a sua carteira; o gestor vê tudo. Um vendedor sem carteira vê
  -- lista vazia, e não a lista inteira: o default de um escopo vazio é nada.
  if not v_gestor then
    select coalesce(array_agg(c.empresa_id), '{}'::uuid[]) into v_escopo
    from public.vendedor_carteira c
    where c.vendedor_id = v_vendedor and c.papel = 'originacao' and c.ate is null;
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.pendentes desc, x.nome), '[]'::jsonb)
    into v_cards
  from (
    select
      k.id as card_id,
      k.estagio,
      k.perdido_motivo,
      mp.motivo as perdido_motivo_label,
      k.perdido_em,
      k.ganho_em,
      k.observacao,
      k.aberto_em,
      k.atualizado_em,
      e.id as empresa_id,
      e.cnpj,
      coalesce(e.razao_social, e.nome_fantasia, e.cnpj) as nome,
      u.total,
      u.cobertos,
      u.total - u.cobertos as pendentes,
      u.matriz_coberta,
      u.matriz_expira_em,
      u.cnpjs
    from public.certificado_cards k
    join public.empresas e on e.id = k.empresa_id
    left join public.motivos_perda mp on mp.id = k.perdido_motivo
    join lateral (
      select
        count(*)::int as total,
        count(*) filter (where cu.coberto)::int as cobertos,
        coalesce(bool_or(cu.coberto) filter (where cu.e_matriz), false) as matriz_coberta,
        max(cu.expires_at) filter (where cu.e_matriz) as matriz_expira_em,
        -- Ordenadas por urgência: matriz primeiro, depois descoberto, depois o que
        -- vence antes. Num card de 370 SPEs, a ordem É a interface — ninguém rola
        -- 370 linhas atrás do que importa.
        coalesce(jsonb_agg(
          jsonb_build_object(
            'cnpj', cu.cnpj, 'nome', cu.razao_social, 'e_matriz', cu.e_matriz,
            'coberto', cu.coberto, 'expires_at', cu.expires_at
          )
          order by cu.e_matriz desc, cu.coberto, cu.expires_at nulls first, cu.razao_social
        ), '[]'::jsonb) as cnpjs
      from public.certificado_universo cu
      where cu.empresa_id = k.empresa_id
    ) u on true
    where v_gestor or e.id = any(v_escopo)
  ) x;

  return jsonb_build_object(
    'tem_acesso', true,
    'eh_gestor', v_gestor,
    'cards', v_cards,
    'sincronizado_em', (select max(sincronizado_em) from public.certificados)
  );
end $$;

comment on function public.certificado_funil() is
  'O funil inteiro: um card por cliente com os CNPJs do grupo aninhados, ordenados por '
  'urgência. DEFINER porque as SPEs vivem em mercado_universo — o recorte devolvido é '
  'só o dos grupos dos clientes, e o originador recebe apenas a sua carteira.';

revoke all on function public.certificado_funil() from public;
grant execute on function public.certificado_funil() to authenticated;

-- ─── Mover o card ───────────────────────────────────────────────────────────

create or replace function public.app_mover_certificado_card(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card public.certificado_cards;
  v_estagio text := p ->> 'estagio';
  v_motivo uuid := nullif(p ->> 'perdido_motivo', '')::uuid;
  v_matriz_coberta boolean;
  v_total int;
  v_cobertos int;
begin
  if not public.app_tem_modulo('comercial') then
    raise exception 'Sem acesso.' using errcode = '42501';
  end if;

  select * into v_card from public.certificado_cards where id = (p ->> 'card_id')::uuid;
  if v_card.id is null then
    raise exception 'Card não encontrado.' using errcode = 'P0002';
  end if;

  -- O originador só mexe no que é dele. A leitura já filtra, mas uma escrita que
  -- confia no filtro da leitura é uma escrita sem dono.
  if not public.app_gestor_comercial() and not exists (
    select 1 from public.vendedor_carteira c
    where c.vendedor_id = public.app_vendedor_atual()
      and c.empresa_id = v_card.empresa_id and c.papel = 'originacao' and c.ate is null
  ) then
    raise exception 'Este cliente não está na sua carteira.' using errcode = '42501';
  end if;

  if v_estagio not in ('universo','prospeccao','emissao_agendada','pendente_spes','ganho','perdido') then
    raise exception 'Estágio inválido: %.', v_estagio using errcode = '22023';
  end if;

  select
    count(*)::int,
    count(*) filter (where coberto)::int,
    coalesce(bool_or(coberto) filter (where e_matriz), false)
    into v_total, v_cobertos, v_matriz_coberta
  from public.certificado_universo where empresa_id = v_card.empresa_id;

  -- A regra que não se negocia: ganho exige a matriz coberta. É a matriz que destrava
  -- a ingestão de NF-e — fechar sem ela é marcar a cegueira como resolvida.
  if v_estagio = 'ganho' and not v_matriz_coberta then
    raise exception 'Sem o certificado da matriz este card não pode ser ganho.'
      using errcode = '23514';
  end if;

  if v_estagio = 'perdido' and v_motivo is null then
    raise exception 'Perder exige motivo.' using errcode = '23514';
  end if;

  -- `pendente_spes` é da máquina: chegar lá é consequência de a matriz ficar coberta,
  -- não uma escolha de coluna. Deixar arrastar para lá criaria cards nessa coluna com
  -- a matriz descoberta, e a coluna deixaria de significar o que o nome diz.
  if v_estagio = 'pendente_spes' and not v_matriz_coberta then
    raise exception 'Esta coluna é para quem já tem o certificado da matriz.'
      using errcode = '23514';
  end if;

  update public.certificado_cards set
    estagio = v_estagio,
    estagio_anterior = case when v_estagio = 'pendente_spes' then v_card.estagio else null end,
    perdido_motivo = case when v_estagio = 'perdido' then v_motivo else null end,
    perdido_em = case when v_estagio = 'perdido' then now() else null end,
    ganho_em = case when v_estagio = 'ganho' then now() else null end,
    fechado_matriz_coberta = case when v_estagio in ('ganho','perdido') then v_matriz_coberta end,
    fechado_cobertos = case when v_estagio in ('ganho','perdido') then v_cobertos end,
    observacao = coalesce(nullif(p ->> 'observacao', ''), observacao),
    atualizado_em = now(),
    atualizado_por = auth.uid()
  where id = v_card.id;

  insert into public.certificado_card_eventos (card_id, de, para, motivo, automatico, usuario_id)
  values (v_card.id, v_card.estagio, v_estagio, v_motivo, false, auth.uid());

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (auth.uid(), 'certificado.card.movido', 'certificado_cards', v_card.id::text,
          jsonb_build_object('de', v_card.estagio, 'para', v_estagio, 'motivo', v_motivo));

  return jsonb_build_object('id', v_card.id, 'estagio', v_estagio);
end $$;

comment on function public.app_mover_certificado_card(jsonb) is
  'Move um card do funil de certificados. Recusa ganho sem o certificado da matriz e '
  'perda sem motivo — as duas regras vivem aqui, e não na tela, porque a tela não é a '
  'única porta.';

revoke all on function public.app_mover_certificado_card(jsonb) from public;
grant execute on function public.app_mover_certificado_card(jsonb) to authenticated;

-- Primeira carga: o funil nasce cheio, com o estado real de hoje.
select public.certificado_funil_sincronizar();
