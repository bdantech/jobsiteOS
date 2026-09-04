-- 0181 — O relógio da conta é ajustável.
--
-- A fase decide a taxa: crescimento paga 1000 R$/MM em conta ativa e 400 em passiva;
-- manutenção paga 600 e 200. Até aqui ela era 100% derivada de `marco_ativacao` — a data
-- da primeira NF convertida — e ninguém tinha como tocá-la. Duas coisas quebravam nisso:
--
--   O MARCO PODE ESTAR ERRADO. Ele é gravado pela primeira cessão que o motor vê, e o
--   motor só passou a ver a operação inteira hoje (0179). Uma conta que antecipa conosco
--   desde o ano passado por outro CNPJ estreia no sistema como nova.
--
--   O MARCO PODE ESTAR CERTO E O JULGAMENTO SER OUTRO. Uma conta pode ser nova para nós e
--   madura na relação. Sem uma tag, a única saída era mentir na data de ativação para
--   conseguir a taxa — e aí o marco deixa de significar o que diz.
--
-- ── O sunset vence a tag ──
--
-- A tag decide entre CRESCIMENTO e MANUTENÇÃO, nunca RESIDUAL. Passar do sunset não é uma
-- fase mais barata: é o fim do direito do vendedor sobre aquela conta (§3). Deixar a tag
-- sobrepor isso criaria uma exceção permanente e invisível — alguém marca "manutenção"
-- numa terça e a conta segue pagando por anos, porque não existe alerta para uma tag
-- antiga.

alter table public.empresas
  add column fase_manual text
    constraint empresas_fase_manual_check
    check (fase_manual is null or fase_manual in ('CRESCIMENTO', 'MANUTENCAO'));

comment on column public.empresas.fase_manual is
  'Fase fixada por um gestor, quando o relógio de `marco_ativacao` não descreve a relação. '
  'Vence a derivação, MENOS o sunset: passado ele a conta é RESIDUAL de qualquer forma.';

-- ─── O histórico ────────────────────────────────────────────────────────────
--
-- Mesma razão do `gestao_operacao_historico`: a partir do momento em que estes dois campos
-- decidem quanto uma cessão paga, "quem mudou, quando e por quê" deixa de ser curiosidade
-- e vira a resposta de uma contestação de folha.
--
-- Diferente dele em um ponto: aqui não há regra de véspera. A fase não é uma POLÍTICA que
-- muda (como ativo × passivo, que reprecifica o futuro); é uma correção de uma medida
-- errada. Corrigir a data de nascimento de uma conta vale para tudo o que ela já fez — e é
-- por isso que a alteração recalcula a competência aberta.

create table public.conta_fase_historico (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  marco_anterior date,
  marco_novo date,
  fase_anterior text,
  fase_nova text,
  motivo text not null,
  alterado_por uuid references public.usuarios (id),
  alterado_em timestamptz not null default now()
);

create index conta_fase_historico_empresa_idx
  on public.conta_fase_historico (empresa_id, alterado_em desc);

alter table public.conta_fase_historico enable row level security;

create policy conta_fase_historico_select on public.conta_fase_historico
  for select using ((select public.app_tem_modulo('comercial')));

grant select on public.conta_fase_historico to authenticated;

-- ─── Escrita ────────────────────────────────────────────────────────────────

create or replace function public.app_definir_fase_conta(p jsonb)
returns public.empresas language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_empresa public.empresas;
  v_marco date;
  v_fase text := nullif(trim(p ->> 'fase_manual'), '');
  v_motivo text := nullif(trim(p ->> 'motivo'), '');
  v_tem_marco boolean := p ? 'marco_ativacao';
begin
  if not public.app_gestor_comercial() then
    raise exception 'Só gestores ajustam o relógio de uma conta.' using errcode = '42501';
  end if;
  if v_motivo is null then
    raise exception 'Mudar a fase ou a data de início exige motivo: é ela que muda a taxa.'
      using errcode = '22023';
  end if;
  if v_fase is not null and v_fase not in ('CRESCIMENTO', 'MANUTENCAO') then
    raise exception 'Fase inválida: %. A tag decide entre crescimento e manutenção — residual é o sunset.', v_fase
      using errcode = '22023';
  end if;

  select * into v_empresa from public.empresas where id = (p ->> 'empresa_id')::uuid;
  if v_empresa.id is null then
    raise exception 'Conta não encontrada.' using errcode = 'no_data_found';
  end if;

  v_marco := case when v_tem_marco then nullif(p ->> 'marco_ativacao', '')::date
                  else v_empresa.marco_ativacao end;

  -- Uma data no futuro daria idade negativa, e `idadeEmMeses` a devolveria como zero: a
  -- conta ficaria em crescimento para sempre sem que a tela mostrasse nada de errado.
  if v_marco is not null and v_marco > (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'A data de início não pode ser no futuro.' using errcode = '22023';
  end if;

  if v_marco is not distinct from v_empresa.marco_ativacao
     and v_fase is not distinct from v_empresa.fase_manual then
    return v_empresa;
  end if;

  insert into public.conta_fase_historico
    (empresa_id, marco_anterior, marco_novo, fase_anterior, fase_nova, motivo, alterado_por)
  values (v_empresa.id, v_empresa.marco_ativacao, v_marco, v_empresa.fase_manual, v_fase, v_motivo, v_ator);

  update public.empresas
     set marco_ativacao = v_marco, fase_manual = v_fase
   where id = v_empresa.id
  returning * into v_empresa;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_empresa.id, 'conta.fase_ajustada',
    jsonb_build_object(
      'resumo',
        'Relógio da conta ajustado: início ' || coalesce(v_marco::text, '—')
        || ', fase ' || coalesce(v_fase, 'pelo relógio') || '. Motivo: ' || v_motivo,
      'marco_ativacao', v_marco,
      'fase_manual', v_fase,
      'motivo', v_motivo,
      -- Ao contrário da reclassificação, esta mudança NÃO é "a partir de amanhã": ela
      -- corrige uma medida, e a competência aberta é recalculada.
      'vigencia', 'recalcula a competência aberta'),
    v_ator);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'comercial.fase_conta_ajustada', 'empresas', v_empresa.id::text, p);

  return v_empresa;
end $$;

revoke execute on function public.app_definir_fase_conta(jsonb) from public;
grant execute on function public.app_definir_fase_conta(jsonb) to authenticated, service_role;

-- ─── Leitura: a lista de contas com o relógio de cada uma ───────────────────

create or replace function public.comercial_contas_fase()
returns jsonb language sql stable security definer set search_path = '' as $function$
  select case when not public.app_tem_modulo('comercial') then '[]'::jsonb else coalesce(
    (select jsonb_agg(to_jsonb(x) order by x.volume_mes desc, x.razao_social)
     from (
       select e.id as empresa_id,
              e.razao_social,
              e.cnpj,
              e.estagio,
              e.gestao_operacao,
              e.marco_ativacao,
              e.fase_manual,
              (select v.nome from public.vendedor_carteira c
                join public.vendedores v on v.id = c.vendedor_id
                where c.empresa_id = e.id and c.papel = 'vendedor' and c.ate is null
                limit 1) as titular,
              coalesce((select sum(a.gross_value) from public.antecipacoes a
                where public.app_holding_do_sacado(a.sacado_cnpj) = e.id
                  and a.regrediu_em is null
                  and a.convertida_em >= date_trunc('month', now() at time zone 'America/Sao_Paulo')), 0)
                as volume_mes,
              coalesce((select sum(l.valor) from public.comissao_lancamentos_v2 l
                where l.empresa_id = e.id
                  and l.competencia = (date_trunc('month', now() at time zone 'America/Sao_Paulo'))::date), 0)
                as comissao_mes,
              (select count(*) from public.conta_fase_historico h where h.empresa_id = e.id) as ajustes
       from public.empresas e
       where e.estagio in ('cliente', 'ex_cliente')
     ) x),
    '[]'::jsonb) end;
$function$;

comment on function public.comercial_contas_fase is
  'Todo cliente e ex-cliente com o relógio dele: data de início, fase fixada, titular, '
  'volume e comissão do mês corrente. Lista TODOS, inclusive quem não tem marco — é a conta '
  'sem relógio que paga a taxa errada sem ninguém notar.';

revoke execute on function public.comercial_contas_fase() from public;
grant execute on function public.comercial_contas_fase() to authenticated, service_role;
