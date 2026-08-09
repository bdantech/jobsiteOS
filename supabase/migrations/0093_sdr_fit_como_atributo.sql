-- 0093 — Fit sai do funil e vira atributo do lead.
--
-- `com_fit` e `sem_fit` eram COLUNAS do kanban, e isso estava errado de duas formas.
--
-- Fit não é um lugar por onde o lead passa: é um julgamento sobre a empresa, feito
-- depois do primeiro contato, e que continua valendo em qualquer etapa seguinte. Um
-- lead pode ter fit e ainda estar em conversa; pode ter fit e já ter tido reunião.
--
-- E marcar "sem fit" MOVIA o card, apagando a informação de até onde ele tinha chegado.
-- Um lead que morreu antes do primeiro contato e um que morreu depois de uma reunião
-- viravam a mesma linha na mesma coluna — e a diferença entre os dois é exatamente o
-- que se quer saber ao revisar a régua do Mercado.
--
-- Agora o estágio guarda ONDE o lead está, `fit` guarda O QUE se achou dele, e
-- `encerrado_em` guarda que ele parou — sem mexer no estágio, que continua contando a
-- história.
--
-- `desqualificada` sai junto: ela era usada só pelo SLA para devolver o lead ao pool, e
-- isso agora é `encerrado_motivo = 'expirado'`. "Desqualificada" dizia que a empresa
-- não presta, quando o que houve foi ninguém ter tocado nela.
--
-- Aplicada no banco em `sdr_fit_como_atributo` + `sdr_mover_lead_com_fit`.

alter table public.sdr_leads
  -- null = ainda não avaliado. É um estado real e comum: o lead existe, ninguém falou
  -- com a empresa ainda, e forçar true/false aqui obrigaria a chutar.
  add column fit boolean,
  add column fit_definido_em timestamptz,
  add column encerrado_em timestamptz,
  add column encerrado_motivo text
    constraint sdr_leads_encerrado_motivo_check
    check (encerrado_motivo is null or encerrado_motivo in ('sem_fit', 'expirado'));

comment on column public.sdr_leads.fit is
  'Julgamento sobre a empresa, feito após o contato. NULL = não avaliado. Independe do '
  'estágio: um lead pode ter fit e ainda estar em conversa.';
comment on column public.sdr_leads.encerrado_em is
  'O lead parou. O ESTÁGIO não muda — é ele que diz até onde o lead chegou antes de '
  'morrer, e essa distância é o dado que revisa a régua do Mercado.';

-- Remapeia o que existia. A base estava vazia, mas a migração tem de valer numa base
-- com dados: replayar isto depois de um restore não pode perder lead.
update public.sdr_leads set
  fit = true, fit_definido_em = coalesce(atualizado_em, now()), estagio = 'em_conversa'
where estagio = 'com_fit';

update public.sdr_leads set
  fit = false, fit_definido_em = coalesce(atualizado_em, now()),
  encerrado_em = coalesce(atualizado_em, now()), encerrado_motivo = 'sem_fit',
  estagio = 'em_conversa'
where estagio = 'sem_fit';

update public.sdr_leads set
  encerrado_em = coalesce(atualizado_em, now()), encerrado_motivo = 'expirado',
  estagio = 'a_contatar'
where estagio = 'desqualificada';

-- A ordem do CHECK é a ordem do kanban, e `no_show` vem logo depois de
-- `reuniao_agendada`: é a sequência do que acontece, não uma caixa de descarte no fim.
alter table public.sdr_leads drop constraint sdr_leads_estagio_check;
alter table public.sdr_leads add constraint sdr_leads_estagio_check
  check (estagio in (
    'a_contatar', 'em_conversa', 'reuniao_agendada', 'no_show', 'reuniao_realizada', 'qualificada'
  ));

drop index if exists public.sdr_leads_sla_idx;
create index sdr_leads_sla_idx
  on public.sdr_leads (estagio, coalesce(ultimo_toque_em, distribuido_em))
  where estagio = 'a_contatar' and encerrado_em is null;

-- A distribuição pergunta "esta empresa tem lead vivo, ou foi recusada há pouco?".
create index sdr_leads_vivos_idx on public.sdr_leads (empresa_id) where encerrado_em is null;

-- ─── A RPC passa a tratar fit como atributo ─────────────────────────────────
-- O payload aceita `estagio` (mover), `fit` (julgar) ou os dois. Marcar sem fit ENCERRA
-- o lead — mas não mexe no estágio, que continua dizendo até onde ele chegou.
-- Definição completa em `sdr_mover_lead_com_fit`; ver pg_get_functiondef para a viva.

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
  v_empresa public.empresas;
  v_venda_id uuid;
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
  if v_estagio = 'reuniao_agendada' and (v_reuniao is null or v_destino is null) then
    raise exception 'Agendar exige data e vendedor destino.' using errcode = '22023';
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
    insert into public.vendas (empresa_id, vendedor_id, sdr_lead_id, estagio)
    values (v_lead.empresa_id, v_destino, v_lead.id, 'reuniao_agendada')
    returning id into v_venda_id;

    insert into public.vendedor_eventos (vendedor_id, empresa_id, titulo, inicio_em, sdr_lead_id, venda_id, criado_por)
    values
      (v_destino, v_lead.empresa_id,
       'Reunião — ' || coalesce(v_empresa.razao_social, 'empresa'), v_reuniao, v_lead.id, v_venda_id, v_ator),
      (v_lead.sdr_id, v_lead.empresa_id,
       'Reunião (agendada por mim) — ' || coalesce(v_empresa.razao_social, 'empresa'), v_reuniao, v_lead.id, v_venda_id, v_ator);

    insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
    values (v_lead.empresa_id, 'sdr.reuniao_agendada',
      jsonb_build_object(
        'resumo', 'Reunião agendada para ' || to_char(v_reuniao at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') || '.',
        'url', '/comercial/vendas/' || v_venda_id,
        'lead_id', v_lead.id, 'venda_id', v_venda_id, 'vendedor_destino_id', v_destino),
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
