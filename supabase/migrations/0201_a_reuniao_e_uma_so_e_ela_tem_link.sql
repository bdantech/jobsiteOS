-- ═════════════════════════════════════════════════════════════════════════════
-- 0201 — A reunião é uma só, ela tem link, e ela chega na agenda de quem vai
--
-- Quatro sintomas relatados, uma causa comum: `vendedor_eventos` foi desenhada
-- como "linha de agenda de uma pessoa", e uma reunião não é isso. Uma reunião é
-- um ENCONTRO — tem duas pontas nossas (o SDR que marcou e o closer que atende),
-- tem uma ponta do cliente, tem lugar, e tem um link. A tabela não tinha onde
-- guardar nada disso, então cada pedaço virou um sintoma.
--
-- ─── 1. "Está duplicando após o agendamento" ────────────────────────────────
-- Não é bug de clique duplo nem de re-render: o agendamento SEMPRE inseriu DUAS
-- linhas, de propósito — "Reunião — X" para o closer e "Reunião (agendada por
-- mim) — X" para o SDR. As seis linhas que existem na base são exatamente três
-- pares, criados no mesmo microssegundo.
--
-- Num calendário filtrado por pessoa isso nunca aparece. No calendário do gestor,
-- que não filtra, as duas linhas ficam lado a lado, mesmo horário, mesma empresa
-- — e é isso que se vê na tela. A intenção era certa (os dois precisam ter a
-- reunião na agenda); a modelagem é que estava errada, porque transformou UM fato
-- em DOIS registros, e a partir daí nada consegue mantê-los coerentes: remarcar
-- mexia em dois, cancelar em dois, e o Google receberia dois.
--
-- Agora é UMA linha com `acompanhantes uuid[]`. O dono é quem atende; quem
-- acompanha entra no array. A agenda de cada um continua mostrando a reunião
-- (a consulta passou a ser "sou o dono OU estou nos acompanhantes"), e o
-- calendário do gestor mostra uma linha, porque houve uma reunião.
--
-- E o agendamento virou IDEMPOTENTE, que é o segundo meio da duplicação e o que
-- ainda ia acontecer: `app_mover_lead_sdr` criava uma venda nova e mais dois
-- eventos A CADA chamada com `reuniao_agendada`. Remarcar duas vezes o mesmo lead
-- dava dois cards no funil do closer e quatro linhas no calendário. Agora ele
-- reaproveita a venda aberta e ATUALIZA o evento — remarcar é remarcar, não é
-- marcar de novo.
--
-- ─── 2. "Não apareceu no Google Agenda do vendedor" ─────────────────────────
-- Porque nunca houve nada que pusesse lá. O que existe desde o 04g é um feed
-- .ics que o vendedor precisa ASSINAR à mão, colando uma URL no Google — e que
-- mesmo assinado o Google recolhe de poucas em poucas horas, sem hora marcada.
-- Para uma reunião marcada para amanhã de manhã, "de poucas em poucas horas" é
-- tarde demais.
--
-- As colunas `google_*` abertas aqui são a fila de sincronização: `pendente_em`
-- marcado pede escrita na API do Google, `evento_id` diz que já foi, `erro` diz
-- por que não foi. Uma fila com o estado ao lado do dado, e não uma tabela nova:
-- o que se sincroniza É a reunião, e um registro separado só criaria a chance
-- dos dois discordarem.
--
-- O feed .ics FICA. Ele é o que atende quem não conectou o Google e quem usa
-- Outlook, e ele não custa nada.
--
-- ─── 3. "Deveria gerar o link do Meet e convidar o cliente" ─────────────────
-- `modalidade`, `local`, `meet_url` e `participantes`. O link não é gerado por
-- nós: quem cria é o Google, no mesmo `events.insert` que põe a reunião na agenda
-- — e é por isso que o convite ao cliente sai do mesmo lugar. O Google manda o
-- e-mail de convite para os `attendees`, com o Meet dentro, em nome de quem
-- organiza. Nós guardamos o link de volta para a tela poder mostrá-lo.
--
-- `participantes` é jsonb e não uma tabela de junção porque o que se guarda é o
-- ESTADO DO CONVITE no momento em que ele saiu — nome e e-mail como foram
-- enviados. Um contato que troca de e-mail depois não pode reescrever para quem
-- o convite foi mandado.
--
-- ─── 4. "Deveria aparecer uma aba sobre as infos da reunião" ────────────────
-- A aba é tela, mas ela não tinha o que ler: horário morava em `sdr_leads.
-- reuniao_em` (e só para o lead), participantes não existiam, lugar não existia,
-- link não existia. `app_reuniao_do_card` é o que a aba lê, pelos dois lados —
-- pelo `venda_id` no funil de vendas e pelo `sdr_lead_id` no de reuniões — e
-- `app_salvar_reuniao` é o que ela escreve.
--
-- ─── 5. O bug de tabela que só apareceu ao olhar para os escopos ────────────
-- `app_salvar_gmail_conta` gravava `escopos = excluded.escopos` sempre. O worker
-- chama essa mesma RPC a cada renovação de access token, SEM mandar escopos — e
-- o `coalesce(p -> 'escopos', '[]')` do insert virava `{}`. Resultado: as quatro
-- contas conectadas da base estão com `escopos = {}`, apagadas na primeira
-- renovação, embora as três permissões do Gmail estejam concedidas e
-- funcionando.
--
-- Isso era inofensivo enquanto ninguém lia a coluna. Deixa de ser agora: é por
-- ela que a tela sabe dizer "você conectou antes do Calendar existir, reconecte"
-- em vez de deixar a reunião falhar em silêncio com um 403.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── §1 A reunião ganha o que uma reunião tem ───────────────────────────────

alter table public.vendedor_eventos
  /* Quem mais é NOSSO e está na reunião. O dono (`vendedor_id`) é quem atende e
     quem organiza no Google; o SDR que marcou entra aqui.

     Array e não tabela de junção: são zero, um ou dois vendedores, sempre lidos
     junto com a linha e nunca consultados sozinhos. Um uuid[] não aceita FK — a
     integridade fica por conta das funções que escrevem, todas SECURITY DEFINER,
     e um vendedor apagado vira um id órfão que a tela ignora em vez de um erro. */
  add column if not exists acompanhantes uuid[] not null default '{}',

  /* `a_definir` existe por causa das reuniões que já estão marcadas: elas foram
     combinadas fora daqui e nós não sabemos se são Meet ou presenciais. Chutar
     'meet' poria um link numa reunião que talvez seja na obra; a aba prefere
     perguntar. Reunião nova nasce 'meet', que é o caso comum. */
  add column if not exists modalidade text not null default 'meet'
    constraint vendedor_eventos_modalidade_check
      check (modalidade in ('meet', 'presencial', 'telefone', 'a_definir')),
  /* O endereço, quando é presencial. Livre de propósito: "obra da Marginal, portão 3"
     é uma localização melhor que qualquer campo estruturado que eu inventasse. */
  add column if not exists local text,
  /* Devolvido pelo Google. NUNCA montado por nós — um link de Meet inventado é um
     link que abre uma sala vazia na hora da reunião. */
  add column if not exists meet_url text,
  add column if not exists descricao text,
  /* [{contato_id, nome, email}] — como foram convidados, não como estão hoje. */
  add column if not exists participantes jsonb not null default '[]'::jsonb,

  -- A fila do Google, ao lado do dado que ela sincroniza.
  add column if not exists google_evento_id text,
  add column if not exists google_calendar_id text,
  /* De QUEM é a agenda onde o evento vive. É o usuário do dono no momento da
     criação — se o card trocar de closer depois, o evento continua morando na
     agenda de quem o criou até ser recriado, e essa coluna é o que conta essa
     verdade em vez de escondê-la. */
  add column if not exists google_conta_usuario_id uuid references public.usuarios (id),
  add column if not exists google_pendente_em timestamptz,
  add column if not exists google_sincronizado_em timestamptz,
  add column if not exists google_erro text,

  add column if not exists atualizado_em timestamptz not null default now();

comment on column public.vendedor_eventos.acompanhantes is
  'Outros vendedores na mesma reunião (tipicamente o SDR que a marcou). A agenda de '
  'cada um lê "dono OU acompanhante" — é o que evita duas linhas para um encontro.';
comment on column public.vendedor_eventos.google_pendente_em is
  'Marcado sempre que a reunião nasce ou muda. O worker escreve no Google e limpa. '
  'Nulo significa "em dia" — não "nunca sincronizado": para isso existe `google_evento_id`.';

/* A varredura do worker: poucas linhas pendentes numa tabela que cresce devagar.
   Índice parcial porque 99% das linhas têm `pendente_em` nulo na maior parte do tempo. */
create index if not exists vendedor_eventos_google_fila_idx
  on public.vendedor_eventos (google_pendente_em)
  where google_pendente_em is not null;

/* A agenda de quem acompanha. Sem o GIN, "estou nos acompanhantes" vira seq scan
   na tabela inteira a cada abertura do calendário. */
create index if not exists vendedor_eventos_acompanhantes_idx
  on public.vendedor_eventos using gin (acompanhantes);

-- ─── §2 Os três pares viram três reuniões ───────────────────────────────────
--
-- A cópia do SDR é reconhecível sem heurística de texto: mesma `venda_id`, mesmo
-- `inicio_em`, `vendedor_id` diferente do dono da venda. O dono da venda é quem
-- atende — é assim que `app_mover_lead_sdr` sempre criou o par.
--
-- Sem `delete` cego: o `update` que absorve e o `delete` que remove olham para o
-- mesmo conjunto, e o delete só alcança linha que TEM um par vivo.

with par as (
  select dono.id as dono_id, array_agg(distinct copia.vendedor_id) as copias
  from public.vendedor_eventos dono
  join public.vendas v on v.id = dono.venda_id
  join public.vendedor_eventos copia
    on copia.venda_id = dono.venda_id
   and copia.inicio_em = dono.inicio_em
   and copia.id <> dono.id
  where dono.vendedor_id = v.vendedor_id
    and copia.vendedor_id <> v.vendedor_id
    and dono.cancelado_em is null
    and copia.cancelado_em is null
  group by dono.id
)
update public.vendedor_eventos e
set acompanhantes = (
      select coalesce(array_agg(distinct a), '{}') from unnest(e.acompanhantes || par.copias) a
    ),
    atualizado_em = now()
from par
where e.id = par.dono_id;

delete from public.vendedor_eventos copia
using public.vendedor_eventos dono, public.vendas v
where v.id = dono.venda_id
  and dono.vendedor_id = v.vendedor_id
  and copia.venda_id = dono.venda_id
  and copia.inicio_em = dono.inicio_em
  and copia.id <> dono.id
  and copia.vendedor_id <> v.vendedor_id
  and copia.vendedor_id = any (dono.acompanhantes);

/* Nenhuma das reuniões que já existem foi combinada por aqui — o campo nem
   existia. `a_definir` é o que a aba usa para perguntar, em vez de afirmar. */
update public.vendedor_eventos set modalidade = 'a_definir'
where tipo = 'reuniao' and cancelado_em is null and google_evento_id is null;

/* O título deixa de dizer de quem é a linha, porque a linha deixou de ser de uma
   pessoa só. "Reunião (agendada por mim)" era a diferença entre as duas cópias;
   sem cópia, ele vira uma frase confusa na agenda do closer. */
update public.vendedor_eventos
set titulo = replace(titulo, 'Reunião (agendada por mim) — ', 'Reunião — ')
where titulo like 'Reunião (agendada por mim) —%';

-- ─── §3 Quem acompanha também enxerga ───────────────────────────────────────
--
-- Sem isto o SDR perderia da agenda a reunião que ele mesmo marcou: a policy só
-- olhava para `vendedor_id`, e a partir do §2 o SDR não é mais o dono de linha
-- nenhuma. Seria trocar uma linha duplicada por uma linha invisível.

drop policy if exists vendedor_eventos_select on public.vendedor_eventos;
create policy vendedor_eventos_select on public.vendedor_eventos
  for select using (
    public.app_tem_modulo('comercial')
    and (
      public.app_pode_ver_vendedor(vendedor_id)
      or exists (
        select 1 from unnest(acompanhantes) a
        where public.app_pode_ver_vendedor(a)
      )
    )
  );

-- ─── §4 Agendar é agendar; remarcar é remarcar ──────────────────────────────

create or replace function public.app_mover_lead_sdr(p jsonb)
returns public.sdr_leads language plpgsql security definer set search_path = '' as $function$
declare
  v_ator uuid := auth.uid();
  v_lead public.sdr_leads;
  v_estagio text := nullif(p ->> 'estagio', '');
  v_tem_fit boolean := p ? 'fit' and jsonb_typeof(p -> 'fit') = 'boolean';
  v_fit boolean := (p ->> 'fit')::boolean;
  v_motivo uuid := nullif(p ->> 'sem_fit_motivo', '')::uuid;
  v_reuniao timestamptz := nullif(p ->> 'reuniao_em', '')::timestamptz;
  v_destino uuid := nullif(p ->> 'vendedor_destino_id', '')::uuid;
  v_modalidade text := coalesce(nullif(p ->> 'modalidade', ''), 'meet');
  v_local text := nullif(p ->> 'local', '');
  v_participantes jsonb := coalesce(p -> 'participantes', '[]'::jsonb);
  v_empresa public.empresas;
  v_venda_id uuid;
  v_evento_id uuid;
  v_remarcou boolean := false;
begin
  if not public.app_tem_modulo('comercial') then
    raise exception 'Sem acesso ao módulo Comercial.' using errcode = '42501';
  end if;

  select * into v_lead from public.sdr_leads where id = (p ->> 'lead_id')::uuid;
  if v_lead.id is null then
    raise exception 'Lead não encontrado.' using errcode = 'no_data_found';
  end if;
  select * into v_empresa from public.empresas where id = v_lead.empresa_id;

  -- Julgar fit exige ter falado com a empresa. Marcar "sem fit" em quem nunca foi
  -- contatado não é julgamento, é descarte — e vira estatística que mente sobre a régua.
  if v_tem_fit and v_lead.estagio = 'a_contatar' and coalesce(v_estagio, '') = 'a_contatar' then
    raise exception 'Avalie o fit depois de contatar a empresa.' using errcode = '22023';
  end if;
  if v_tem_fit and not v_fit and v_motivo is null then
    raise exception 'Sem fit exige motivo.' using errcode = '22023';
  end if;
  -- Mesma regra da NF: "em conversa" é o ledger de comunicação falando, não o SDR.
  if v_lead.estagio = 'a_contatar' and v_estagio = 'em_conversa' then
    raise exception 'O lead entra em conversa sozinho, quando a primeira mensagem sair.'
      using errcode = '42501';
  end if;
  if v_estagio = 'reuniao_agendada' and (v_reuniao is null or v_destino is null) then
    raise exception 'Agendar exige data e vendedor destino.' using errcode = '22023';
  end if;
  if v_modalidade not in ('meet', 'presencial', 'telefone', 'a_definir') then
    raise exception 'Modalidade inválida.' using errcode = '22023';
  end if;
  -- Uma reunião presencial sem endereço é um compromisso que ninguém sabe cumprir.
  if v_estagio = 'reuniao_agendada' and v_modalidade = 'presencial' and v_local is null then
    raise exception 'Reunião presencial exige o local.' using errcode = '22023';
  end if;

  update public.sdr_leads set
    estagio = coalesce(v_estagio, estagio),
    fit = case when v_tem_fit then v_fit else fit end,
    fit_definido_em = case when v_tem_fit then now() else fit_definido_em end,
    sem_fit_motivo = case when v_tem_fit and not v_fit then v_motivo else sem_fit_motivo end,
    -- Sem fit encerra; com fit reabre um lead que tinha sido encerrado por engano.
    encerrado_em = case
      when v_tem_fit and not v_fit then now()
      when v_tem_fit and v_fit and encerrado_motivo = 'sem_fit' then null
      else encerrado_em end,
    encerrado_motivo = case
      when v_tem_fit and not v_fit then 'sem_fit'
      when v_tem_fit and v_fit and encerrado_motivo = 'sem_fit' then null
      else encerrado_motivo end,
    reuniao_em = coalesce(v_reuniao, reuniao_em),
    vendedor_destino_id = coalesce(v_destino, vendedor_destino_id),
    ultimo_toque_em = now(),
    atualizado_em = now()
  where id = v_lead.id
  returning * into v_lead;

  if v_estagio = 'reuniao_agendada' then
    /*
     * A VENDA ABERTA DO LEAD É REAPROVEITADA, e é aqui que a duplicação morre.
     *
     * Marcar de novo o mesmo lead — remarcar, corrigir o horário, trocar o closer —
     * criava um SEGUNDO card no funil do closer, com a mesma empresa e a mesma
     * origem. Dois cards para uma negociação é pior que nenhum: um deles vai ser
     * trabalhado e o outro vai envelhecer na coluna até alguém perdê-lo "por
     * duplicidade", o que estraga o motivo de perda também.
     *
     * Ganho e perdido não contam como aberta: um lead que voltou a marcar reunião
     * depois de uma venda perdida é um ciclo NOVO, e merece card novo.
     */
    select id into v_venda_id
    from public.vendas
    where sdr_lead_id = v_lead.id and estagio not in ('ganho', 'perdido')
    order by criada_em desc limit 1;

    if v_venda_id is null then
      insert into public.vendas (empresa_id, vendedor_id, sdr_lead_id, estagio)
      values (v_lead.empresa_id, v_destino, v_lead.id, 'reuniao_agendada')
      returning id into v_venda_id;
    else
      v_remarcou := true;
      update public.vendas set
        vendedor_id = v_destino,
        -- Só volta para "reunião marcada" quem ainda não passou disso. Um card em
        -- proposta que remarca uma conversa não regride de estágio.
        estagio = case when estagio in ('reuniao_agendada', 'reuniao_reagendada')
                       then 'reuniao_reagendada' else estagio end,
        atualizada_em = now()
      where id = v_venda_id;
    end if;

    select id into v_evento_id
    from public.vendedor_eventos
    where sdr_lead_id = v_lead.id and tipo = 'reuniao' and cancelado_em is null
    order by criado_em desc limit 1;

    if v_evento_id is null then
      insert into public.vendedor_eventos (
        vendedor_id, acompanhantes, empresa_id, titulo, inicio_em, sdr_lead_id, venda_id,
        modalidade, local, participantes, criado_por, google_pendente_em
      )
      values (
        v_destino,
        -- O SDR só entra como acompanhante se ele não for o próprio closer. Alguém que
        -- marca a própria reunião não precisa aparecer duas vezes nela.
        case when v_lead.sdr_id = v_destino then '{}'::uuid[] else array[v_lead.sdr_id] end,
        v_lead.empresa_id,
        'Reunião — ' || coalesce(v_empresa.razao_social, 'empresa'),
        v_reuniao, v_lead.id, v_venda_id,
        v_modalidade, v_local, v_participantes, v_ator, now()
      )
      returning id into v_evento_id;
    else
      update public.vendedor_eventos set
        vendedor_id = v_destino,
        acompanhantes = case when v_lead.sdr_id = v_destino then '{}'::uuid[]
                             else array[v_lead.sdr_id] end,
        venda_id = v_venda_id,
        inicio_em = v_reuniao,
        modalidade = v_modalidade,
        local = v_local,
        -- Convidar de novo é decisão da aba, não efeito de remarcar: uma lista vazia
        -- vinda do diálogo de remarcação não pode apagar quem já foi convidado.
        participantes = case when v_participantes = '[]'::jsonb then participantes
                             else v_participantes end,
        google_pendente_em = now(),
        atualizado_em = now()
      where id = v_evento_id;
    end if;

    insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
    values (v_lead.empresa_id, 'sdr.reuniao_agendada',
      jsonb_build_object(
        'resumo', case when v_remarcou then 'Reunião remarcada para ' else 'Reunião agendada para ' end
                  || to_char(v_reuniao at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') || '.',
        'url', '/comercial/vendas/' || v_venda_id,
        'lead_id', v_lead.id, 'venda_id', v_venda_id, 'evento_id', v_evento_id,
        'remarcada', v_remarcou, 'modalidade', v_modalidade, 'vendedor_destino_id', v_destino),
      v_ator);
  elsif v_estagio = 'no_show' then
    insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
    values (v_lead.empresa_id, 'sdr.no_show',
      jsonb_build_object('resumo', 'Reunião marcada e não aconteceu (no-show).', 'lead_id', v_lead.id),
      v_ator);
  end if;

  -- O evento de sem fit carrega o ESTÁGIO em que o lead morreu: é essa distância que
  -- diz se a régua trouxe empresa errada ou se a abordagem é que não convence.
  if v_tem_fit and not v_fit then
    insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
    values (v_lead.empresa_id, 'sdr.sem_fit',
      jsonb_build_object(
        'resumo', 'Sem fit (' || v_lead.estagio || '): ' ||
                  coalesce((select m.motivo from public.motivos_perda m where m.id = v_motivo), '—') || '.',
        'lead_id', v_lead.id, 'motivo_id', v_motivo, 'estagio', v_lead.estagio, 'origem', v_lead.origem),
      v_ator);
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'sdr.lead_movido', 'sdr_leads', v_lead.id::text, p);

  return v_lead;
end $function$;

comment on function public.app_mover_lead_sdr is
  'Move um lead no funil de reuniões. Agendar é IDEMPOTENTE: reaproveita a venda aberta '
  'e atualiza o evento existente em vez de criar um par novo a cada chamada.';

-- ─── §5 O que a aba lê ──────────────────────────────────────────────────────

create or replace function public.app_reuniao_do_card(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  v_venda uuid := nullif(p ->> 'venda_id', '')::uuid;
  v_lead uuid := nullif(p ->> 'sdr_lead_id', '')::uuid;
  v_e public.vendedor_eventos;
  v_dono public.vendedores;
  v_conta public.gmail_contas;
begin
  if not public.app_tem_modulo('comercial') then
    raise exception 'Sem acesso ao módulo Comercial.' using errcode = '42501';
  end if;
  if v_venda is null and v_lead is null then
    raise exception 'Informe venda_id ou sdr_lead_id.' using errcode = '22023';
  end if;

  /*
   * A reunião VIVA, e não a última que existiu.
   *
   * Cancelada some da aba porque a aba responde "qual é a reunião deste card" — e
   * uma reunião cancelada não é a reunião do card, é história. A história está no
   * histórico da empresa, que é onde ela não confunde ninguém.
   */
  select * into v_e from public.vendedor_eventos
  where tipo = 'reuniao' and cancelado_em is null
    and ((v_venda is not null and venda_id = v_venda)
      or (v_lead is not null and sdr_lead_id = v_lead))
  order by inicio_em desc limit 1;

  if v_e.id is null then return null; end if;

  -- A RLS não vale dentro de SECURITY DEFINER; a mesma régua da policy, à mão.
  if not (public.app_pode_ver_vendedor(v_e.vendedor_id)
          or exists (select 1 from unnest(v_e.acompanhantes) a
                     where public.app_pode_ver_vendedor(a))) then
    return null;
  end if;

  select * into v_dono from public.vendedores where id = v_e.vendedor_id;
  select * into v_conta from public.gmail_contas
  where usuario_id = v_dono.usuario_id and ativo;

  return jsonb_build_object(
    'id', v_e.id,
    'titulo', v_e.titulo,
    'inicio_em', v_e.inicio_em,
    'duracao_min', v_e.duracao_min,
    'modalidade', v_e.modalidade,
    'local', v_e.local,
    'meet_url', v_e.meet_url,
    'descricao', v_e.descricao,
    'venda_id', v_e.venda_id,
    'sdr_lead_id', v_e.sdr_lead_id,
    'participantes', v_e.participantes,
    'anfitriao', jsonb_build_object('vendedor_id', v_dono.id, 'nome', v_dono.nome),
    'acompanhantes', coalesce((
      select jsonb_agg(jsonb_build_object('vendedor_id', v2.id, 'nome', v2.nome))
      from public.vendedores v2 where v2.id = any (v_e.acompanhantes)
    ), '[]'::jsonb),
    /*
     * O ESTADO DA SINCRONIZAÇÃO vai junto, e é metade do valor desta aba.
     *
     * "Não apareceu no meu Google Agenda" é uma pergunta que a tela tem que
     * responder sozinha, com a diferença entre as três causas: ainda na fila,
     * falhou com um motivo, ou o dono nunca conectou o Google / conectou antes
     * do Calendar existir. Cada uma se resolve num lugar diferente.
     */
    'google', jsonb_build_object(
      'evento_id', v_e.google_evento_id,
      'pendente', v_e.google_pendente_em is not null,
      'sincronizado_em', v_e.google_sincronizado_em,
      'erro', v_e.google_erro,
      'conta', v_conta.endereco,
      'tem_escopo_agenda',
        v_conta.usuario_id is not null
        and 'https://www.googleapis.com/auth/calendar.events' = any (v_conta.escopos)
    )
  );
end $function$;

-- ─── §6 O que a aba escreve ─────────────────────────────────────────────────

create or replace function public.app_salvar_reuniao(p jsonb)
returns public.vendedor_eventos language plpgsql security definer set search_path = '' as $function$
declare
  v_ator uuid := auth.uid();
  v_e public.vendedor_eventos;
  v_cancelar boolean := coalesce((p ->> 'cancelar')::boolean, false);
  v_modalidade text;
  v_local text;
  v_mudou_o_convite boolean;
begin
  if not public.app_tem_modulo('comercial') then
    raise exception 'Sem acesso ao módulo Comercial.' using errcode = '42501';
  end if;

  select * into v_e from public.vendedor_eventos where id = (p ->> 'id')::uuid;
  if v_e.id is null then
    raise exception 'Reunião não encontrada.' using errcode = 'no_data_found';
  end if;
  -- Quem não enxerga a reunião não a edita. A policy é de SELECT; aqui é a mesma
  -- régua aplicada à escrita, que a policy não cobre.
  if not (public.app_pode_ver_vendedor(v_e.vendedor_id)
          or exists (select 1 from unnest(v_e.acompanhantes) a
                     where public.app_pode_ver_vendedor(a))) then
    raise exception 'Sem acesso a esta reunião.' using errcode = '42501';
  end if;

  if v_cancelar then
    update public.vendedor_eventos set
      cancelado_em = now(),
      -- Pendente TAMBÉM no cancelamento: o Google precisa saber que a reunião
      -- morreu, senão o cliente aparece na sala sozinho no horário marcado.
      google_pendente_em = now(),
      atualizado_em = now()
    where id = v_e.id
    returning * into v_e;

    insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
    values (v_ator, 'comercial.reuniao_cancelada', 'vendedor_eventos', v_e.id::text, p);
    return v_e;
  end if;

  v_modalidade := coalesce(nullif(p ->> 'modalidade', ''), v_e.modalidade);
  v_local := case when p ? 'local' then nullif(p ->> 'local', '') else v_e.local end;
  if v_modalidade not in ('meet', 'presencial', 'telefone', 'a_definir') then
    raise exception 'Modalidade inválida.' using errcode = '22023';
  end if;
  if v_modalidade = 'presencial' and v_local is null then
    raise exception 'Reunião presencial exige o local.' using errcode = '22023';
  end if;

  update public.vendedor_eventos set
    inicio_em = coalesce(nullif(p ->> 'inicio_em', '')::timestamptz, inicio_em),
    duracao_min = coalesce((p ->> 'duracao_min')::int, duracao_min),
    modalidade = v_modalidade,
    local = v_local,
    descricao = case when p ? 'descricao' then nullif(p ->> 'descricao', '') else descricao end,
    participantes = coalesce(p -> 'participantes', participantes),
    /*
     * Voltar para a fila do Google é INCONDICIONAL numa edição.
     *
     * Tentei condicionar a "mudou algo que o Google conhece" e desisti: a lista de
     * campos que o Google conhece cresce com o tempo, e o dia em que alguém
     * acrescentar um campo sem lembrar de somá-lo à condição é o dia em que a
     * reunião passa a divergir em silêncio. Uma escrita a mais na API do Google
     * custa uma requisição; uma divergência silenciosa custa um cliente sozinho
     * numa sala.
     */
    google_pendente_em = now(),
    atualizado_em = now()
  where id = v_e.id
  returning * into v_e;

  v_mudou_o_convite := p ? 'participantes';

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'comercial.reuniao_salva', 'vendedor_eventos', v_e.id::text, p);

  if v_e.empresa_id is not null and v_mudou_o_convite then
    insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
    values (v_e.empresa_id, 'sdr.reuniao_agendada',
      jsonb_build_object(
        'resumo', 'Convidados da reunião atualizados ('
                  || jsonb_array_length(v_e.participantes) || ' do cliente).',
        'evento_id', v_e.id, 'venda_id', v_e.venda_id),
      v_ator);
  end if;

  return v_e;
end $function$;

grant execute on function public.app_reuniao_do_card(jsonb) to authenticated;
grant execute on function public.app_salvar_reuniao(jsonb) to authenticated;

-- ─── §7 A renovação do token para de apagar os escopos ──────────────────────

create or replace function public.app_salvar_gmail_conta(p jsonb)
returns public.gmail_contas language plpgsql security definer set search_path = '' as $function$
declare
  v_c public.gmail_contas;
  v_refresh uuid;
  v_access uuid;
  v_usuario uuid := (p ->> 'usuario_id')::uuid;
begin
  if nullif(p ->> 'refresh_token', '') is not null then
    v_refresh := vault.create_secret(
      p ->> 'refresh_token',
      'gmail_refresh_' || v_usuario::text || '_' || extract(epoch from now())::bigint::text,
      'Refresh token do Gmail (' || (p ->> 'endereco') || ').');
  end if;
  if nullif(p ->> 'access_token', '') is not null then
    v_access := vault.create_secret(
      p ->> 'access_token',
      'gmail_access_' || v_usuario::text || '_' || extract(epoch from now())::bigint::text,
      'Access token do Gmail (' || (p ->> 'endereco') || ').');
  end if;

  insert into public.gmail_contas as gc (
    usuario_id, endereco, refresh_token_secret_id, access_token_secret_id,
    access_token_expira_em, escopos, ativo, ultimo_erro
  ) values (
    v_usuario, lower(p ->> 'endereco'), v_refresh, v_access,
    nullif(p ->> 'access_token_expira_em', '')::timestamptz,
    coalesce((select array_agg(value #>> '{}') from jsonb_array_elements(coalesce(p -> 'escopos', '[]'::jsonb))), '{}'),
    true, null)
  on conflict (usuario_id) do update set
    endereco = excluded.endereco,
    refresh_token_secret_id = coalesce(excluded.refresh_token_secret_id, gc.refresh_token_secret_id),
    access_token_secret_id = coalesce(excluded.access_token_secret_id, gc.access_token_secret_id),
    access_token_expira_em = excluded.access_token_expira_em,
    /*
     * SÓ QUEM MANDA ESCOPOS ESCREVE ESCOPOS.
     *
     * Quem conhece as permissões concedidas é o callback do OAuth, que as recebe do
     * Google. A renovação de access token do worker chama esta mesma RPC sem elas —
     * e, com `excluded.escopos`, zerava a coluna na primeira renovação. As quatro
     * contas da base estão assim: `{}` com as três permissões do Gmail funcionando.
     */
    escopos = case when p ? 'escopos' then excluded.escopos else gc.escopos end,
    ativo = true,
    ultimo_erro = null
  returning gc.* into v_c;

  return v_c;
end $function$;

comment on function public.app_salvar_gmail_conta is
  'Grava a conexão do Google (tokens no Vault). `escopos` só é sobrescrito quando o '
  'chamador os informa — a renovação de token do worker não os conhece e apagava a coluna.';
