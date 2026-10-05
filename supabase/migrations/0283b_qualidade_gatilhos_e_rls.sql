-- ═════════════════════════════════════════════════════════════════════════════
-- 0283b — Inteligência de Conversas (05C): gatilhos e RLS
--
-- ─── QUEM VÊ O QUÊ (§12) ────────────────────────────────────────────────────
-- - Transcrição e captura: quem já vê a REUNIÃO (dono, acompanhante, quem tem acesso a
--   eles) ou a EMPRESA. É o mesmo dado que a aba Reunião já mostrava, mais o texto.
-- - Análise: o PRÓPRIO vendedor e gestores. Um vendedor não vê a análise de outro — nem
--   o auxiliar a do closer, nem o closer a do SDR que acompanhou. A nota é de coaching, e
--   coaching em público vira ranking, que o §15 deixa explicitamente fora.
-- - Análise de agente de IA (e de ligação da Ana sem mandato): gestores.
-- - Rubrica: todo o comercial lê — é a régua, e a régua tem de ser pública para quem é
--   medido por ela.
-- - Calibração, fila, webhooks, segredos: gestores (os segredos, nem eles).
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── Leitura de config pelo banco ───────────────────────────────────────────

create or replace function public.app__qualidade_cfg(p_chave text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select valor from public.qualidade_config where chave = p_chave), '{}'::jsonb)
$$;

/* Desligada até alguém ligar: sem conta configurada, o convite poria o notetaker numa
   reunião de cliente sem ninguém para receber o transcript. */
create or replace function public.app__qualidade_captura_ligada()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((public.app__qualidade_cfg('captura') ->> 'ligada')::boolean, false)
$$;

/* A análise de quem o chamador pode ver: a própria, ou qualquer uma se for gestor. */
create or replace function public.app__qualidade_ve_analise(p_vendedor_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.app_gestor_comercial()
      or (p_vendedor_id is not null and p_vendedor_id = public.app_vendedor_atual())
$$;

revoke all on function public.app__qualidade_cfg(text) from public, anon;
revoke all on function public.app__qualidade_captura_ligada() from public, anon;
revoke all on function public.app__qualidade_ve_analise(uuid) from public, anon;
grant execute on function public.app__qualidade_cfg(text) to authenticated, service_role;
grant execute on function public.app__qualidade_captura_ligada() to authenticated, service_role;
grant execute on function public.app__qualidade_ve_analise(uuid) to authenticated, service_role;

-- ─── §1.1 A captura nasce com a reunião ─────────────────────────────────────
--
-- Gatilho em `vendedor_eventos`, não nas RPCs de agendamento: são duas hoje, e a terceira
-- que alguém escrever amanhã também cai aqui. O gatilho nunca derruba a reunião — um erro
-- aqui vira aviso no log, e o agendamento segue.

create or replace function public.app__reuniao_captura_sincronizar()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_sem_link boolean := new.modalidade in ('presencial', 'telefone');
  v_pessoa boolean;
  v_status text;
  v_motivo text;
  v_agente uuid;
  v_id uuid;
begin
  if new.tipo <> 'reuniao' then
    return new;
  end if;

  begin
    if tg_op = 'UPDATE' and exists (select 1 from public.reunioes where evento_id = new.id) then
      update public.reunioes r set
        vendedor_id = new.vendedor_id,
        empresa_id = new.empresa_id,
        mandato_id = coalesce(r.mandato_id, (select m.id from public.mandatos m where m.reuniao_id = new.id limit 1)),
        /* Sem link não há onde o bot entrar: presencial e telefone dispensam sozinhos, e
           voltar a ser Meet reabre o que o sistema dispensou — nunca o que uma pessoa dispensou. */
        captura_status = case
          when r.captura_status = 'agendada' and v_sem_link then 'dispensada'
          when r.captura_status = 'dispensada' and r.dispensada_motivo = 'sem_link' and not v_sem_link then 'agendada'
          else r.captura_status end,
        dispensada_motivo = case
          when r.captura_status = 'agendada' and v_sem_link then 'sem_link'
          when r.captura_status = 'dispensada' and r.dispensada_motivo = 'sem_link' and not v_sem_link then null
          else r.dispensada_motivo end,
        /* Remarcar zera o alerta de "o bot não entrou": o horário que ele vigiava mudou. */
        alerta_sem_bot_em = case when new.inicio_em is distinct from old.inicio_em then null else r.alerta_sem_bot_em end,
        atualizada_em = now()
      where r.evento_id = new.id;
      return new;
    end if;

    /* Nasce quando a captura está ligada e o evento está a caminho do Google — é de lá que
       sai o convite com o notetaker. Reunião passada ou cancelada não ganha captura. */
    if not public.app__qualidade_captura_ligada()
       or new.google_pendente_em is null
       or new.cancelado_em is not null
       or new.inicio_em < now() then
      return new;
    end if;

    select coalesce(p.captura_ativa, true) into v_pessoa
    from (select 1) x left join public.qualidade_pessoas p on p.vendedor_id = new.vendedor_id;

    if not v_pessoa then
      v_status := 'dispensada'; v_motivo := 'pessoa_sem_captura';
    elsif v_sem_link then
      v_status := 'dispensada'; v_motivo := 'sem_link';
    else
      v_status := 'agendada';
    end if;

    select l.sdr_id into v_agente
    from public.sdr_leads l join public.vendedores v on v.id = l.sdr_id and v.is_ia
    where l.id = new.sdr_lead_id;

    v_id := gen_random_uuid();
    insert into public.reunioes (
      id, evento_id, empresa_id, contato_id, vendedor_id, agente_id, mandato_id,
      fireflies_client_reference_id, captura_status, dispensada_motivo
    )
    values (
      v_id, new.id, new.empresa_id,
      (select nullif(x ->> 'contato_id', '')::uuid
         from jsonb_array_elements(coalesce(new.participantes, '[]'::jsonb)) x
        where nullif(x ->> 'contato_id', '') is not null limit 1),
      new.vendedor_id, v_agente,
      (select m.id from public.mandatos m where m.reuniao_id = new.id limit 1),
      v_id::text, v_status, v_motivo
    )
    on conflict (evento_id) do nothing;

    if v_status = 'agendada' then
      insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
      values (new.empresa_id, 'reuniao.agendada',
        jsonb_build_object(
          'resumo', 'Gravação e transcrição da reunião agendadas (Fireflies).',
          'evento_id', new.id, 'reuniao_id', v_id, 'vendedor_id', new.vendedor_id,
          'venda_id', new.venda_id, 'lead_id', new.sdr_lead_id),
        auth.uid());
    end if;
  exception when others then
    raise warning 'app__reuniao_captura_sincronizar(%) falhou: %', new.id, sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists vendedor_eventos_captura on public.vendedor_eventos;
create trigger vendedor_eventos_captura
  after insert or update on public.vendedor_eventos
  for each row execute function public.app__reuniao_captura_sincronizar();

-- ─── A ligação que termina vai para a fila ──────────────────────────────────

create or replace function public.app__voz_enfileirar_analise()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'concluida'
     and jsonb_typeof(new.transcricao) = 'array' and jsonb_array_length(new.transcricao) > 0
     and (tg_op = 'INSERT' or old.status is distinct from 'concluida' or old.transcricao is null) then
    begin
      insert into public.analise_fila (escopo, voz_ligacao_id)
      values ('ligacao', new.id)
      on conflict do nothing;
    exception when others then
      raise warning 'app__voz_enfileirar_analise(%) falhou: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end $$;

drop trigger if exists voz_ligacoes_analise on public.voz_ligacoes;
create trigger voz_ligacoes_analise
  after insert or update of status, transcricao on public.voz_ligacoes
  for each row execute function public.app__voz_enfileirar_analise();

-- ─── RLS ────────────────────────────────────────────────────────────────────

do $$
declare
  t text;
begin
  foreach t in array array[
    'qualidade_config', 'qualidade_segredos', 'qualidade_pessoas', 'reunioes', 'fireflies_webhooks',
    'fireflies_resgates', 'rubricas', 'rubrica_itens', 'analises', 'analise_itens', 'analise_contestacoes',
    'calibracao_rotulos', 'calibracao_amostras', 'calibracao_execucoes', 'qualidade_pendencias',
    'analise_fila', 'vinculacao_tentativas', 'empresa_sugestoes_cadastro'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Toda escrita passa por RPC SECURITY DEFINER (0283c) ou pelo service role do worker.
-- `qualidade_segredos` não tem grant nenhum: nem leitura.

-- O comercial inteiro lê a régua e as settings.
do $$
declare
  t text;
begin
  foreach t in array array['qualidade_config', 'rubricas', 'rubrica_itens'] loop
    execute format('grant select on public.%I to authenticated', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select public.app_tem_modulo(''comercial'')))',
      t || '_select', t);
  end loop;
end $$;

-- Só gestores.
do $$
declare
  t text;
begin
  foreach t in array array[
    'fireflies_webhooks', 'calibracao_rotulos', 'calibracao_amostras', 'calibracao_execucoes',
    'analise_fila', 'vinculacao_tentativas'
  ] loop
    execute format('grant select on public.%I to authenticated', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select public.app_tem_modulo(''comercial'')) and (select public.app_gestor_comercial()))',
      t || '_select', t);
  end loop;
end $$;

grant select on public.qualidade_pessoas to authenticated;
create policy qualidade_pessoas_select on public.qualidade_pessoas for select to authenticated
  using ((select public.app_tem_modulo('comercial'))
         and ((select public.app_gestor_comercial()) or vendedor_id = (select public.app_vendedor_atual())));

/* A captura: quem vê a reunião (pela RLS do próprio evento) ou a empresa. */
grant select on public.reunioes to authenticated;
create policy reunioes_select on public.reunioes for select to authenticated
  using (
    (select public.app_tem_modulo('comercial'))
    and (
      (select public.app_gestor_comercial())
      or exists (select 1 from public.vendedor_eventos ve where ve.id = reunioes.evento_id)
      or (empresa_id is not null and exists (select 1 from public.empresas e where e.id = reunioes.empresa_id))
    )
  );

grant select on public.fireflies_resgates to authenticated;
create policy fireflies_resgates_select on public.fireflies_resgates for select to authenticated
  using (exists (select 1 from public.reunioes r where r.id = fireflies_resgates.reuniao_id));

/* A análise: a própria, ou gestor. */
grant select on public.analises to authenticated;
create policy analises_select on public.analises for select to authenticated
  using ((select public.app_tem_modulo('comercial')) and public.app__qualidade_ve_analise(vendedor_id)
         -- em sombra, só gestor: nenhuma nota chega a um vendedor antes da calibração (§5)
         and (modo = 'publicado' or (select public.app_gestor_comercial())));

grant select on public.analise_itens to authenticated;
create policy analise_itens_select on public.analise_itens for select to authenticated
  using (exists (select 1 from public.analises a where a.id = analise_itens.analise_id));

grant select on public.analise_contestacoes to authenticated;
create policy analise_contestacoes_select on public.analise_contestacoes for select to authenticated
  using ((select public.app_gestor_comercial()) or contestado_por = (select auth.uid()));

grant select on public.qualidade_pendencias to authenticated;
create policy qualidade_pendencias_select on public.qualidade_pendencias for select to authenticated
  using ((select public.app_tem_modulo('comercial')) and public.app__qualidade_ve_analise(vendedor_id));

grant select on public.empresa_sugestoes_cadastro to authenticated;
create policy empresa_sugestoes_select on public.empresa_sugestoes_cadastro for select to authenticated
  using ((select public.app_tem_modulo('comercial'))
         and exists (select 1 from public.empresas e where e.id = empresa_sugestoes_cadastro.empresa_id));
