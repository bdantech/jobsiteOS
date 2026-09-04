-- 0177 — O CNPJ que opera por baixo de um cliente.
--
-- `app_holding_do_sacado` sabe responder três coisas: é o próprio cliente, é uma filial
-- dele (0176), ou é uma SPE do grupo econômico dele. As três são deduções — da Receita ou
-- do grafo de sócios — e há um caso que dedução nenhuma alcança: o CNPJ que a gestão SABE
-- ser de um cliente e o dado público não diz.
--
-- Medido em 04/09/2026, cinco sacados converteram R$ 920 mil sem resolver para conta
-- nenhuma. Três deles têm dono conhecido e nenhum parentesco declarado:
--
--   CABANA ARGENTINA JK      16 cessões, R$ 247k — é do Pobre Juan
--   CASA DO POÇO SPE         R$ 161k — é da Casa Orange
--   EDIFÍCIO CASA BOA VIAGEM R$ 95k  — é da Casa Orange
--   JJR IPA CLUB SPE         R$ 311k — é SPE da YEES. O grafo a separou de propósito:
--                            pelos sócios ela é uma joint venture de MILAN + J.J.REIS +
--                            YEES, e unir por ela colaria três holdings numa só.
--
-- E o sintoma era nenhum: a cessão convertia, a NF saía do funil, e o motor de comissão
-- terminava com `gravados: 0` porque `empresa_id` era nulo. Não há erro, não há alerta —
-- só um extrato menor do que devia, num lugar que ninguém confere contra a operação.
--
-- Por isso a tabela vem com a TELA junto (`comercial_sacados_sem_conta`). Um vínculo
-- manual que só existe como tabela é um vínculo que ninguém lembra de criar: o que faz a
-- feature funcionar não é poder vincular, é a lista que diz quem está operando sem conta.

create table public.sacado_vinculo (
  -- O CNPJ que aparece na nota. Não é FK para `empresas`: o caso mais comum é justamente
  -- o CNPJ que não está cadastrado como empresa nenhuma.
  cnpj text primary key,
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  motivo text not null,
  criado_por uuid references public.usuarios (id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index sacado_vinculo_empresa_idx on public.sacado_vinculo (empresa_id);

/*
 * Sem vigência, ao contrário de `vendedor_carteira` — e a diferença é de natureza.
 *
 * Titularidade é uma relação que MUDA no tempo: quem era dono em março tem de continuar
 * sendo dono de março, e por isso ela tem `desde`/`ate`. Identidade não muda: ou este
 * CNPJ é do Pobre Juan, ou nunca foi. Um vínculo corrigido é uma correção, não uma
 * sucessão, e datá-lo faria a tela pedir uma data que não existe.
 *
 * O que já foi lançado não se mexe de qualquer forma: o lançamento guarda `empresa_id` no
 * próprio snapshot. O vínculo só decide as cessões que ainda não passaram pelo motor.
 */
comment on table public.sacado_vinculo is
  'Diz que um CNPJ que opera pertence a uma conta cliente, quando nem o CNPJ, nem a raiz, '
  'nem o grupo econômico revelam isso. Vence as três deduções de app_holding_do_sacado.';

alter table public.sacado_vinculo enable row level security;

create policy sacado_vinculo_select on public.sacado_vinculo
  for select using ((select public.app_tem_modulo('comercial')));

grant select on public.sacado_vinculo to authenticated;

-- ─── A dedução passa a ter uma exceção declarada ────────────────────────────
--
-- O vínculo manual vem PRIMEIRO, antes até do CNPJ exato: ele existe justamente para os
-- casos em que alguém olhou e decidiu, e uma decisão que perde para uma dedução não é uma
-- decisão — é uma sugestão.

create or replace function public.app_holding_do_sacado(p_cnpj text)
returns uuid language sql stable security definer set search_path = '' as $function$
  select coalesce(
    (select v.empresa_id
     from public.sacado_vinculo v
     join public.empresas e on e.id = v.empresa_id
     where v.cnpj = p_cnpj and e.estagio in ('cliente', 'ex_cliente')),
    (select e.id
     from public.empresas e
     left join public.mercado_universo u on u.cnpj = p_cnpj
     where p_cnpj is not null
       and e.estagio in ('cliente', 'ex_cliente')
       and (
         e.cnpj = p_cnpj
         or left(e.cnpj, 8) = left(p_cnpj, 8)
         or (coalesce(u.is_spe, false)
             and u.grupo_id is not null
             and e.grupo_id = u.grupo_id)
       )
     order by (e.cnpj = p_cnpj) desc,
              (left(e.cnpj, 8) = left(p_cnpj, 8)) desc,
              e.id
     limit 1)
  );
$function$;

comment on function public.app_holding_do_sacado is
  'A empresa cadastrada dona de uma operação, dado o CNPJ do sacado. Na ordem: vínculo '
  'manual (sacado_vinculo), ela mesma, uma filial dela (mesma raiz de 8 dígitos = mesma '
  'pessoa jurídica), ou a holding cliente cuja SPE é o sacado. Uma só, sempre — um grupo '
  'pode ter dois clientes, e sem o desempate a mesma antecipação pagaria comissão duas vezes.';

-- ─── Escrita ────────────────────────────────────────────────────────────────

create or replace function public.app_vincular_sacado(p jsonb)
returns public.sacado_vinculo language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_cnpj text := regexp_replace(coalesce(p ->> 'cnpj', ''), '\D', '', 'g');
  v_empresa uuid := nullif(p ->> 'empresa_id', '')::uuid;
  v_motivo text := nullif(trim(p ->> 'motivo'), '');
  v_linha public.sacado_vinculo;
  v_alvo public.empresas;
  v_antes uuid;
begin
  if not public.app_gestor_comercial() then
    raise exception 'Só gestores vinculam um sacado a uma conta.' using errcode = '42501';
  end if;
  if length(v_cnpj) <> 14 then
    raise exception 'CNPJ inválido: %.', p ->> 'cnpj' using errcode = '22023';
  end if;

  -- Desvincular: `empresa_id` nulo. A linha SOME em vez de ficar apontando para nada —
  -- um vínculo vazio na tabela reapareceria na tela como se fosse uma decisão tomada.
  if v_empresa is null then
    delete from public.sacado_vinculo where cnpj = v_cnpj returning * into v_linha;
    insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
    values (v_ator, 'comercial.sacado_desvinculado', 'sacado_vinculo', v_cnpj, p);
    return v_linha;
  end if;

  if v_motivo is null then
    raise exception 'Vincular exige motivo: é a única explicação de por que este CNPJ é desta conta.'
      using errcode = '22023';
  end if;

  select * into v_alvo from public.empresas where id = v_empresa;
  if v_alvo.id is null then
    raise exception 'Conta não encontrada.' using errcode = 'no_data_found';
  end if;
  /*
   * Só cliente ou ex-cliente pode receber um vínculo — a mesma régua de
   * `app_holding_do_sacado`. Vincular a uma empresa de mercado criaria um vínculo que a
   * função ignora: a tela mostraria "vinculado" e a comissão continuaria zero.
   */
  if v_alvo.estagio not in ('cliente', 'ex_cliente') then
    raise exception 'A conta destino tem de ser cliente ou ex-cliente da OnePay — "%" está em "%".',
      coalesce(v_alvo.razao_social, v_alvo.cnpj), v_alvo.estagio using errcode = '22023';
  end if;
  -- Vincular um CNPJ a ele mesmo não é erro de digitação, é um no-op que faria a tela
  -- prometer uma mudança que a função já resolvia sozinha.
  if v_alvo.cnpj = v_cnpj then
    raise exception 'Este CNPJ já É a conta — não precisa de vínculo.' using errcode = '22023';
  end if;

  select empresa_id into v_antes from public.sacado_vinculo where cnpj = v_cnpj;

  insert into public.sacado_vinculo (cnpj, empresa_id, motivo, criado_por)
  values (v_cnpj, v_empresa, v_motivo, v_ator)
  on conflict (cnpj) do update
    set empresa_id = excluded.empresa_id,
        motivo = excluded.motivo,
        atualizado_em = now()
  returning * into v_linha;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_empresa, 'sacado.vinculado',
    jsonb_build_object(
      'resumo', 'O CNPJ ' || v_cnpj || ' passa a operar por baixo desta conta. Motivo: ' || v_motivo,
      'cnpj_vinculado', v_cnpj,
      'empresa_anterior', v_antes,
      -- As cessões já lançadas guardam a conta do dia em que converteram: o vínculo vale
      -- para o que ainda não passou pelo motor, e o backfill diário recolhe.
      'vigencia', 'as cessões ainda não lançadas'),
    v_ator);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'comercial.sacado_vinculado', 'sacado_vinculo', v_cnpj, p);

  return v_linha;
end $$;

revoke execute on function public.app_vincular_sacado(jsonb) from public;
grant execute on function public.app_vincular_sacado(jsonb) to authenticated, service_role;

-- ─── Leitura: quem está operando sem conta ──────────────────────────────────
--
-- É esta lista que faz o vínculo existir. Sem ela, "vincular um sacado" é uma tela que só
-- serve para quem já sabe o que procurar — e quem já sabe é justamente quem não precisa.

create or replace function public.comercial_sacados_sem_conta()
returns jsonb language sql stable security definer set search_path = '' as $function$
  select case when not public.app_tem_modulo('comercial') then '[]'::jsonb else coalesce(
    (select jsonb_agg(to_jsonb(x) order by x.volume desc)
     from (
       select a.sacado_cnpj as cnpj,
              max(a.sacado_nome) as nome,
              count(*)::int as cessoes,
              sum(a.gross_value) as volume,
              min(a.convertida_em) as primeira,
              max(a.convertida_em) as ultima,
              count(distinct a.fornecedor_cnpj)::int as cedentes,
              (select e.razao_social from public.empresas e where e.cnpj = a.sacado_cnpj) as cadastro_nome,
              (select e.estagio from public.empresas e where e.cnpj = a.sacado_cnpj) as cadastro_estagio
       from public.antecipacoes a
       where a.convertida_em is not null
         and a.regrediu_em is null
         and public.app_holding_do_sacado(a.sacado_cnpj) is null
       group by a.sacado_cnpj
     ) x),
    '[]'::jsonb) end;
$function$;

comment on function public.comercial_sacados_sem_conta is
  'CNPJs que já converteram cessão e não resolvem para conta nenhuma — nem por CNPJ, nem '
  'por raiz, nem por grupo, nem por vínculo. Cada linha aqui é volume que não paga '
  'comissão a ninguém, e o único conserto é uma pessoa dizer de quem é.';

revoke execute on function public.comercial_sacados_sem_conta() from public;
grant execute on function public.comercial_sacados_sem_conta() to authenticated, service_role;
