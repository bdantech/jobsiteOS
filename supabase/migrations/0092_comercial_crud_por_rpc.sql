-- 0092 — O cadastro do Comercial passa a ser feito pela tela, não por migração.
--
-- Adiei isto no 04g por causa de auditoria, e o motivo estava certo pela razão errada:
-- rastro não é argumento para não ter tela, é argumento para a tela escrever por RPC.
-- Toda função aqui grava em audit_log e exige gestor — mesma disciplina do resto.
--
-- O que continua SEM tela é DELETAR: vendedor não se apaga, se desativa. Um vendedor
-- removido levaria junto a explicação de comissões já pagas (o `on delete cascade` de
-- vendedor_carteira é para dados de teste, não para uso).

create or replace function public.app_salvar_vendedor(p jsonb)
returns public.vendedores language plpgsql security definer set search_path = '' as $function$
declare
  v_ator uuid := auth.uid();
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_linha public.vendedores;
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

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, case when v_id is null then 'comercial.vendedor_criado' else 'comercial.vendedor_alterado' end,
          'vendedores', v_linha.id::text, p);

  return v_linha;
end $function$;

create or replace function public.app_salvar_territorio(p jsonb)
returns public.vendedor_territorios language plpgsql security definer set search_path = '' as $function$
declare
  v_ator uuid := auth.uid();
  v_linha public.vendedor_territorios;
  v_min numeric := nullif(p ->> 'faturamento_min', '')::numeric;
  v_max numeric := nullif(p ->> 'faturamento_max', '')::numeric;
begin
  if not public.app_gestor_comercial() then
    raise exception 'Só gestores mudam território.' using errcode = '42501';
  end if;
  -- Faixa invertida não é território estreito, é engano de digitação: aceitar produz um
  -- originador que nunca casa com nada e ninguém entende por quê.
  if v_min is not null and v_max is not null and v_min > v_max then
    raise exception 'Faturamento mínimo maior que o máximo.' using errcode = '22023';
  end if;

  insert into public.vendedor_territorios (vendedor_id, ufs, faturamento_min, faturamento_max)
  values (
    (p ->> 'vendedor_id')::uuid,
    coalesce((select array_agg(upper(trim(x))) from jsonb_array_elements_text(coalesce(p -> 'ufs', '[]'::jsonb)) x
              where trim(x) <> ''), '{}'::text[]),
    v_min, v_max
  )
  on conflict (vendedor_id) do update set
    ufs = excluded.ufs,
    faturamento_min = excluded.faturamento_min,
    faturamento_max = excluded.faturamento_max
  returning * into v_linha;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'comercial.territorio_salvo', 'vendedor_territorios', v_linha.vendedor_id::text, p);

  return v_linha;
end $function$;

/*
 * Regra nova ENCERRA a anterior na véspera, em vez de conviver com ela.
 *
 * A busca por regra vigente já resolveria a sobreposição pela data de início mais
 * recente, mas duas regras vigentes ao mesmo tempo é o tipo de estado que faz alguém
 * conferir a folha e não conseguir explicar o número. Fechar a anterior deixa o
 * histórico legível: cada período tem exatamente uma regra.
 */
create or replace function public.app_salvar_comissao_regra(p jsonb)
returns public.comissao_regras language plpgsql security definer set search_path = '' as $function$
declare
  v_ator uuid := auth.uid();
  v_tipo text := p ->> 'tipo_vendedor';
  v_vend uuid := nullif(p ->> 'vendedor_id', '')::uuid;
  v_de date := coalesce(nullif(p ->> 'vigente_de', '')::date, current_date);
  v_linha public.comissao_regras;
begin
  if not public.app_gestor_comercial() then
    raise exception 'Só gestores mudam regra de comissão.' using errcode = '42501';
  end if;
  if v_tipo not in ('sdr', 'vendedor', 'originador') then
    raise exception 'Tipo inválido.' using errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(p -> 'parametros'), 'null') <> 'object' then
    raise exception 'Parâmetros inválidos.' using errcode = '22023';
  end if;

  update public.comissao_regras set vigente_ate = v_de - 1
  where tipo_vendedor = v_tipo
    and vendedor_id is not distinct from v_vend
    and vigente_ate is null
    and vigente_de < v_de;

  insert into public.comissao_regras (tipo_vendedor, vendedor_id, parametros, vigente_de, criada_por)
  values (v_tipo, v_vend, p -> 'parametros', v_de, v_ator)
  returning * into v_linha;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'comercial.regra_salva', 'comissao_regras', v_linha.id::text, p);

  return v_linha;
end $function$;

create or replace function public.app_salvar_acesso_vendedor(p jsonb)
returns void language plpgsql security definer set search_path = '' as $function$
declare
  v_ator uuid := auth.uid();
begin
  if not public.app_gestor_comercial() then
    raise exception 'Só gestores concedem acesso.' using errcode = '42501';
  end if;

  if coalesce((p ->> 'conceder')::boolean, true) then
    insert into public.vendedor_acessos (vendedor_id, pode_ver_vendedor_id)
    values ((p ->> 'vendedor_id')::uuid, (p ->> 'pode_ver_vendedor_id')::uuid)
    on conflict do nothing;
  else
    delete from public.vendedor_acessos
    where vendedor_id = (p ->> 'vendedor_id')::uuid
      and pode_ver_vendedor_id = (p ->> 'pode_ver_vendedor_id')::uuid;
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'comercial.acesso_alterado', 'vendedor_acessos', p ->> 'vendedor_id', p);
end $function$;

create or replace function public.app_salvar_comercial_config(p jsonb)
returns public.comercial_config language plpgsql security definer set search_path = '' as $function$
declare
  v_ator uuid := auth.uid();
  v_linha public.comercial_config;
begin
  if not public.app_gestor_comercial() then
    raise exception 'Só gestores mudam a configuração.' using errcode = '42501';
  end if;
  if coalesce(p ->> 'chave', '') not in ('distribuicao', 'painel', 'passivos', 'comissao') then
    raise exception 'Chave de configuração desconhecida.' using errcode = '22023';
  end if;

  insert into public.comercial_config (chave, valor, atualizado_por, atualizado_em)
  values (p ->> 'chave', p -> 'valor', v_ator, now())
  on conflict (chave) do update set
    -- MERGE, não substituição: a tela manda só o que mudou, e trocar o objeto inteiro
    -- apagaria em silêncio a chave que a tela ainda não sabe editar.
    valor = public.comercial_config.valor || excluded.valor,
    atualizado_por = v_ator,
    atualizado_em = now()
  returning * into v_linha;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'comercial.config_salva', 'comercial_config', v_linha.chave, p);

  return v_linha;
end $function$;

create or replace function public.app_salvar_motivo_perda(p jsonb)
returns public.motivos_perda language plpgsql security definer set search_path = '' as $function$
declare
  v_ator uuid := auth.uid();
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_linha public.motivos_perda;
begin
  if not public.app_gestor_comercial() then
    raise exception 'Só gestores mudam motivos.' using errcode = '42501';
  end if;

  if v_id is null then
    insert into public.motivos_perda (contexto, motivo, ordem, ativo)
    values (p ->> 'contexto', p ->> 'motivo', coalesce((p ->> 'ordem')::int, 100),
            coalesce((p ->> 'ativo')::boolean, true))
    -- Reativar em vez de duplicar: um motivo desativado e recriado com o mesmo texto
    -- partiria a estatística dele em dois.
    on conflict (contexto, motivo) do update set ativo = true, ordem = excluded.ordem
    returning * into v_linha;
  else
    update public.motivos_perda set
      motivo = coalesce(p ->> 'motivo', motivo),
      ordem = coalesce((p ->> 'ordem')::int, ordem),
      ativo = coalesce((p ->> 'ativo')::boolean, ativo)
    where id = v_id
    returning * into v_linha;
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'comercial.motivo_salvo', 'motivos_perda', v_linha.id::text, p);

  return v_linha;
end $function$;

revoke execute on function public.app_salvar_vendedor(jsonb), public.app_salvar_territorio(jsonb),
  public.app_salvar_comissao_regra(jsonb), public.app_salvar_acesso_vendedor(jsonb),
  public.app_salvar_comercial_config(jsonb), public.app_salvar_motivo_perda(jsonb) from public;
grant execute on function public.app_salvar_vendedor(jsonb), public.app_salvar_territorio(jsonb),
  public.app_salvar_comissao_regra(jsonb), public.app_salvar_acesso_vendedor(jsonb),
  public.app_salvar_comercial_config(jsonb), public.app_salvar_motivo_perda(jsonb)
  to authenticated, service_role;
