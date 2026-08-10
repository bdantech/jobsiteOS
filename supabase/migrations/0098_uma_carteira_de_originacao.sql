-- 0098 — Uma carteira de originação só, e a comissão volta a existir.
--
-- Havia DUAS carteiras de originador com o mesmo nome e leitores diferentes:
--
--   `vendedores.settings.empresas_escolhidas`  escrita pelo formulário   lida pelo ROTEAMENTO
--   `vendedor_carteira` papel 'originacao'     escrita por ninguém       lida pela COMISSÃO
--
-- `app_definir_carteira` existe desde o 0091 e nenhuma tela nunca a chamou. Resultado
-- medido antes desta migração: `vendedor_carteira` com zero linhas de `originacao`, e
-- portanto `donoNaData(..., 'originacao', ...)` devolvendo null para toda antecipação
-- convertida. A comissão do originador nunca foi paga — e não havia erro nenhum: o job
-- contava a linha como "sem regra" e seguia.
--
-- Este é o pior formato possível de bug. Não quebra, não alerta, e a tela que a pessoa
-- olha para conferir (o funil de NFs, alimentado pelo `settings`) mostra o trabalho
-- acontecendo normalmente. Só apareceria quando alguém perguntasse por que a folha veio
-- vazia — e a resposta estaria três meses atrás.
--
-- A correção é ter UMA carteira. `settings` continua sendo o que a tela edita, porque
-- editar um conjunto é natural ali; e passa a ser ESPELHADO em `vendedor_carteira`, que
-- é a forma temporal — a única que responde "quem era dono na data da conversão", que é
-- a pergunta que a comissão faz.

-- ─── O espelho ──────────────────────────────────────────────────────────────
--
-- Reconcilia o conjunto: fecha a vigência do que saiu, abre a do que entrou.
--
-- E RECUSA quando a empresa já é de outro originador, em vez de roubar. O índice
-- `vendedor_carteira_vigente_idx` já garante um dono por (empresa, papel); o que esta
-- função acrescenta é a mensagem com o NOME de quem tem — sem ela a tela devolveria uma
-- violação de constraint, e quem estivesse montando a carteira não teria como saber com
-- quem falar. Passar a empresa de mão é duas operações de propósito: tirar de um e dar a
-- outro são duas decisões, e uma delas costuma ser a que ninguém queria.

create or replace function public.app_sincronizar_carteira_originacao(
  p_vendedor uuid,
  p_ids uuid[]
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_conflito text;
begin
  select string_agg(coalesce(e.razao_social, e.cnpj) || ' (com ' || o.nome || ')', '; ')
    into v_conflito
  from public.vendedor_carteira c
  join public.vendedores o on o.id = c.vendedor_id
  join public.empresas e on e.id = c.empresa_id
  where c.papel = 'originacao' and c.ate is null
    and c.vendedor_id <> p_vendedor
    and c.empresa_id = any(coalesce(p_ids, '{}'::uuid[]));

  if v_conflito is not null then
    raise exception 'Já está na carteira de outro originador: %.', v_conflito using errcode = '23505';
  end if;

  update public.vendedor_carteira set ate = now()
  where vendedor_id = p_vendedor and papel = 'originacao' and ate is null
    and not (empresa_id = any(coalesce(p_ids, '{}'::uuid[])));

  /*
   * Conta PASSIVA não entra em carteira de originação, nem que esteja no `settings`.
   *
   * O roteamento já descarta a nota dela antes de olhar carteira nenhuma; o que faltava
   * era a comissão saber disso. Uma linha de `originacao` vigente numa conta passiva
   * pagaria o originador pela mesma operação que já paga o closer por volume — duas
   * comissões pelo mesmo dinheiro, e nenhuma delas visivelmente errada na folha.
   *
   * A empresa continua no `settings`, marcada na tela: tirá-la sozinho seria decidir por
   * quem cadastrou, e a marca é o que faz alguém revisar.
   */
  insert into public.vendedor_carteira (vendedor_id, empresa_id, papel)
  select p_vendedor, e.id, 'originacao'
  from public.empresas e
  where e.id = any(coalesce(p_ids, '{}'::uuid[]))
    and coalesce(e.gestao_operacao, '') <> 'passivo'
    and not exists (
      select 1 from public.vendedor_carteira c
      where c.empresa_id = e.id and c.papel = 'originacao' and c.ate is null
    );
end $$;

comment on function public.app_sincronizar_carteira_originacao is
  'Espelha `settings.empresas_escolhidas` em `vendedor_carteira` papel originacao, com '
  'vigência. A vigência é o que a comissão lê — settings só sabe o presente, e o presente '
  'é justamente o que não interessa quando alguém contesta a comissão de março.';

revoke execute on function public.app_sincronizar_carteira_originacao(uuid, uuid[]) from public;

-- ─── O cadastro passa a manter as duas em dia ───────────────────────────────

create or replace function public.app_salvar_vendedor(p jsonb)
returns public.vendedores language plpgsql security definer set search_path = '' as $function$
declare
  v_ator uuid := auth.uid();
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_linha public.vendedores;
  v_ids uuid[];
begin
  if not public.app_gestor_comercial() then
    raise exception 'Só gestores cadastram vendedor.' using errcode = '42501';
  end if;
  if coalesce(p ->> 'tipo', '') not in ('sdr', 'vendedor', 'originador') then
    raise exception 'Tipo inválido.' using errcode = '22023';
  end if;
  -- O CHECK da tabela já exige um dos dois; a mensagem aqui é para chegar ao formulário
  -- em português, em vez de voltar como violação de constraint.
  if nullif(p ->> 'usuario_id', '') is null and not coalesce((p ->> 'is_ia')::boolean, false) then
    raise exception 'Vendedor precisa de um usuário, ou de ser marcado como IA.' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.vendedores (nome, tipo, usuario_id, is_ia, whatsapp_conta_id, email_remetente, settings, ativo)
    values (
      p ->> 'nome',
      p ->> 'tipo',
      nullif(p ->> 'usuario_id', '')::uuid,
      coalesce((p ->> 'is_ia')::boolean, false),
      nullif(p ->> 'whatsapp_conta_id', '')::uuid,
      nullif(p ->> 'email_remetente', ''),
      coalesce(p -> 'settings', '{}'::jsonb),
      coalesce((p ->> 'ativo')::boolean, true)
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
      ativo = coalesce((p ->> 'ativo')::boolean, ativo)
    where id = v_id
    returning * into v_linha;
    if v_linha.id is null then
      raise exception 'Vendedor não encontrado.' using errcode = 'no_data_found';
    end if;
  end if;

  /*
   * O espelho, na MESMA transação.
   *
   * Vendedor inativo ou que deixou de ser originador tem a carteira encerrada, não
   * apagada: a vigência fechada é o que explica uma comissão de três meses atrás. E o
   * conjunto vazio é um conjunto — quem tirou todas as empresas está dizendo isso.
   */
  v_ids := case
    when v_linha.tipo = 'originador' and v_linha.ativo then coalesce(
      (select array_agg((x)::uuid)
       from jsonb_array_elements_text(coalesce(v_linha.settings -> 'empresas_escolhidas', '[]'::jsonb)) x),
      '{}'::uuid[])
    else '{}'::uuid[]
  end;
  perform public.app_sincronizar_carteira_originacao(v_linha.id, v_ids);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, case when v_id is null then 'comercial.vendedor_criado' else 'comercial.vendedor_alterado' end,
          'vendedores', v_linha.id::text, p);

  return v_linha;
end $function$;

-- ─── Backfill do que já estava cadastrado ───────────────────────────────────
--
-- Sem isto, a comissão continuaria zerada para quem já tem carteira montada até a próxima
-- vez que alguém abrisse e salvasse o cadastro — e ninguém abre um cadastro que está certo.
--
-- `desde` fica em `now()`: não há como saber quando a empresa entrou no `settings` (jsonb
-- não guarda histórico), e inventar uma data retroativa criaria vigência para um período
-- em que a decisão talvez não existisse. A consequência é honesta e conservadora — o que
-- converteu antes de hoje não gera comissão, porque de fato não havia carteira registrada.

do $$
declare r record;
begin
  for r in
    select v.id,
           coalesce((select array_agg((x)::uuid)
                     from jsonb_array_elements_text(coalesce(v.settings -> 'empresas_escolhidas', '[]'::jsonb)) x),
                    '{}'::uuid[]) as ids
    from public.vendedores v
    where v.tipo = 'originador' and v.ativo
  loop
    perform public.app_sincronizar_carteira_originacao(r.id, r.ids);
  end loop;
end $$;

-- ─── Virar passiva também encerra a originação ──────────────────────────────
--
-- O gatilho de 0095 fechava só `gestao_passiva`. Faltava o simétrico: uma conta que passa
-- a passiva sai da carteira de originação, senão a mesma operação pagaria o originador
-- (por NF convertida) e o closer (por volume) ao mesmo tempo.

create or replace function public.empresas_fecha_gestao_passiva()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.gestao_operacao is distinct from 'passivo' then
    update public.vendedor_carteira set ate = now()
    where empresa_id = new.id and papel = 'gestao_passiva' and ate is null;
  else
    update public.vendedor_carteira set ate = now()
    where empresa_id = new.id and papel = 'originacao' and ate is null;
  end if;
  return null;
end $$;

-- ─── O alcance da carteira, para a tela dizer se o link funcionou ───────────
--
-- Quem linka uma empresa e abre o funil de NFs no segundo seguinte não vê nada: o
-- roteamento roda encadeado no diário. Antes das SPEs isso era um incômodo; agora um link
-- pode trazer 706 notas de uma vez, e "não apareceu nada" vira "isto está quebrado".
--
-- Esta função responde na hora quantas notas a carteira ALCANÇA — que é a pergunta real
-- ("meu link pegou?"), e não quantas mudaram de dono (que só se sabe depois do job).

create or replace function public.comercial_alcance_da_carteira(p_vendedor_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  v_ids uuid[];
  v_grupos uuid[];
  v_total int;
  v_via_spe int;
begin
  if not public.app_tem_modulo('comercial') then
    return jsonb_build_object('tem_acesso', false);
  end if;

  select coalesce((select array_agg((x)::uuid)
                   from jsonb_array_elements_text(coalesce(v.settings -> 'empresas_escolhidas', '[]'::jsonb)) x),
                  '{}'::uuid[])
    into v_ids
  from public.vendedores v where v.id = p_vendedor_id;

  if v_ids is null or array_length(v_ids, 1) is null then
    return jsonb_build_object('tem_acesso', true, 'nfs_vivas', 0, 'via_spe', 0);
  end if;

  select coalesce(array_agg(distinct e.grupo_id), '{}'::uuid[]) into v_grupos
  from public.empresas e where e.id = any(v_ids) and e.grupo_id is not null;

  select count(*),
         count(*) filter (where not (nf.sacado_empresa_id = any(v_ids))
                            and not (nf.fornecedor_empresa_id = any(v_ids)))
    into v_total, v_via_spe
  from public.notas_fiscais nf
  left join public.mercado_universo su on su.cnpj = nf.sacado_cnpj
  left join public.mercado_universo fu on fu.cnpj = nf.fornecedor_cnpj
  where nf.estagio_funil not in ('convertida', 'perdida')
    and nf.operavel is not false
    and (
      nf.sacado_empresa_id = any(v_ids)
      or nf.fornecedor_empresa_id = any(v_ids)
      or (su.is_spe and su.grupo_id = any(v_grupos))
      or (fu.is_spe and fu.grupo_id = any(v_grupos))
    );

  return jsonb_build_object('tem_acesso', true, 'nfs_vivas', v_total, 'via_spe', v_via_spe);
end $function$;

revoke execute on function public.comercial_alcance_da_carteira(uuid) from public;
grant execute on function public.comercial_alcance_da_carteira(uuid) to authenticated, service_role;
