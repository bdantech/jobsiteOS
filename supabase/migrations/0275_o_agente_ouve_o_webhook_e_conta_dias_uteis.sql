-- ============================================================================
-- 0275 — O webhook da Ana deixa rastro, o mandato conta dias úteis, uma ligação por
-- vez por mandato, e a tentativa guarda o que o cliente respondeu
--
-- A análise dos dois primeiros mandatos (03/10/2026) achou:
--
--   1. Nenhum resultado de ligação voltou, e não havia como saber por quê: o webhook não
--      guardava o que recebia, e respondia 200 até ao corpo que descartava. A tabela
--      `voz_webhooks` guarda TODA requisição que chega em /webhooks/voz — assinatura
--      válida ou não —, antes de qualquer validação, com o status que devolvemos.
--   2. O mandato da Formas foi criado numa quinta com prazo de 3 dias e expirou no domingo,
--      antes de a Ana voltar a agir na segunda. O prazo passa a ser em DIAS ÚTEIS.
--   3. O agente pediu ligação para o fixo 2 com o fixo 1 ainda sem resultado. A trava de
--      ligação aberta era por (mandato, contato); passa a ser por mandato.
--   4. `contatos_tentados` dizia "mensagem enfileirada" para sempre. A resposta do cliente
--      agora marca a tentativa daquele contato.
--
-- As funções recriadas partem de `pg_get_functiondef` em 05/10/2026; grants reafirmados.
-- ============================================================================

-- ─── 1. Todo webhook da voz, cru ────────────────────────────────────────────

create table if not exists public.voz_webhooks (
  id uuid primary key default gen_random_uuid(),
  recebido_em timestamptz not null default now(),
  assinatura_ok boolean not null,
  status_http int,
  evento text,
  id_externo text,
  ligacao_id text,
  -- O corpo como JSON quando ele é JSON; senão o texto, para não perder nada.
  corpo jsonb,
  corpo_texto text,
  erro text
);

create index if not exists voz_webhooks_recebido_em_idx on public.voz_webhooks (recebido_em desc);
create index if not exists voz_webhooks_id_externo_idx on public.voz_webhooks (id_externo);

comment on table public.voz_webhooks is
  'Toda requisição recebida em POST /webhooks/voz, antes de validar: assinatura, status devolvido e corpo cru. É como se descobre por que um resultado da Ana não entrou.';

alter table public.voz_webhooks enable row level security;
revoke all on public.voz_webhooks from anon, authenticated;
grant select on public.voz_webhooks to authenticated;
-- Só admin lê: o corpo traz transcrição de ligação gravada de uma pessoa real.
drop policy if exists voz_webhooks_select on public.voz_webhooks;
create policy voz_webhooks_select on public.voz_webhooks
  for select to authenticated using ((select public.app_is_admin()));

-- ─── 2. Dias úteis ──────────────────────────────────────────────────────────

/*
 * `p_inicio` mais `p_dias` dias úteis (segunda a sexta, no fuso de São Paulo), mantendo a
 * hora. Feriado não entra: o calendário de feriados não existe no banco, e um dia a mais de
 * prazo num feriado é um erro barato.
 */
create or replace function public.app__somar_dias_uteis(p_inicio timestamptz, p_dias int)
returns timestamptz language plpgsql immutable set search_path = '' as $$
declare
  v_t timestamptz := p_inicio;
  v_n int := 0;
begin
  while v_n < greatest(p_dias, 0) loop
    v_t := v_t + interval '1 day';
    if extract(isodow from (v_t at time zone 'America/Sao_Paulo')) < 6 then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_t;
end $$;

revoke all on function public.app__somar_dias_uteis(timestamptz, int) from public, anon;
grant execute on function public.app__somar_dias_uteis(timestamptz, int) to authenticated, service_role;

-- Mudou só o `expira_em`: `prazo_dias` agora é em dias úteis.
create or replace function public.app__agentes_criar_mandato(p jsonb)
returns public.mandatos language plpgsql security definer set search_path = '' as $$
declare
  v_tipo text := p ->> 'tipo';
  v_empresa uuid := (p ->> 'empresa_id')::uuid;
  v_agente uuid := (p ->> 'agente_id')::uuid;
  v_a public.vendedores;
  v_e public.empresas;
  v_ativos int;
  v_cota int;
  v_m public.mandatos;
begin
  select * into v_a from public.vendedores where id = v_agente;
  if v_a.id is null or not v_a.is_ia then
    raise exception 'Mandato só pode ser delegado a um vendedor de IA.' using errcode = '22023';
  end if;
  if not v_a.ativo then
    raise exception 'O agente % está inativo.', v_a.nome using errcode = '22023';
  end if;

  select * into v_e from public.empresas where id = v_empresa;
  if v_e.id is null then
    raise exception 'Empresa não encontrada.' using errcode = 'no_data_found';
  end if;
  if coalesce(v_e.bloqueio_cobranca, false)
     or (v_e.cnpj is not null and public.app_cobranca_sacado_bloqueado(v_e.cnpj)) then
    raise exception 'A empresa está em cobrança: contato comercial suspenso (Prompt 07).'
      using errcode = '42501', detail = 'em_cobranca';
  end if;
  if exists (select 1 from public.supressao s
              where s.escopo = 'empresa' and s.valor = v_e.cnpj
                and (s.expira_em is null or s.expira_em >= current_date)) then
    raise exception 'A empresa está suprimida.' using errcode = '42501', detail = 'suprimido';
  end if;

  if exists (select 1 from public.mandatos m
              where m.empresa_id = v_empresa and m.tipo = v_tipo
                and m.estado in ('aberto', 'em_andamento', 'aguardando_externo', 'pausado')) then
    raise exception 'Já existe um mandato ativo deste tipo para esta empresa.'
      using errcode = '23505', detail = 'mandato_ativo';
  end if;

  select count(*) into v_ativos from public.mandatos
   where agente_id = v_agente and estado in ('aberto', 'em_andamento', 'aguardando_externo');
  v_cota := coalesce((v_a.limites ->> 'mandatos_ativos')::int, 25);
  if v_ativos >= v_cota then
    raise exception 'O agente % já tem % mandatos ativos (cota %).', v_a.nome, v_ativos, v_cota
      using errcode = '54000', detail = 'cota_mandatos';
  end if;

  insert into public.mandatos (
    codigo, tipo, objetivo, empresa_id, nota_access_key, agente_id, playbook_id,
    prioridade, orcamento_centavos, max_acoes, expira_em, proxima_acao_em,
    origem, regra_id, proposta_id, criado_por
  ) values (
    public.app__agentes_proximo_codigo(), v_tipo, p ->> 'objetivo', v_empresa,
    nullif(p ->> 'nota_access_key', ''), v_agente, nullif(p ->> 'playbook_id', '')::uuid,
    coalesce((p ->> 'prioridade')::int, 50),
    (p ->> 'orcamento_centavos')::int, (p ->> 'max_acoes')::int,
    public.app__somar_dias_uteis(now(), (p ->> 'prazo_dias')::int), now(),
    coalesce(p ->> 'origem', 'manual'), nullif(p ->> 'regra_id', '')::uuid,
    nullif(p ->> 'proposta_id', '')::uuid, nullif(p ->> 'criado_por', '')::uuid
  )
  returning * into v_m;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_empresa, 'mandato.criado',
    jsonb_build_object('mandato_id', v_m.id, 'codigo', v_m.codigo, 'tipo', v_m.tipo,
      'agente_id', v_agente, 'origem', v_m.origem,
      'resumo', v_a.nome || ' recebeu o mandato ' || v_m.codigo || ': ' || v_m.objetivo,
      'url', '/agentes/mandatos?m=' || v_m.id),
    nullif(p ->> 'criado_por', '')::uuid);

  return v_m;
end $$;

revoke all on function public.app__agentes_criar_mandato(jsonb) from public, anon, authenticated;
grant execute on function public.app__agentes_criar_mandato(jsonb) to service_role;

-- ─── 3. Uma ligação aberta por mandato ──────────────────────────────────────

-- Mudou só a trava de ligação aberta: por mandato, qualquer contato.
create or replace function public.app__voz_enfileirar_mandato(p jsonb)
returns public.voz_ligacoes language plpgsql security definer set search_path = '' as $$
declare
  v_m public.mandatos;
  v_contato uuid := nullif(p ->> 'contato_id', '')::uuid;
  v_telefone text := public.app__telefone_e164(p ->> 'telefone');
  v_objetivo text := coalesce(nullif(p ->> 'objetivo', ''), 'ofertar_antecipacao');
  v_access_key text;
  v_cnpj text;
  v_motivo text;
  v_n int;
  v_tentativa int;
  v_linha public.voz_ligacoes;
begin
  select * into v_m from public.mandatos where id = (p ->> 'mandato_id')::uuid;
  if v_m.id is null then
    raise exception 'Mandato não encontrado.' using errcode = 'no_data_found';
  end if;
  v_access_key := case when v_objetivo = 'ofertar_antecipacao' then v_m.nota_access_key else null end;
  select cnpj into v_cnpj from public.empresas where id = v_m.empresa_id;

  v_motivo := public.app__voz_portao(v_telefone, v_contato, v_m.empresa_id, v_cnpj, v_access_key);
  if v_motivo is not null then
    raise exception '%', public.app__voz_portao_mensagem(v_motivo) using errcode = '42501', detail = v_motivo;
  end if;

  if exists (select 1 from public.voz_ligacoes
              where mandato_id = v_m.id and status in ('a_enviar', 'enviada')) then
    raise exception 'Já existe uma ligação deste mandato na fila ou em curso.'
      using errcode = '23505', detail = 'ligacao_aberta';
  end if;

  select count(*) + 1 into v_n from public.voz_ligacoes where mandato_id = v_m.id;
  if v_access_key is not null then
    select coalesce(max(tentativa), 0) + 1 into v_tentativa from public.voz_ligacoes where access_key = v_access_key;
  end if;

  insert into public.voz_ligacoes (
    access_key, tentativa, id_externo, fornecedor_cnpj, empresa_id, contato_id, telefone,
    status, pedido, origem, objetivo, mandato_id, agendada_para
  ) values (
    v_access_key, coalesce(v_tentativa, 1), v_m.codigo || ':' || v_n,
    case when v_access_key is not null then (select fornecedor_cnpj from public.notas_fiscais where access_key = v_access_key) else null end,
    v_m.empresa_id, v_contato, v_telefone, 'a_enviar',
    jsonb_build_object('contexto', p -> 'contexto'),
    'agente', v_objetivo, v_m.id, nullif(p ->> 'agendada_para', '')::timestamptz
  )
  returning * into v_linha;
  return v_linha;
end $$;

revoke all on function public.app__voz_enfileirar_mandato(jsonb) from public, anon, authenticated;
grant execute on function public.app__voz_enfileirar_mandato(jsonb) to service_role;

-- ─── 4. A resposta do cliente marca a tentativa ─────────────────────────────

-- Mudou: a mensagem recebida de um contato marca a tentativa dele nos mandatos ativos da
-- empresa (`ultimo_resultado`, `respondeu_em`). O resto é a versão da 0271b.
create or replace function public.comunicacoes__acorda_quem_espera()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.direcao = 'entrada' then
    if new.empresa_id is not null and new.conversa_id is not null then
      insert into public.mandato_conversas (mandato_id, conversa_id)
      select m.id, new.conversa_id from public.mandatos m
       where m.empresa_id = new.empresa_id
         and m.estado in ('aberto', 'em_andamento', 'aguardando_externo')
      on conflict do nothing;
    end if;
    if new.conversa_id is not null then
      update public.conversas c set proxima_acao_em = now()
       where c.id = new.conversa_id
         and c.modo_agente <> 'desligado'
         and c.status not in ('encerrada', 'aguardando_humano')
         and (c.proxima_acao_em is null or c.proxima_acao_em > now())
         and not exists (
           select 1 from public.mandato_conversas mc
             join public.mandatos m on m.id = mc.mandato_id
            where mc.conversa_id = c.id
              and m.estado in ('aberto', 'em_andamento', 'aguardando_externo'));
    end if;
    if new.contato_id is not null and new.empresa_id is not null then
      update public.mandatos m set contatos_tentados = (
        select coalesce(jsonb_agg(
                 case when t ->> 'contato_id' = new.contato_id::text
                      then t || jsonb_build_object('ultimo_resultado', 'respondeu por ' || coalesce(new.canal, 'mensagem'),
                                                   'respondeu_em', now())
                      else t end), '[]'::jsonb)
          from jsonb_array_elements(m.contatos_tentados) t)
       where m.empresa_id = new.empresa_id
         and m.estado in ('aberto', 'em_andamento', 'aguardando_externo')
         and m.contatos_tentados @> jsonb_build_array(jsonb_build_object('contato_id', new.contato_id::text));
    end if;
    update public.mandatos m set
      proxima_acao_em = now(),
      estado = case when m.estado = 'aguardando_externo' then 'em_andamento' else m.estado end
     where m.estado in ('aberto', 'em_andamento', 'aguardando_externo')
       and (
         (new.conversa_id is not null and exists (
            select 1 from public.mandato_conversas mc
             where mc.mandato_id = m.id and mc.conversa_id = new.conversa_id))
         or (new.empresa_id is not null and m.empresa_id = new.empresa_id)
       );
  elsif new.direcao = 'saida' and new.conversa_id is not null and not coalesce(new.por_ia, false) then
    update public.conversas set status = 'aguardando_resposta'
     where id = new.conversa_id and status = 'aguardando_humano';
  end if;
  return new;
end $$;

revoke all on function public.comunicacoes__acorda_quem_espera() from public, anon, authenticated;
grant execute on function public.comunicacoes__acorda_quem_espera() to service_role;
