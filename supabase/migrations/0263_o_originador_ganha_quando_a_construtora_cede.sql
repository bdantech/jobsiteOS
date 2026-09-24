-- ─────────────────────────────────────────────────────────────────────────────
-- 0263 — O originador ganha quando a construtora da carteira dele é a cedente
--
-- A carteira de originação paga o originador pelos FORNECEDORES que antecipam contra
-- as construtoras dela. Às vezes o originador vende antecipação à PRÓPRIA construtora,
-- que cede a nota que ela emitiu contra um cliente dela. Isso não pagava ninguém:
-- o motor v2 procura o originador pelo sacado e tira a taxa da classificação do
-- sacado — e o sacado aqui (medido: Hitachi Energy, cessão 56684 da Ribeiro Caram,
-- 18/09/2026) não é conta nossa. Zero linhas, sem erro.
--
-- ─── A FLAG MORA NA LINHA DA CARTEIRA, COM VIGÊNCIA ─────────────────────────
-- `vendedor_carteira.comissiona_como_cedente`, só na linha `originacao`. Ligar ou
-- desligar FECHA a linha e abre outra — o motor pergunta "estava ligada na data da
-- cessão?", e um update no lugar reescreveria o passado. A exceção é a linha nascida
-- nesta mesma transação: ali não há passado a preservar.
--
-- A tela escreve em `settings.empresas_cedente` (subconjunto de
-- `empresas_escolhidas`), e `app_salvar_vendedor` espelha na carteira depois de
-- sincronizá-la — o mesmo caminho da própria lista.
--
-- ─── REGRAS DO MOTOR (worker + core, não aqui) ──────────────────────────────
--   taxa ........ a de originador (`orig_*`), pela classificação da CONSTRUTORA
--   vendedor .... não ganha: a parcela dele é sobre o sacado, que não é conta nossa
--   um só ....... se o caminho normal já pagou um ORIGINADOR nesta cessão, a flag
--                 não paga um segundo
--   cedente ..... casado pela RAIZ do CNPJ, para cobrir filiais da construtora
--
-- ─── RETROATIVO ─────────────────────────────────────────────────────────────
-- Decisão de 24/09/2026: vale desde 01/09 para o Rodrigo na Ribeiro Caram, que é a
-- data em que ela entrou na carteira dele. A linha dele nasceu em 01/09, então o
-- update no lugar diz exatamente isso. A cessão de 18/09 não tem linha nenhuma, e o
-- backfill diário a apanha.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.vendedor_carteira
  add column if not exists comissiona_como_cedente boolean not null default false;

comment on column public.vendedor_carteira.comissiona_como_cedente is
  'Só em papel originacao: o originador também ganha quando ESTA empresa antecipa como '
  'cedente (0263). Mudar fecha a linha e abre outra — a vigência é o que o motor lê.';

-- Índice do que o motor procura: carteira de originação com a flag, pela raiz.
create index if not exists vendedor_carteira_como_cedente_idx
  on public.vendedor_carteira (empresa_id)
  where papel = 'originacao' and comissiona_como_cedente;

create or replace function public.app__sincronizar_originacao_como_cedente(
  p_vendedor uuid,
  p_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  r public.vendedor_carteira;
  v_quer boolean;
begin
  for r in
    select * from public.vendedor_carteira
    where vendedor_id = p_vendedor and papel = 'originacao' and ate is null
  loop
    v_quer := r.empresa_id = any(coalesce(p_ids, '{}'::uuid[]));
    continue when r.comissiona_como_cedente = v_quer;

    if r.desde >= now() then
      -- Nasceu nesta transação (o sync acabou de inseri-la): não há vigência a guardar.
      update public.vendedor_carteira set comissiona_como_cedente = v_quer where id = r.id;
    else
      update public.vendedor_carteira set ate = now() where id = r.id;
      insert into public.vendedor_carteira
        (vendedor_id, empresa_id, papel, share_pct, origem, comissiona_como_cedente)
      values (r.vendedor_id, r.empresa_id, 'originacao', r.share_pct, r.origem, v_quer);
    end if;
  end loop;
end;
$$;

revoke all on function public.app__sincronizar_originacao_como_cedente(uuid, uuid[])
  from public, anon, authenticated;

create or replace function public.app_salvar_vendedor(p jsonb)
returns public.vendedores
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_ator uuid := auth.uid();
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_superior uuid := nullif(p ->> 'superior_id', '')::uuid;
  v_linha public.vendedores;
  v_ids uuid[];
  v_cedente uuid[];
begin
  if not public.app_gestor_comercial() then
    raise exception 'Só gestores cadastram vendedor.' using errcode = '42501';
  end if;
  if coalesce(p ->> 'tipo', '') not in ('sdr', 'vendedor', 'originador', 'auxiliar') then
    raise exception 'Tipo inválido.' using errcode = '22023';
  end if;
  if nullif(p ->> 'usuario_id', '') is null and not coalesce((p ->> 'is_ia')::boolean, false) then
    raise exception 'Vendedor precisa de um usuário, ou de ser marcado como IA.' using errcode = '22023';
  end if;

  if (p ->> 'tipo') = 'auxiliar' then
    if v_superior is null then
      raise exception 'Escolha o closer de quem este auxiliar é auxiliar.' using errcode = '23502';
    end if;
    if not exists (select 1 from public.vendedores v where v.id = v_superior and v.tipo = 'vendedor') then
      raise exception 'O superior de um auxiliar precisa ser um closer.' using errcode = '23514';
    end if;
  else
    v_superior := null;
  end if;

  if v_id is null then
    insert into public.vendedores (nome, tipo, usuario_id, is_ia, whatsapp_conta_id, email_remetente, settings, ativo, superior_id)
    values (
      p ->> 'nome',
      p ->> 'tipo',
      nullif(p ->> 'usuario_id', '')::uuid,
      coalesce((p ->> 'is_ia')::boolean, false),
      nullif(p ->> 'whatsapp_conta_id', '')::uuid,
      nullif(p ->> 'email_remetente', ''),
      coalesce(p -> 'settings', '{}'::jsonb),
      coalesce((p ->> 'ativo')::boolean, true),
      v_superior
    )
    returning * into v_linha;
  else
    update public.vendedores set
      nome = coalesce(p ->> 'nome', nome),
      tipo = coalesce(p ->> 'tipo', tipo),
      usuario_id = case when p ? 'usuario_id' then nullif(p ->> 'usuario_id', '')::uuid else usuario_id end,
      is_ia = coalesce((p ->> 'is_ia')::boolean, is_ia),
      whatsapp_conta_id = case when p ? 'whatsapp_conta_id' then nullif(p ->> 'whatsapp_conta_id', '')::uuid else whatsapp_conta_id end,
      email_remetente = case when p ? 'email_remetente' then nullif(p ->> 'email_remetente', '') else email_remetente end,
      settings = coalesce(p -> 'settings', settings),
      ativo = coalesce((p ->> 'ativo')::boolean, ativo),
      superior_id = case when coalesce(p ->> 'tipo', tipo) = 'auxiliar' then v_superior else null end
    where id = v_id
    returning * into v_linha;
    if v_linha.id is null then
      raise exception 'Vendedor não encontrado.' using errcode = 'no_data_found';
    end if;
  end if;

  v_ids := case
    when v_linha.tipo = 'originador' and v_linha.ativo then coalesce(
      (select array_agg((x)::uuid)
       from jsonb_array_elements_text(coalesce(v_linha.settings -> 'empresas_escolhidas', '[]'::jsonb)) x),
      '{}'::uuid[])
    else '{}'::uuid[]
  end;
  perform public.app_sincronizar_carteira_originacao(v_linha.id, v_ids);

  -- A flag só vale para empresa que está na lista: `empresas_cedente` fora dela não
  -- tem linha onde pousar, e o `any` do sincronizador simplesmente não a encontra.
  v_cedente := coalesce(
    (select array_agg((x)::uuid)
     from jsonb_array_elements_text(coalesce(v_linha.settings -> 'empresas_cedente', '[]'::jsonb)) x),
    '{}'::uuid[]);
  perform public.app__sincronizar_originacao_como_cedente(v_linha.id, v_cedente);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, case when v_id is null then 'comercial.vendedor_criado' else 'comercial.vendedor_alterado' end,
          'vendedores', v_linha.id::text, p);

  return v_linha;
end $function$;

-- ── Retroativo: Rodrigo × Ribeiro Caram desde 01/09 ────────────────────────
update public.vendedor_carteira c
set comissiona_como_cedente = true
from public.vendedores v, public.empresas e
where v.id = c.vendedor_id and e.id = c.empresa_id
  and v.nome = 'Rodrigo Alves' and e.razao_social = 'RIBEIRO CARAM'
  and c.papel = 'originacao' and c.ate is null;

update public.vendedores v
set settings = jsonb_set(coalesce(v.settings, '{}'::jsonb), '{empresas_cedente}',
      to_jsonb(array(select e.id::text from public.empresas e where e.razao_social = 'RIBEIRO CARAM')))
where v.nome = 'Rodrigo Alves' and v.tipo = 'originador';
