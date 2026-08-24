-- ─── O histórico de passagem por etapa ──────────────────────────────────────
--
-- `vendas` e `sdr_leads` guardam o estágio ATUAL. Isso responde "onde o card está" e nunca
-- "quanto tempo ele ficou em cada lugar" — e é a segunda pergunta que diz onde o funil
-- trava. Sem uma linha por transição, lead time por etapa não é calculável, nem hoje nem
-- retroativamente: o instante em que um card entrou numa etapa que já deixou não está
-- gravado em lugar nenhum.
--
-- A série começa vazia e passa a valer daqui para frente. É honesto e é o único caminho:
-- inferir passagens que ninguém registrou produziria um lead time bonito e falso.
--
-- ── CONVERSÃO NÃO PRECISA DISTO ─────────────────────────────────────────────
-- Ela é calculável desde hoje, e a razão é uma decisão de desenho que já estava tomada:
-- perder NÃO move o card. O estágio continua marcando até onde o negócio chegou antes de
-- morrer, então "quantos alcançaram a etapa N" sai da posição atual — as etapas são
-- ordenadas, e quem está na 5 passou pelas quatro anteriores.

create table public.funil_transicoes (
  id uuid primary key default gen_random_uuid(),
  funil text not null constraint funil_transicoes_funil_check check (funil in ('sdr', 'vendedor')),
  item_id uuid not null,
  vendedor_id uuid not null references public.vendedores (id) on delete cascade,
  -- `null` na criação: o card nasceu nesta etapa, não veio de outra.
  de text,
  para text not null,
  em timestamptz not null default now()
);

create index funil_transicoes_item_idx on public.funil_transicoes (funil, item_id, em);
create index funil_transicoes_analise_idx on public.funil_transicoes (funil, vendedor_id, em desc);

comment on table public.funil_transicoes is
  'Uma linha por mudança de etapa, nos dois funis. Existe para o lead time por etapa, que '
  'a posição atual do card não consegue responder. Só é escrita por trigger.';

alter table public.funil_transicoes enable row level security;

create policy funil_transicoes_select on public.funil_transicoes
  for select using (public.app_pode_ver_vendedor(vendedor_id));

grant select on public.funil_transicoes to authenticated;

-- ── As triggers ─────────────────────────────────────────────────────────────
-- Escrita só por trigger, e nenhum grant de insert: uma transição que a aplicação pudesse
-- inventar deixaria de ser história e passaria a ser opinião.

create or replace function public.registrar_transicao_venda()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.funil_transicoes (funil, item_id, vendedor_id, de, para)
    values ('vendedor', new.id, new.vendedor_id, null, new.estagio);
  elsif new.estagio is distinct from old.estagio then
    insert into public.funil_transicoes (funil, item_id, vendedor_id, de, para)
    values ('vendedor', new.id, new.vendedor_id, old.estagio, new.estagio);
  end if;
  return new;
end; $$;

create trigger vendas_transicao
  after insert or update of estagio on public.vendas
  for each row execute function public.registrar_transicao_venda();

create or replace function public.registrar_transicao_lead()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.funil_transicoes (funil, item_id, vendedor_id, de, para)
    values ('sdr', new.id, new.sdr_id, null, new.estagio);
  elsif new.estagio is distinct from old.estagio then
    insert into public.funil_transicoes (funil, item_id, vendedor_id, de, para)
    values ('sdr', new.id, new.sdr_id, old.estagio, new.estagio);
  end if;
  return new;
end; $$;

create trigger sdr_leads_transicao
  after insert or update of estagio on public.sdr_leads
  for each row execute function public.registrar_transicao_lead();

-- ── A análise ───────────────────────────────────────────────────────────────
create or replace function public.app_funil_analise(p jsonb)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_funil text := coalesce(p ->> 'funil', 'vendedor');
  v_vendedor uuid := nullif(p ->> 'vendedor_id', '')::uuid;
  v_etapas text[];
  v_resultado jsonb;
begin
  v_etapas := case when v_funil = 'sdr'
    then array['a_contatar','em_conversa','reuniao_agendada','no_show','reuniao_realizada','qualificada']
    else array['reuniao_agendada','reuniao_reagendada','aguardando_documentacao','em_analise_credito',
               'proposta_enviada','preparacao_mou','mou_assinado','onboarding']
  end;

  with itens as (
    select v.id, v.estagio, v.vendedor_id,
           (v.situacao = 'perdido') as morreu,
           (v.situacao = 'ganho') as ganhou
    from public.vendas v
    where v_funil = 'vendedor' and (v_vendedor is null or v.vendedor_id = v_vendedor)
    union all
    select l.id, l.estagio, l.sdr_id,
           (l.encerrado_em is not null) as morreu,
           (l.estagio = 'qualificada') as ganhou
    from public.sdr_leads l
    where v_funil = 'sdr' and (v_vendedor is null or l.sdr_id = v_vendedor)
  ),
  -- `alcancaram` conta quem está NESTA etapa ou adiante. Só funciona porque perder não
  -- move o card: o estágio de um negócio morto ainda diz até onde ele chegou.
  posicoes as (
    select i.*, array_position(v_etapas, i.estagio) as pos from itens i
  ),
  por_etapa as (
    select
      e.ord,
      e.etapa,
      count(*) filter (where p2.pos >= e.ord)                       as alcancaram,
      count(*) filter (where p2.pos = e.ord)                        as aqui_agora,
      count(*) filter (where p2.pos = e.ord and p2.morreu)          as morreram_aqui
    from unnest(v_etapas) with ordinality as e(etapa, ord)
    left join posicoes p2 on true
    group by e.ord, e.etapa
  ),
  -- Mediana do tempo entre entrar numa etapa e sair dela. `percentile_cont` sobre o
  -- intervalo, e não média: uma negociação parada há oito meses arrastaria a média de
  -- todas as outras e faria a etapa parecer lenta quando ela não é.
  tempos as (
    select
      t.para as etapa,
      percentile_cont(0.5) within group (
        order by extract(epoch from (coalesce(prox.em, now()) - t.em)) / 86400
      ) as dias_mediana,
      count(*) as amostras
    from public.funil_transicoes t
    left join lateral (
      select t2.em from public.funil_transicoes t2
      where t2.funil = t.funil and t2.item_id = t.item_id and t2.em > t.em
      order by t2.em limit 1
    ) prox on true
    where t.funil = v_funil
      and (v_vendedor is null or t.vendedor_id = v_vendedor)
    group by t.para
  )
  select jsonb_agg(
    jsonb_build_object(
      'etapa', pe.etapa,
      'ordem', pe.ord,
      'alcancaram', pe.alcancaram,
      'aqui_agora', pe.aqui_agora,
      'morreram_aqui', pe.morreram_aqui,
      -- Conversão é para a etapa SEGUINTE: de quem chegou aqui, quantos passaram adiante.
      -- A última etapa não tem seguinte, e devolver 100% ali seria inventar um sucesso.
      'seguiram', coalesce(seg.alcancaram, 0),
      'conversao', case when pe.alcancaram > 0 and seg.alcancaram is not null
                        then round(seg.alcancaram::numeric / pe.alcancaram, 4)
                        else null end,
      'dias_mediana', tp.dias_mediana,
      'amostras_tempo', coalesce(tp.amostras, 0)
    ) order by pe.ord
  )
  into v_resultado
  from por_etapa pe
  left join por_etapa seg on seg.ord = pe.ord + 1
  left join tempos tp on tp.etapa = pe.etapa;

  return coalesce(v_resultado, '[]'::jsonb);
end; $$;

comment on function public.app_funil_analise is
  'Conversão e lead time por etapa, para um funil e opcionalmente um vendedor. Conversão '
  'sai da posição atual dos cards (perder não move o card); lead time sai de '
  'funil_transicoes e só existe para o que passou depois de 23/08/2026.';

revoke execute on function public.app_funil_analise(jsonb) from public;
grant execute on function public.app_funil_analise(jsonb) to authenticated;
