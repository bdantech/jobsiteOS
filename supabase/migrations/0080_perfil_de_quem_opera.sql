-- 04f — Perfil de Quem Opera
--
-- Feedback loop: características de quem opera → sugestões de ajuste de regra.
-- O sistema RECOMENDA com evidência e NUNCA aplica: toda sugestão vira rascunho
-- no editor que já existe, com preview de impacto e ativação humana.

create table if not exists perfil_config (
  chave           text primary key,
  valor           jsonb not null,
  atualizado_por  uuid references usuarios(id) on delete set null,
  atualizado_em   timestamptz not null default now()
);

alter table perfil_config enable row level security;

drop policy if exists perfil_config_select on perfil_config;
create policy perfil_config_select on perfil_config
  for select using (app_tem_modulo('mercado'));
drop policy if exists perfil_config_admin on perfil_config;
create policy perfil_config_admin on perfil_config
  for all using (app_is_admin()) with check (app_is_admin());

insert into perfil_config (chave, valor) values
  ('coortes', jsonb_build_object(
    'pesado_consumo_pct', 0.6,
    'pesado_antecipacoes_2m', 6,
    'dormente_dias', 30,
    'conversor_janela_dias', 90
  )),
  ('analise', jsonb_build_object(
    'n_minimo', 15,
    'cobertura_minima', 0.4,
    'lift_minimo', 2,
    'fracao_barrada_minima', 0.1,
    'cobertura_alvo', 0.95,
    'max_linhas_controle', 20000
  ))
on conflict (chave) do nothing;

-- ─── Snapshots ──────────────────────────────────────────────────────────────
-- A evolução do perfil no tempo é sinal estratégico: uma característica que
-- ganha lift mês a mês diz mais que o valor de hoje. Por isso o resultado
-- INTEIRO é guardado, e não só o último.

create table if not exists perfil_snapshots (
  id             uuid primary key default gen_random_uuid(),
  trilha         text not null check (trilha in ('sacados', 'fornecedores')),
  comparacao     text not null,
  resultados     jsonb not null,
  auditoria      jsonb,
  sugestoes      jsonb,
  -- As versões de camada/faixa vigentes no momento do cálculo. Sem isto, um
  -- achado de três meses atrás é impossível de interpretar: não se sabe contra
  -- qual régua ele foi medido.
  versao_regras  jsonb,
  coorte_a       int not null default 0,
  coorte_b       int not null default 0,
  calculado_em   timestamptz not null default now()
);

create index if not exists perfil_snapshots_trilha_idx
  on perfil_snapshots (trilha, comparacao, calculado_em desc);

alter table perfil_snapshots enable row level security;
drop policy if exists perfil_snapshots_select on perfil_snapshots;
create policy perfil_snapshots_select on perfil_snapshots
  for select using (app_tem_modulo('mercado'));

-- ─── Rastreabilidade do um-clique ───────────────────────────────────────────

create table if not exists perfil_sugestoes_log (
  id                   uuid primary key default gen_random_uuid(),
  snapshot_id          uuid references perfil_snapshots(id) on delete cascade,
  sugestao_id          text not null,
  sugestao             jsonb not null,
  acao                 text not null check (acao in ('aceita', 'descartada')),
  motivo               text,
  regra_tipo           text,
  regra_chave          text,
  -- Preenchida DEPOIS, quando o editor ativa a versão. Nula significa "aceitou e
  -- não levou até o fim" — que é uma informação, não um buraco.
  regra_versao_criada  int,
  usuario_id           uuid references usuarios(id) on delete set null,
  em                   timestamptz not null default now()
);

create index if not exists perfil_sugestoes_log_snapshot_idx
  on perfil_sugestoes_log (snapshot_id, sugestao_id);

alter table perfil_sugestoes_log enable row level security;
drop policy if exists perfil_sugestoes_log_select on perfil_sugestoes_log;
create policy perfil_sugestoes_log_select on perfil_sugestoes_log
  for select using (app_tem_modulo('mercado'));

-- ─── RPCs ───────────────────────────────────────────────────────────────────

create or replace function app_registrar_sugestao_perfil(p jsonb)
returns perfil_sugestoes_log language plpgsql security definer set search_path = '' as $$
declare
  v_log      public.perfil_sugestoes_log;
  v_ator     uuid := auth.uid();
  v_snapshot public.perfil_snapshots;
  v_sug      jsonb;
begin
  if not public.app_tem_modulo('mercado') then
    raise exception 'Sem acesso ao módulo Mercado.' using errcode = '42501';
  end if;

  select * into v_snapshot from public.perfil_snapshots
   where id = (p ->> 'snapshot_id')::uuid;
  if v_snapshot.id is null then
    raise exception 'Snapshot não encontrado.' using errcode = 'no_data_found';
  end if;

  -- A sugestão é lida DO SNAPSHOT, nunca do corpo da requisição. É o que impede
  -- que alguém registre como "aceita" uma árvore de regra que o cálculo nunca
  -- propôs — o log tem de ser evidência, não um campo de texto livre.
  select s into v_sug
    from jsonb_array_elements(coalesce(v_snapshot.sugestoes, '[]'::jsonb)) s
   where s ->> 'id' = p ->> 'sugestao_id'
   limit 1;

  if v_sug is null then
    raise exception 'Sugestão % não existe neste snapshot.', p ->> 'sugestao_id'
      using errcode = 'no_data_found';
  end if;

  insert into public.perfil_sugestoes_log
    (snapshot_id, sugestao_id, sugestao, acao, motivo, regra_tipo, regra_chave, usuario_id)
  values (
    v_snapshot.id,
    p ->> 'sugestao_id',
    v_sug,
    p ->> 'acao',
    nullif(p ->> 'motivo', ''),
    v_sug -> 'alvo' ->> 'tipo',
    v_sug -> 'alvo' ->> 'chave',
    v_ator
  )
  returning * into v_log;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (
    null,
    case when p ->> 'acao' = 'aceita' then 'perfil.sugestao_aceita' else 'perfil.sugestao_descartada' end,
    jsonb_build_object(
      'titulo', case when p ->> 'acao' = 'aceita'
                     then 'Sugestão do perfil aceita' else 'Sugestão do perfil descartada' end,
      'resumo', coalesce(v_sug ->> 'frase', p ->> 'sugestao_id'),
      'url', '/mercado/perfil',
      'sugestao_id', p ->> 'sugestao_id',
      'log_id', v_log.id,
      'regra_tipo', v_sug -> 'alvo' ->> 'tipo',
      'regra_chave', v_sug -> 'alvo' ->> 'chave'
    ),
    v_ator
  );

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'perfil.sugestao_' || (p ->> 'acao'), 'perfil_sugestoes_log', v_log.id::text, p);

  return v_log;
end; $$;

comment on function app_registrar_sugestao_perfil(jsonb) is
  'Registra a decisão sobre uma sugestão do Perfil (04f §6). A árvore vem do SNAPSHOT, nunca do corpo — o log é evidência, não texto livre. Não ativa regra nenhuma.';

create or replace function app_vincular_versao_sugestao(p jsonb)
returns perfil_sugestoes_log language plpgsql security definer set search_path = '' as $$
declare
  v_log public.perfil_sugestoes_log;
begin
  if not public.app_tem_modulo('mercado') then
    raise exception 'Sem acesso ao módulo Mercado.' using errcode = '42501';
  end if;

  update public.perfil_sugestoes_log
     set regra_versao_criada = (p ->> 'regra_versao_criada')::int
   where id = (p ->> 'log_id')::uuid
     and acao = 'aceita'
  returning * into v_log;

  if v_log.id is null then
    raise exception 'Registro de sugestão não encontrado.' using errcode = 'no_data_found';
  end if;
  return v_log;
end; $$;

comment on function app_vincular_versao_sugestao(jsonb) is
  'Fecha o ciclo do um-clique: carimba no log a versão de regra que a sugestão aceita realmente gerou.';

create or replace function app_salvar_perfil_config(p jsonb)
returns perfil_config language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_linha public.perfil_config;
begin
  if not public.app_is_admin() then
    raise exception 'Apenas administradores podem alterar a configuração do Perfil.'
      using errcode = '42501';
  end if;

  insert into public.perfil_config (chave, valor, atualizado_por, atualizado_em)
  values (p ->> 'chave', p -> 'valor', v_ator, now())
  on conflict (chave) do update
    set valor = excluded.valor, atualizado_por = excluded.atualizado_por, atualizado_em = now()
  returning * into v_linha;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'perfil.config_salva', 'perfil_config', v_linha.chave, p);

  return v_linha;
end; $$;

-- O snapshot mais recente por trilha/comparação, que é o que a tela abre.
create or replace function perfil_snapshot_atual(p jsonb)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_trilha text := p ->> 'trilha';
  v_comparacao text := nullif(p ->> 'comparacao', '');
begin
  if not public.app_tem_modulo('mercado') then
    return jsonb_build_object('tem_acesso', false);
  end if;

  return jsonb_build_object(
    'tem_acesso', true,
    'snapshots', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.comparacao)
      from (
        select distinct on (comparacao) *
        from public.perfil_snapshots
        where trilha = v_trilha
          and (v_comparacao is null or comparacao = v_comparacao)
        order by comparacao, calculado_em desc
      ) s
    ), '[]'::jsonb),
    -- As decisões já tomadas, para a tela não reoferecer o que alguém descartou.
    'decisoes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'sugestao_id', l.sugestao_id, 'acao', l.acao, 'log_id', l.id,
        'regra_versao_criada', l.regra_versao_criada))
      from public.perfil_sugestoes_log l
      join public.perfil_snapshots sn on sn.id = l.snapshot_id
      where sn.trilha = v_trilha
    ), '[]'::jsonb)
  );
end; $$;

comment on function perfil_snapshot_atual(jsonb) is
  'O snapshot mais recente de cada comparação da trilha, mais as decisões já registradas sobre as sugestões (04f §7).';

revoke execute on function public.app_registrar_sugestao_perfil(jsonb) from public;
revoke execute on function public.app_vincular_versao_sugestao(jsonb) from public;
revoke execute on function public.app_salvar_perfil_config(jsonb) from public;
revoke execute on function public.perfil_snapshot_atual(jsonb) from public;

grant execute on function public.app_registrar_sugestao_perfil(jsonb) to authenticated, service_role;
grant execute on function public.app_vincular_versao_sugestao(jsonb) to authenticated, service_role;
grant execute on function public.app_salvar_perfil_config(jsonb) to authenticated, service_role;
grant execute on function public.perfil_snapshot_atual(jsonb) to authenticated, service_role;

-- §8: o recálculo mensal avisa quem cuida da régua.
insert into notificacao_regras (tipo_evento, perfil_id, ativo)
select 'perfil.recalculado', p.id, true
from perfis p where p.nome = 'Admin'
on conflict do nothing;
