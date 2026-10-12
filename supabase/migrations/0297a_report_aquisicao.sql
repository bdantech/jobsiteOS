-- 0297a — Report semanal: bloco de Aquisição (04u). O drill-down é a 0297b; a conferência e as permissões, a 0297c.
--
-- Estende a 0192. NENHUM cálculo existente muda: `app__rp_operacao`, `_comercial` e
-- `_carteira` não são tocadas. `app__rp_montar` ganha uma chave nova (`aquisicao`) e só.
--
-- ─── O QUE O PROMPT SUPÔS E O BANCO NÃO TEM ─────────────────────────────────
-- 1. Não existe `leads`: é `sdr_leads`, e `origem` vale distribuicao | inbound | manual.
--    "Outbound" é tudo que não é inbound — a mesma leitura que o report já faz em
--    "45 in · 53 out". A coluna é NOT NULL; a linha "Sem origem" existe para a reunião
--    sem lead e para o dia em que isso deixar de ser verdade.
-- 2. `fit` é booleano COM nulo — já são três estados (true / false / null), e os 259
--    leads com fit definido têm todos `fit_definido_em`. Trocar o tipo para texto
--    reescreveria o funil, o Meu Dia e `app_mover_lead_sdr` para não ganhar nada.
--    O que faltava era QUEM avaliou: `fit_definido_por`, abaixo.
-- 3. A reunião é o `vendedor_eventos` (tipo = 'reuniao'), e remarcar ATUALIZA a mesma
--    linha (0201). Logo `criado_em` é "quando foi marcada" e `inicio_em` é "quando
--    acontece": os dois carimbos que o §5 pede já existem, e uma reunião remarcada não
--    tem como contar duas vezes como agendada. Não há coluna de status: o desfecho sai
--    do log de transições do lead e da captura do Fireflies (05C).

-- ─── §5 Quem avaliou o fit ──────────────────────────────────────────────────

alter table public.sdr_leads add column if not exists fit_definido_por uuid;

comment on column public.sdr_leads.fit_definido_por is
  'Quem definiu o fit (auth.uid()). Sem FK de propósito: um ator sem linha em usuarios não pode impedir o lead de andar. Nulo = definido por rotina, ou antes da 0297.';

/*
 * Por gatilho, e não dentro de `app_mover_lead_sdr`: aquela função tem 200 linhas, é o
 * caminho de todo o kanban e já foi reescrita cinco vezes. Carimbar aqui pega qualquer
 * escritor de `fit`, inclusive os que ainda não existem.
 */
create or replace function public.app__sdr_lead_fit_autor()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if new.fit is distinct from old.fit then
    new.fit_definido_por := case when new.fit is null then null else auth.uid() end;
  end if;
  return new;
end $function$;

drop trigger if exists sdr_leads_fit_autor on public.sdr_leads;
create trigger sdr_leads_fit_autor
  before update of fit on public.sdr_leads
  for each row execute function public.app__sdr_lead_fit_autor();

-- O "sem fit" sempre gravou um evento com o ator; o "com fit" nunca gravou. O passado
-- recuperável é só o primeiro, e é o que entra.
update public.sdr_leads l
   set fit_definido_por = ev.ator_usuario_id
  from (
    select distinct on (x.payload ->> 'lead_id')
           x.payload ->> 'lead_id' as lead_id, x.ator_usuario_id
    from public.empresa_eventos x
    where x.tipo = 'sdr.sem_fit' and x.ator_usuario_id is not null
    order by x.payload ->> 'lead_id', x.criado_em desc
  ) ev
 where ev.lead_id = l.id::text and l.fit is false and l.fit_definido_por is null;

-- ─── §6 Settings ────────────────────────────────────────────────────────────

alter table public.report_config
  add column if not exists max_linhas_drilldown integer not null default 5000,
  add column if not exists aquisicao_no_pdf boolean not null default true;

do $$ begin
  alter table public.report_config
    add constraint report_config_max_linhas_check
    check (max_linhas_drilldown between 100 and 50000);
exception when duplicate_object then null; end $$;

-- ─── §5 A tabela materializada ──────────────────────────────────────────────

create table if not exists public.report_aquisicao_semanal (
  semana_inicio date not null,
  semana_fim date not null,
  origem text not null check (origem in ('inbound', 'outbound', 'sem_origem')),
  com_fit integer not null default 0,
  sem_fit integer not null default 0,
  nao_avaliado integer not null default 0,
  expirados_sem_avaliar integer not null default 0,
  agendadas integer not null default 0,
  realizadas integer not null default 0,
  canceladas integer not null default 0,
  remarcadas integer not null default 0,
  no_shows integer not null default 0,
  sem_captura integer not null default 0,
  sem_desfecho integer not null default 0,
  atualizado_em timestamptz not null default now(),
  primary key (semana_inicio, origem),
  check (semana_fim = semana_inicio + 6)
);

comment on table public.report_aquisicao_semanal is
  'Bloco de Aquisição do report semanal, por semana FECHADA e origem. A semana em aberto nunca entra aqui: ela é calculada ao vivo. Reescrita por app_report_materializar_aquisicao().';

alter table public.report_aquisicao_semanal enable row level security;

drop policy if exists report_aquisicao_semanal_select on public.report_aquisicao_semanal;
create policy report_aquisicao_semanal_select on public.report_aquisicao_semanal
  for select using (public.app_report_gestor());

revoke all on public.report_aquisicao_semanal from anon, authenticated;
grant select on public.report_aquisicao_semanal to authenticated;

-- ─── Aquisição: os registros ────────────────────────────────────────────────

/*
 * A COORTE de leads da janela: quem foi distribuído nela. O fit é o de HOJE.
 *
 * Um lead que entrou na semana 40 e foi avaliado na 42 conta na 40 — a matriz responde
 * "do que entrou naquela semana, o que se mostrou bom", e não "o que foi avaliado nela".
 * Por isso a linha de uma semana fechada continua amadurecendo, e é esperado.
 */
create or replace function public.app__rp_aq_leads(p_inicio date, p_fim date)
returns table (
  lead_id uuid, empresa_id uuid, origem text, origem_bruta text, fit text,
  distribuido_em timestamptz, estagio text, sdr_id uuid,
  fit_definido_em timestamptz, fit_definido_por uuid, encerrado_motivo text
)
language sql
stable security definer
set search_path to ''
as $function$
  select l.id, l.empresa_id,
         case when l.origem is null then 'sem_origem'
              when l.origem = 'inbound' then 'inbound'
              else 'outbound' end,
         l.origem,
         -- Nulo é "ainda não avaliado", e NUNCA "sem fit": o lead que entrou na quinta e
         -- ninguém trabalhou não foi reprovado por ninguém.
         case when l.fit is true then 'com_fit'
              when l.fit is false then 'sem_fit'
              else 'nao_avaliado' end,
         l.distribuido_em, l.estagio, l.sdr_id,
         l.fit_definido_em, l.fit_definido_por, l.encerrado_motivo
  from public.sdr_leads l
  where (l.distribuido_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim;
$function$;

/*
 * Os FATOS de reunião da janela, um por linha. Cada fato tem a SUA data:
 *
 *   agendada ....... `criado_em` do evento: o dia em que foi MARCADA
 *   realizada ...... `inicio_em` do evento: o dia em que ACONTECEU
 *   sem_captura .... subconjunto de realizada, sem transcrição e sem `bot_entrou_em`
 *   sem_desfecho ... a hora passou e ninguém registrou nem realização nem no-show
 *   cancelada ...... `cancelado_em`
 *   remarcada ...... o evento `sdr.reuniao_agendada` com `remarcada = true`
 *   no_show ........ a transição do lead para `no_show`
 *
 * Agendada e realizada são POPULAÇÕES DIFERENTES — quem marcou na sexta realiza na
 * semana seguinte —, e por isso nenhuma taxa sai daqui dividindo uma pela outra.
 *
 * REALIZADA exige evidência: a transcrição chegou, ou o último desfecho do lead é
 * reunião realizada / qualificada. Um evento cuja hora passou sem evidência nenhuma
 * NÃO é contado como realizado; ele aparece em `sem_desfecho`, que é a fila de higiene.
 *
 * Limite conhecido: remarcar reaproveita a linha do evento, então a reunião conta na
 * data em que o evento está HOJE. Não há histórico de `inicio_em` para fazer diferente.
 */
create or replace function public.app__rp_aq_reunioes(p_inicio date, p_fim date)
returns table (
  fato text, evento_id uuid, lead_id uuid, empresa_id uuid, origem text,
  vendedor_id uuid, agendada_em timestamptz, inicio_em timestamptz,
  quando timestamptz, captura text
)
language sql
stable security definer
set search_path to ''
as $function$
  with captura_desde as (
    -- A captura (05C) começou em 05/10/2026. Antes disso TODA reunião é "sem captura", e
    -- contar isso faria o indicador nascer em 100% e parecer que melhorou sozinho.
    select min(r.criada_em) as em from public.reunioes r
  ), ev as (
    select e.id, e.sdr_lead_id, coalesce(e.empresa_id, l.empresa_id) as empresa_id,
           e.vendedor_id, e.criado_em, e.inicio_em, e.cancelado_em,
           case when l.id is null or l.origem is null then 'sem_origem'
                when l.origem = 'inbound' then 'inbound'
                else 'outbound' end as origem,
           r.captura_status, r.bot_entrou_em, r.transcricao_recebida_em,
           d.para as desfecho, l.estagio
    from public.vendedor_eventos e
    left join public.sdr_leads l on l.id = e.sdr_lead_id
    left join lateral (
      select r.captura_status, r.bot_entrou_em, r.transcricao_recebida_em
      from public.reunioes r where r.evento_id = e.id
      order by r.criada_em desc limit 1
    ) r on true
    left join lateral (
      select t.para
      from public.funil_transicoes t
      where t.funil = 'sdr' and t.item_id = e.sdr_lead_id
        and t.para in ('no_show', 'reuniao_realizada', 'qualificada')
      order by t.em desc limit 1
    ) d on true
    where e.tipo = 'reuniao'
  ), st as (
    select ev.*,
           (ev.cancelado_em is null and ev.inicio_em <= now()
            and (ev.transcricao_recebida_em is not null
                 or ev.desfecho in ('reuniao_realizada', 'qualificada')
                 -- Lead anterior ao log de transições (30/08/2026): vale o estágio.
                 or (ev.desfecho is null and ev.estagio in ('reuniao_realizada', 'qualificada')))
           ) as realizada
    from ev
  )
  select 'agendada', st.id, st.sdr_lead_id, st.empresa_id, st.origem, st.vendedor_id,
         st.criado_em, st.inicio_em, st.criado_em, st.captura_status
  from st
  where (st.criado_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim
  union all
  select 'realizada', st.id, st.sdr_lead_id, st.empresa_id, st.origem, st.vendedor_id,
         st.criado_em, st.inicio_em, st.inicio_em, st.captura_status
  from st
  where st.realizada
    and (st.inicio_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim
  union all
  select 'sem_captura', st.id, st.sdr_lead_id, st.empresa_id, st.origem, st.vendedor_id,
         st.criado_em, st.inicio_em, st.inicio_em, st.captura_status
  from st
  where st.realizada
    and st.transcricao_recebida_em is null and st.bot_entrou_em is null
    and st.inicio_em >= (select c.em from captura_desde c)
    and (st.inicio_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim
  union all
  select 'sem_desfecho', st.id, st.sdr_lead_id, st.empresa_id, st.origem, st.vendedor_id,
         st.criado_em, st.inicio_em, st.inicio_em, st.captura_status
  from st
  where not st.realizada and st.cancelado_em is null and st.inicio_em <= now()
    and st.desfecho is distinct from 'no_show'
    and (st.inicio_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim
  union all
  select 'cancelada', st.id, st.sdr_lead_id, st.empresa_id, st.origem, st.vendedor_id,
         st.criado_em, st.inicio_em, st.cancelado_em, st.captura_status
  from st
  where (st.cancelado_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim
  union all
  select 'remarcada', st.id, st.sdr_lead_id, st.empresa_id, st.origem, st.vendedor_id,
         st.criado_em, st.inicio_em, x.criado_em, st.captura_status
  from public.empresa_eventos x
  join st on st.id::text = x.payload ->> 'evento_id'
  where x.tipo = 'sdr.reuniao_agendada' and x.payload ->> 'remarcada' = 'true'
    and (x.criado_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim
  union all
  select 'no_show', e.id, l.id, l.empresa_id,
         case when l.origem is null then 'sem_origem'
              when l.origem = 'inbound' then 'inbound'
              else 'outbound' end,
         coalesce(e.vendedor_id, l.vendedor_destino_id), e.criado_em, e.inicio_em, t.em, null::text
  from public.funil_transicoes t
  join public.sdr_leads l on l.id = t.item_id
  left join lateral (
    select e.id, e.vendedor_id, e.criado_em, e.inicio_em
    from public.vendedor_eventos e
    where e.sdr_lead_id = l.id and e.tipo = 'reuniao'
    order by e.criado_em desc limit 1
  ) e on true
  where t.funil = 'sdr' and t.para = 'no_show'
    and (t.em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim;
$function$;

-- ─── Aquisição: o agregado ──────────────────────────────────────────────────

/*
 * Uma linha por origem, SEMPRE as três. O agregado é um `count` sobre as mesmas duas
 * funções que o drill-down lista — é o que garante que o número clicado e a lista aberta
 * não têm como divergir: não existem duas contas, existe uma e a sua contagem.
 */
create or replace function public.app__rp_aq_linhas(p_inicio date, p_fim date)
returns table (
  origem text, com_fit integer, sem_fit integer, nao_avaliado integer,
  expirados_sem_avaliar integer, agendadas integer, realizadas integer,
  canceladas integer, remarcadas integer, no_shows integer,
  sem_captura integer, sem_desfecho integer
)
language sql
stable security definer
set search_path to ''
as $function$
  with o(origem, ordem) as (values ('inbound', 1), ('outbound', 2), ('sem_origem', 3)),
  l as (
    select x.origem,
           count(*) filter (where x.fit = 'com_fit')::int as com_fit,
           count(*) filter (where x.fit = 'sem_fit')::int as sem_fit,
           count(*) filter (where x.fit = 'nao_avaliado')::int as nao_avaliado,
           count(*) filter (where x.fit = 'nao_avaliado' and x.encerrado_motivo = 'expirado')::int as expirados
    from public.app__rp_aq_leads(p_inicio, p_fim) x group by 1
  ), r as (
    select x.origem,
           count(*) filter (where x.fato = 'agendada')::int as agendadas,
           count(*) filter (where x.fato = 'realizada')::int as realizadas,
           count(*) filter (where x.fato = 'cancelada')::int as canceladas,
           count(*) filter (where x.fato = 'remarcada')::int as remarcadas,
           count(*) filter (where x.fato = 'no_show')::int as no_shows,
           count(*) filter (where x.fato = 'sem_captura')::int as sem_captura,
           count(*) filter (where x.fato = 'sem_desfecho')::int as sem_desfecho
    from public.app__rp_aq_reunioes(p_inicio, p_fim) x group by 1
  )
  select o.origem,
         coalesce(l.com_fit, 0), coalesce(l.sem_fit, 0), coalesce(l.nao_avaliado, 0),
         coalesce(l.expirados, 0),
         coalesce(r.agendadas, 0), coalesce(r.realizadas, 0), coalesce(r.canceladas, 0),
         coalesce(r.remarcadas, 0), coalesce(r.no_shows, 0),
         coalesce(r.sem_captura, 0), coalesce(r.sem_desfecho, 0)
  from o left join l using (origem) left join r using (origem)
  order by o.ordem;
$function$;

/*
 * O bloco de uma semana, como viaja no report. `em_aberto` segue a definição de semana
 * do 04q: fechada é a que o último dia JÁ PASSOU — num domingo, a semana ainda corre.
 *
 * "Sem origem" só aparece quando tem alguma coisa: uma linha de zeros permanente
 * ensinaria o leitor a ignorar justamente a linha que denuncia cadastro quebrado.
 */
create or replace function public.app__rp_aquisicao(p_inicio date, p_fim date)
returns jsonb
language sql
stable security definer
set search_path to ''
as $function$
  select jsonb_build_object(
    'inicio', p_inicio, 'fim', p_fim,
    'em_aberto', p_fim >= current_date,
    'calculado_em', now(),
    'origens', coalesce(jsonb_agg(to_jsonb(x)) filter (
      where x.origem <> 'sem_origem'
         or x.com_fit + x.sem_fit + x.nao_avaliado + x.agendadas + x.realizadas
            + x.canceladas + x.remarcadas + x.no_shows + x.sem_desfecho > 0), '[]'::jsonb))
  from public.app__rp_aq_linhas(p_inicio, p_fim) x;
$function$;

/*
 * Reescreve as semanas FECHADAS mais recentes. Todas, e não só a que acabou de fechar:
 * o fit de um lead da semana 38 definido hoje muda a linha da semana 38.
 */
create or replace function public.app_report_materializar_aquisicao(p_semanas integer default 13)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  -- A MESMA aritmética de `app_report_semanal`: o domingo da última semana fechada.
  v_fim date := current_date - extract(isodow from current_date)::int;
  v_n int := least(greatest(coalesce(p_semanas, 13), 1), 60);
  v_linhas int;
begin
  insert into public.report_aquisicao_semanal as t (
    semana_inicio, semana_fim, origem, com_fit, sem_fit, nao_avaliado,
    expirados_sem_avaliar, agendadas, realizadas, canceladas, remarcadas, no_shows,
    sem_captura, sem_desfecho, atualizado_em)
  select s.ini, s.ini + 6, x.origem, x.com_fit, x.sem_fit, x.nao_avaliado,
         x.expirados_sem_avaliar, x.agendadas, x.realizadas, x.canceladas, x.remarcadas,
         x.no_shows, x.sem_captura, x.sem_desfecho, now()
  from (select (v_fim - 6 - 7 * g)::date as ini from generate_series(0, v_n - 1) g) s
  cross join lateral public.app__rp_aq_linhas(s.ini, s.ini + 6) x
  on conflict (semana_inicio, origem) do update set
    com_fit = excluded.com_fit, sem_fit = excluded.sem_fit,
    nao_avaliado = excluded.nao_avaliado,
    expirados_sem_avaliar = excluded.expirados_sem_avaliar,
    agendadas = excluded.agendadas, realizadas = excluded.realizadas,
    canceladas = excluded.canceladas, remarcadas = excluded.remarcadas,
    no_shows = excluded.no_shows, sem_captura = excluded.sem_captura,
    sem_desfecho = excluded.sem_desfecho, atualizado_em = excluded.atualizado_em;
  get diagnostics v_linhas = row_count;
  return jsonb_build_object('semanas', v_n, 'linhas', v_linhas, 'ate', v_fim);
end $function$;

/*
 * A série semanal do "Mais detalhes": a semana em aberto (ao vivo) e as fechadas (da
 * tabela).
 *
 * VOLATILE de propósito. Antes de ler, confere se alguma coisa mudou depois da última
 * materialização — um lead, um evento, uma transição — e reescreve se mudou. É uma
 * consulta de quatro `max` contra recalcular treze semanas a cada abertura, e é o que
 * mantém a célula da tabela igual à lista que ela abre: a lista é sempre ao vivo.
 */
create or replace function public.app_report_aquisicao_historico(p_semanas integer default 13)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_fim date := current_date - extract(isodow from current_date)::int;
  v_n int := least(greatest(coalesce(p_semanas, 13), 1), 60);
  v_de date := v_fim - 6 - 7 * (v_n - 1);
  v_tem int; v_velha timestamptz; v_mudou timestamptz;
  v_fechadas jsonb;
begin
  if not public.app_report_gestor() then
    raise exception 'O Report Semanal é leitura de gestor.' using errcode = '42501';
  end if;

  select count(distinct t.semana_inicio), min(t.atualizado_em) into v_tem, v_velha
  from public.report_aquisicao_semanal t
  where t.semana_inicio between v_de and v_fim - 6;

  v_mudou := greatest(
    (select max(greatest(l.atualizado_em, l.distribuido_em)) from public.sdr_leads l),
    (select max(greatest(e.atualizado_em, e.criado_em, coalesce(e.cancelado_em, e.criado_em)))
       from public.vendedor_eventos e),
    (select max(t.em) from public.funil_transicoes t where t.funil = 'sdr'),
    (select max(r.atualizada_em) from public.reunioes r));

  if v_tem < v_n or v_velha is null or v_velha < coalesce(v_mudou, v_velha) then
    perform public.app_report_materializar_aquisicao(v_n);
  end if;

  select coalesce(jsonb_agg(s.semana order by s.ini desc), '[]'::jsonb) into v_fechadas
  from (
    select t.semana_inicio as ini,
           jsonb_build_object(
             'inicio', t.semana_inicio, 'fim', t.semana_fim, 'em_aberto', false,
             'calculado_em', max(t.atualizado_em),
             'origens', jsonb_agg(
               to_jsonb(t) - 'semana_inicio' - 'semana_fim' - 'atualizado_em'
               order by case t.origem when 'inbound' then 1 when 'outbound' then 2 else 3 end
             ) filter (
               where t.origem <> 'sem_origem'
                  or t.com_fit + t.sem_fit + t.nao_avaliado + t.agendadas + t.realizadas
                     + t.canceladas + t.remarcadas + t.no_shows + t.sem_desfecho > 0)
           ) as semana
    from public.report_aquisicao_semanal t
    where t.semana_inicio between v_de and v_fim - 6
    group by t.semana_inicio, t.semana_fim
  ) s;

  return jsonb_build_object(
    'calculado_em', now(),
    -- A primeira é a semana EM ABERTO. Ela nunca entra em média nem em total: quem soma
    -- é `agregarSemanas()` no core, e ela a recusa pelo `em_aberto`.
    'semanas', jsonb_build_array(public.app__rp_aquisicao(v_fim + 1, v_fim + 7)) || v_fechadas);
end $function$;

/** A porta do card: uma semana qualquer, recalculada a cada abertura. */
create or replace function public.app_report_aquisicao(p_inicio date default null, p_fim date default null)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  v_fim date := coalesce(p_fim, current_date - extract(isodow from current_date)::int);
  v_ini date := coalesce(p_inicio, v_fim - 6);
begin
  if not public.app_report_gestor() then
    raise exception 'O Report Semanal é leitura de gestor.' using errcode = '42501';
  end if;
  return public.app__rp_aquisicao(v_ini, v_fim);
end $function$;

-- ─── O report ganha o bloco ─────────────────────────────────────────────────
-- Idêntica à anterior, mais a chave `aquisicao`. Nada do que existia mudou de lugar.

create or replace function public.app__rp_montar(p_inicio date, p_fim date, p_retrato date default null::date)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  v_semana int := extract(week from p_fim)::int;
  v_mes_ini date := date_trunc('month', p_fim)::date;
  v_ret date := coalesce(p_retrato, p_fim);
  v_cart_em date;
begin
  -- De que dia é a carteira que entrou nos estoques. Ao vivo é hoje; no passado é a captura
  -- usada, que pode não ser exatamente `v_ret` se o sincronizador falhou naquele dia. O
  -- campo existe para a página poder escrever a data em vez de deixar o leitor supor.
  if v_ret >= current_date then
    v_cart_em := current_date;
  else
    select max(s.capturado_em) into v_cart_em
    from public.clientes_onepay_snapshots s where s.capturado_em <= v_ret;
    v_cart_em := coalesce(v_cart_em, current_date);
  end if;

  return jsonb_build_object(
    'periodo', jsonb_build_object(
      'inicio', p_inicio, 'fim', p_fim,
      'semana_iso', v_semana,
      'ano', extract(isoyear from p_fim)::int,
      'mes_inicio', v_mes_ini,
      /* O mês é PARCIAL, e a estrutura diz quanto: comparar seis dias de setembro com a
         média de um mês inteiro sem avisar faria toda primeira semana parecer um desastre. */
      'mes_dias_decorridos', (p_fim - v_mes_ini + 1),
      'mes_dias_total', extract(day from (v_mes_ini + interval '1 month - 1 day'))::int,
      'base_12m_de', (date_trunc('month', p_fim) - interval '11 months')::date,
      'base_12m_ate', v_mes_ini,
      -- A data em que os ESTOQUES foram lidos. Os FLUXOS são sempre de `inicio`..`fim`.
      'retrato_em', v_ret,
      'retrato_carteira_em', v_cart_em,
      'ao_vivo', (v_ret <> p_fim),
      'gerado_em', now()
    ),
    'operacao', public.app__rp_operacao(p_inicio, p_fim, v_ret),
    'comercial', public.app__rp_comercial(p_inicio, p_fim, v_ret),
    'carteira', public.app__rp_carteira(p_inicio, p_fim, v_ret),
    -- 04u. Sempre lido AGORA, inclusive no PDF: o fit amadurece, e `calculado_em` é o
    -- carimbo que explica por que o e-mail de segunda difere da tela de quarta.
    'aquisicao', public.app__rp_aquisicao(p_inicio, p_fim)
  );
end $function$;
