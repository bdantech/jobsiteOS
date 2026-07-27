-- =============================================================================
-- 0047 — Antecipação: write-helpers (RPCs)
--
-- Convenção do projeto (0008/0013/0029): mutações do usuário passam por RPCs
-- SECURITY INVOKER (rodam como o usuário → a RLS governa a escrita), search_path
-- vazio, refs schema-qualificadas, e gravam entidade + evento + audit_log em UMA
-- transação. As escritas de MÁQUINA (sync de NFs, outbox, reclassificação) são do
-- worker com service role e não passam por aqui.
--
-- notas_fiscais e mensagens_outbox NÃO têm grant de update para `authenticated`:
-- o único caminho de escrita é este arquivo, o que torna "mover estágio sem
-- registrar evento" inexprimível em vez de apenas desencorajado.
-- =============================================================================

-- ─── Mover uma NF de estágio (§5) ────────────────────────────────────────────
create or replace function app_mover_estagio_nf(p jsonb)
returns notas_fiscais language plpgsql security definer set search_path = '' as $$
declare
  v_nf public.notas_fiscais;
  v_antes text;
  v_ator uuid := auth.uid();
  v_destino text := p ->> 'estagio_funil';
  v_motivo text := nullif(p ->> 'perda_motivo', '');
begin
  if not public.app_tem_modulo('antecipacao') then
    raise exception 'Sem acesso ao módulo Antecipação.' using errcode = '42501';
  end if;
  if v_destino not in ('a_prospectar', 'em_prospeccao', 'em_negociacao',
                       'antecipacao_andamento', 'convertida', 'perdida', 'expirada') then
    raise exception 'Estágio inválido: %.', v_destino using errcode = '22023';
  end if;
  -- "Perdida" sem motivo é a forma mais rápida de perder a única informação que
  -- torna a métrica de faixa acionável.
  if v_destino = 'perdida' and v_motivo is null then
    raise exception 'Informe o motivo da perda.' using errcode = '23514';
  end if;

  select estagio_funil into v_antes from public.notas_fiscais
    where access_key = p ->> 'access_key';
  if v_antes is null then
    raise exception 'Nota fiscal não encontrada.' using errcode = 'no_data_found';
  end if;

  update public.notas_fiscais set
    estagio_funil = v_destino,
    estagio_alterado_em = now(),
    estagio_alterado_por = v_ator,
    perda_motivo = case when v_destino = 'perdida' then v_motivo else perda_motivo end
  where access_key = p ->> 'access_key'
  returning * into v_nf;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (
    v_nf.fornecedor_empresa_id,
    case v_destino
      when 'convertida' then 'nf.convertida'
      when 'perdida' then 'nf.perdida'
      else 'nf.estagio_alterado'
    end,
    jsonb_build_object(
      'titulo', 'Nota ' || coalesce(v_nf.numero, v_nf.access_key) || ' — ' || v_destino,
      'resumo', coalesce(v_nf.fornecedor_nome, v_nf.fornecedor_cnpj) || ': nota de R$ '
                || to_char(v_nf.valor, 'FM999G999G990D00') || ' moveu de ' || v_antes
                || ' para ' || v_destino || coalesce('. Motivo: ' || v_motivo, '') || '.',
      'url', '/antecipacao?nota=' || v_nf.access_key,
      'access_key', v_nf.access_key,
      'de', v_antes,
      'para', v_destino,
      'perda_motivo', v_motivo,
      'faixa', v_nf.faixa,
      'valor', v_nf.valor
    ),
    v_ator
  );

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'antecipacao.estagio_movido', 'notas_fiscais', v_nf.access_key, p);

  return v_nf;
end; $$;

comment on function app_mover_estagio_nf(jsonb) is
  'Move uma NF de estágio no funil. SECURITY DEFINER porque notas_fiscais não tem grant de update: o gate é app_tem_modulo no topo, e o evento + audit saem na mesma transação.';

-- ─── Fornecedor sem interesse: supressão soft (90d) ou eterna (§5) ───────────
create or replace function app_marcar_sem_interesse(p jsonb)
returns supressao language plpgsql security definer set search_path = '' as $$
declare
  v_sup public.supressao;
  v_ator uuid := auth.uid();
  v_cnpj text := p ->> 'fornecedor_cnpj';
  v_dias int := coalesce((p ->> 'dias')::int, 90);
  v_eterna boolean := coalesce((p ->> 'eterna')::boolean, false);
  v_expira date;
  v_empresa uuid;
  v_nome text;
begin
  if not public.app_tem_modulo('antecipacao') then
    raise exception 'Sem acesso ao módulo Antecipação.' using errcode = '42501';
  end if;
  if v_cnpj !~ '^[0-9]{14}$' then
    raise exception 'CNPJ inválido.' using errcode = '22023';
  end if;
  if nullif(p ->> 'motivo', '') is null then
    raise exception 'Informe o motivo.' using errcode = '23514';
  end if;

  v_expira := case when v_eterna then null else current_date + v_dias end;

  insert into public.supressao (escopo, valor, motivo, observacao, criado_por, expira_em, contexto)
  values (
    'empresa', v_cnpj,
    case when v_eterna then 'solicitacao_lgpd' else 'nao_abordar' end,
    p ->> 'motivo', v_ator, v_expira, 'antecipacao'
  )
  on conflict (escopo, valor) do update
    set expira_em = excluded.expira_em,
        observacao = excluded.observacao,
        motivo = excluded.motivo,
        contexto = excluded.contexto
  returning * into v_sup;

  -- As notas do fornecedor continuam no universo; o que sai é a FAIXA. Fazer isso
  -- aqui (e não só no job) é o que faz o card sumir do Kanban no mesmo clique.
  update public.notas_fiscais
    set faixa = null, faixa_motivo = 'suprimido', faixa_alterada_em = now()
  where fornecedor_cnpj = v_cnpj and faixa is not null;

  select id, coalesce(razao_social, nome_fantasia) into v_empresa, v_nome
    from public.empresas where cnpj = v_cnpj;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (
    v_empresa, 'fornecedor.sem_interesse',
    jsonb_build_object(
      'titulo', 'Fornecedor sem interesse',
      'resumo', coalesce(v_nome, v_cnpj) || ' marcado como sem interesse ('
                || case when v_eterna then 'eterna' else v_dias || ' dias' end || '): '
                || (p ->> 'motivo'),
      'url', '/antecipacao',
      'cnpj', v_cnpj,
      'expira_em', v_expira,
      'motivo', p ->> 'motivo'
    ),
    v_ator
  );

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'antecipacao.sem_interesse', 'supressao', v_sup.id::text, p);

  return v_sup;
end; $$;

-- ─── Regras de faixa: salvar nova versão / ativar (admin, pela RLS) ──────────
create or replace function app_salvar_faixa_regra(p jsonb)
returns faixa_regras language plpgsql set search_path = '' as $$
declare
  v_regra public.faixa_regras;
  v_ator uuid := auth.uid();
  v_faixa text := p ->> 'faixa';
  v_versao int;
begin
  select coalesce(max(versao), 0) + 1 into v_versao
    from public.faixa_regras where faixa = v_faixa;

  insert into public.faixa_regras (faixa, versao, definicao, ativa, criada_por)
  values (v_faixa, v_versao, p -> 'definicao', false, v_ator)
  returning * into v_regra;

  if v_regra.id is null then
    raise exception 'Sem permissão para salvar regra de faixa.' using errcode = '42501';
  end if;

  if coalesce((p ->> 'ativar')::boolean, false) then
    update public.faixa_regras set ativa = false where faixa = v_faixa and ativa;
    update public.faixa_regras set ativa = true where id = v_regra.id returning * into v_regra;
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'antecipacao.faixa_regra_salva', 'faixa_regras', v_regra.id::text, p);

  return v_regra;
end; $$;

create or replace function app_ativar_faixa_regra(p jsonb)
returns faixa_regras language plpgsql set search_path = '' as $$
declare
  v_regra public.faixa_regras;
  v_ator uuid := auth.uid();
begin
  select * into v_regra from public.faixa_regras where id = (p ->> 'id')::uuid;
  if v_regra.id is null then
    raise exception 'Regra não encontrada.' using errcode = 'no_data_found';
  end if;

  update public.faixa_regras set ativa = false where faixa = v_regra.faixa and ativa;
  update public.faixa_regras set ativa = true where id = v_regra.id returning * into v_regra;

  if not v_regra.ativa then
    raise exception 'Sem permissão para ativar regra de faixa.' using errcode = '42501';
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'antecipacao.faixa_regra_ativada', 'faixa_regras', v_regra.id::text, p);

  return v_regra;
end; $$;

-- ─── Config de disparo por faixa ─────────────────────────────────────────────
create or replace function app_salvar_faixa_disparo(p jsonb)
returns faixa_disparos language plpgsql set search_path = '' as $$
declare
  v_cfg public.faixa_disparos;
  v_ator uuid := auth.uid();
begin
  insert into public.faixa_disparos (
    faixa, email_habilitado, whatsapp_habilitado, whatsapp_contas,
    cooldown_dias, template_email, template_whatsapp, assunto_email, atualizado_por
  ) values (
    p ->> 'faixa',
    coalesce((p ->> 'email_habilitado')::boolean, false),
    coalesce((p ->> 'whatsapp_habilitado')::boolean, false),
    coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p -> 'whatsapp_contas') x), '{}'),
    coalesce((p ->> 'cooldown_dias')::int, 7),
    p ->> 'template_email',
    p ->> 'template_whatsapp',
    p ->> 'assunto_email',
    v_ator
  )
  on conflict (faixa) do update set
    email_habilitado = excluded.email_habilitado,
    whatsapp_habilitado = excluded.whatsapp_habilitado,
    whatsapp_contas = excluded.whatsapp_contas,
    cooldown_dias = excluded.cooldown_dias,
    template_email = excluded.template_email,
    template_whatsapp = excluded.template_whatsapp,
    assunto_email = excluded.assunto_email,
    atualizado_por = v_ator
  returning * into v_cfg;

  if v_cfg.faixa is null then
    raise exception 'Sem permissão para salvar a régua de disparo.' using errcode = '42501';
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'antecipacao.disparo_salvo', 'faixa_disparos', v_cfg.faixa, p);

  return v_cfg;
end; $$;

-- ─── Contas de WhatsApp: o token vai para o Vault, nunca para a tabela ───────
create or replace function app_salvar_whatsapp_conta(p jsonb)
returns whatsapp_contas language plpgsql security definer set search_path = '' as $$
declare
  v_conta public.whatsapp_contas;
  v_ator uuid := auth.uid();
  v_token text := nullif(p ->> 'token', '');
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_secret uuid;
begin
  -- DEFINER porque escreve no schema `vault`, que `authenticated` não alcança —
  -- e é precisamente por isso que o token não pode voltar por PostgREST.
  if not public.app_is_admin() then
    raise exception 'Somente administradores gerenciam contas de WhatsApp.' using errcode = '42501';
  end if;

  if v_id is null then
    insert into public.whatsapp_contas (apelido, numero, provedor, usuario_responsavel, ativo)
    values (
      p ->> 'apelido',
      regexp_replace(coalesce(p ->> 'numero', ''), '\D', '', 'g'),
      coalesce(p ->> 'provedor', 'wasender'),
      nullif(p ->> 'usuario_responsavel', '')::uuid,
      coalesce((p ->> 'ativo')::boolean, true)
    )
    returning * into v_conta;
  else
    update public.whatsapp_contas set
      apelido = coalesce(p ->> 'apelido', apelido),
      numero = coalesce(regexp_replace(nullif(p ->> 'numero', ''), '\D', '', 'g'), numero),
      provedor = coalesce(p ->> 'provedor', provedor),
      usuario_responsavel = coalesce(nullif(p ->> 'usuario_responsavel', '')::uuid, usuario_responsavel),
      ativo = coalesce((p ->> 'ativo')::boolean, ativo)
    where id = v_id
    returning * into v_conta;

    if v_conta.id is null then
      raise exception 'Conta de WhatsApp não encontrada.' using errcode = 'no_data_found';
    end if;
  end if;

  if v_token is not null then
    v_secret := vault.create_secret(
      v_token,
      'whatsapp_token_' || v_conta.id::text || '_' || extract(epoch from now())::bigint::text,
      'Token do provedor de WhatsApp (' || v_conta.apelido || ').'
    );
    update public.whatsapp_contas
      set token_secret_id = v_secret, token_definido_em = now()
      where id = v_conta.id
      returning * into v_conta;
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (
    v_ator, 'antecipacao.whatsapp_conta_salva', 'whatsapp_contas', v_conta.id::text,
    -- O token NUNCA entra no audit_log. Registra-se que houve troca, não o valor.
    (p - 'token') || jsonb_build_object('token_alterado', v_token is not null)
  );

  return v_conta;
end; $$;

comment on function app_salvar_whatsapp_conta(jsonb) is
  'Cria/atualiza uma conta de WhatsApp. O token vai para o Supabase Vault e o audit_log registra apenas QUE houve troca — nunca o valor.';

-- ─── Outbox: descartar (com motivo) ──────────────────────────────────────────
create or replace function app_descartar_mensagem(p jsonb)
returns mensagens_outbox language plpgsql security definer set search_path = '' as $$
declare
  v_msg public.mensagens_outbox;
  v_ator uuid := auth.uid();
begin
  if not public.app_tem_modulo('antecipacao') then
    raise exception 'Sem acesso ao módulo Antecipação.' using errcode = '42501';
  end if;
  if nullif(p ->> 'motivo', '') is null then
    raise exception 'Informe o motivo do descarte.' using errcode = '23514';
  end if;

  update public.mensagens_outbox set
    status = 'descartada',
    motivo_descarte = p ->> 'motivo',
    descartada_por = v_ator
  where id = (p ->> 'id')::uuid and status in ('pendente_envio', 'aprovada')
  returning * into v_msg;

  if v_msg.id is null then
    raise exception 'Mensagem não encontrada ou já processada.' using errcode = 'no_data_found';
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'antecipacao.mensagem_descartada', 'mensagens_outbox', v_msg.id::text, p);

  return v_msg;
end; $$;

-- ─── Ponto focal de contato (§3.2) ───────────────────────────────────────────
-- Marcar um DESMARCA o anterior, na mesma transação: o índice parcial único não
-- permite dois, e fazer isso em duas chamadas do cliente deixaria uma janela em
-- que a segunda falha e a empresa fica sem ponto focal nenhum.
create or replace function app_definir_ponto_focal(p jsonb)
returns contatos language plpgsql set search_path = '' as $$
declare
  v_contato public.contatos;
  v_ator uuid := auth.uid();
  v_empresa uuid;
  v_marcar boolean := coalesce((p ->> 'ponto_focal')::boolean, true);
begin
  select empresa_id into v_empresa from public.contatos where id = (p ->> 'id')::uuid;
  if v_empresa is null then
    raise exception 'Contato não encontrado.' using errcode = 'no_data_found';
  end if;

  update public.contatos set ponto_focal = false
    where empresa_id = v_empresa and ponto_focal and id <> (p ->> 'id')::uuid;

  update public.contatos set ponto_focal = v_marcar
    where id = (p ->> 'id')::uuid
    returning * into v_contato;

  if v_contato.id is null then
    raise exception 'Sem permissão para definir o ponto focal.' using errcode = '42501';
  end if;

  if v_marcar then
    insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
    values (
      v_empresa, 'contato.ponto_focal_definido',
      jsonb_build_object(
        'resumo', coalesce(v_contato.nome, v_contato.email, 'Contato')
                  || ' agora é o ponto focal da empresa.',
        'contato_id', v_contato.id
      ),
      v_ator
    );
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'antecipacao.ponto_focal_definido', 'contatos', v_contato.id::text, p);

  return v_contato;
end; $$;

-- ─── Toque manual (o vendedor ligou / abriu WhatsApp / mandou e-mail) ────────
-- Registrado como evento porque o cooldown da outbox O LÊ: sem isto a régua
-- automática atropela o vendedor que acabou de falar com o fornecedor.
create or replace function app_registrar_toque_manual(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_cnpj text := p ->> 'fornecedor_cnpj';
  v_canal text := p ->> 'canal';
  v_empresa uuid;
  v_nome text;
begin
  if not public.app_tem_modulo('antecipacao') then
    raise exception 'Sem acesso ao módulo Antecipação.' using errcode = '42501';
  end if;
  if v_canal not in ('ligacao', 'whatsapp', 'email') then
    raise exception 'Canal inválido: %.', v_canal using errcode = '22023';
  end if;
  if v_cnpj !~ '^[0-9]{14}$' then
    raise exception 'CNPJ inválido.' using errcode = '22023';
  end if;

  select id, coalesce(razao_social, nome_fantasia) into v_empresa, v_nome
    from public.empresas where cnpj = v_cnpj;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (
    v_empresa, 'toque.manual',
    jsonb_build_object(
      'titulo', 'Toque manual',
      'resumo', 'Contato por ' || v_canal || ' com ' || coalesce(v_nome, v_cnpj) || '.',
      'cnpj', v_cnpj,
      'canal', v_canal,
      'contato', p ->> 'contato',
      'access_key', p ->> 'access_key'
    ),
    v_ator
  );
end; $$;

-- ─── Settings do módulo ──────────────────────────────────────────────────────
create or replace function app_salvar_antecipacao_config(p jsonb)
returns antecipacao_config language plpgsql set search_path = '' as $$
declare
  v_cfg public.antecipacao_config;
  v_ator uuid := auth.uid();
begin
  insert into public.antecipacao_config (chave, valor, atualizado_por)
  values (p ->> 'chave', p -> 'valor', v_ator)
  on conflict (chave) do update set valor = excluded.valor, atualizado_por = v_ator
  returning * into v_cfg;

  if v_cfg.chave is null then
    raise exception 'Sem permissão para salvar configuração da Antecipação.' using errcode = '42501';
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'antecipacao.config_salva', 'antecipacao_config', v_cfg.chave, p);

  return v_cfg;
end; $$;

-- ─── Grants: revoga de public, concede a authenticated + service_role ────────
revoke execute on function app_mover_estagio_nf(jsonb) from public;
revoke execute on function app_marcar_sem_interesse(jsonb) from public;
revoke execute on function app_salvar_faixa_regra(jsonb) from public;
revoke execute on function app_ativar_faixa_regra(jsonb) from public;
revoke execute on function app_salvar_faixa_disparo(jsonb) from public;
revoke execute on function app_salvar_whatsapp_conta(jsonb) from public;
revoke execute on function app_descartar_mensagem(jsonb) from public;
revoke execute on function app_definir_ponto_focal(jsonb) from public;
revoke execute on function app_registrar_toque_manual(jsonb) from public;
revoke execute on function app_salvar_antecipacao_config(jsonb) from public;

grant execute on function app_mover_estagio_nf(jsonb) to authenticated, service_role;
grant execute on function app_marcar_sem_interesse(jsonb) to authenticated, service_role;
grant execute on function app_salvar_faixa_regra(jsonb) to authenticated, service_role;
grant execute on function app_ativar_faixa_regra(jsonb) to authenticated, service_role;
grant execute on function app_salvar_faixa_disparo(jsonb) to authenticated, service_role;
grant execute on function app_salvar_whatsapp_conta(jsonb) to authenticated, service_role;
grant execute on function app_descartar_mensagem(jsonb) to authenticated, service_role;
grant execute on function app_definir_ponto_focal(jsonb) to authenticated, service_role;
grant execute on function app_registrar_toque_manual(jsonb) to authenticated, service_role;
grant execute on function app_salvar_antecipacao_config(jsonb) to authenticated, service_role;

-- ─── Supressão com validade: o guard e o RPC do Radar aprendem `expira_em` ───
-- app_suprimir passa a aceitar (e ignorar quando ausente) expira_em/contexto,
-- para que a supressão do Radar e a da Antecipação sejam a MESMA lista — duas
-- listas dariam duas respostas para "posso tocar neste CNPJ?".
create or replace function app_suprimir(p jsonb)
returns supressao language plpgsql set search_path = '' as $$
declare
  v_sup public.supressao;
  v_ator uuid := auth.uid();
begin
  insert into public.supressao (escopo, valor, motivo, observacao, criado_por, expira_em, contexto)
  values (
    p ->> 'escopo', p ->> 'valor', p ->> 'motivo', p ->> 'observacao', v_ator,
    nullif(p ->> 'expira_em', '')::date,
    coalesce(nullif(p ->> 'contexto', ''), 'geral')
  )
  on conflict (escopo, valor) do nothing
  returning * into v_sup;

  if v_sup.id is null then
    select * into v_sup from public.supressao
      where escopo = p ->> 'escopo' and valor = p ->> 'valor';
  end if;

  if v_sup.id is null then
    raise exception 'Sem permissão para suprimir.' using errcode = '42501';
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'radar.suprimido', 'supressao', v_sup.id::text, p);

  return v_sup;
end; $$;

-- ─── Métricas por faixa (§5): funil entrou → contatada → respondeu → convertida ─
-- Definer e não uma view: cruza empresa_eventos (módulo `empresas`) com o funil
-- (módulo `antecipacao`), e quem tem Antecipação precisa ver o número mesmo sem
-- ter Empresas. O portão é feito uma vez, aqui em cima.
create or replace function antecipacao_metricas_faixa()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if not public.app_tem_modulo('antecipacao') then
    return jsonb_build_object('tem_acesso', false);
  end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.faixa), '[]'::jsonb) into v
  from (
    select
      coalesce(nf.faixa, 'sem_faixa') as faixa,
      nf.faixa_regra_versao as regra_versao,
      count(*)::int as notas,
      coalesce(sum(nf.valor), 0) as valor,
      coalesce(sum(nf.receita_esperada), 0) as receita_esperada,
      count(*) filter (where nf.estagio_funil <> 'a_prospectar')::int as contatadas,
      count(*) filter (where nf.estagio_funil in
        ('em_negociacao', 'antecipacao_andamento', 'convertida'))::int as responderam,
      count(*) filter (where nf.estagio_funil = 'convertida')::int as convertidas,
      coalesce(sum(nf.valor) filter (where nf.estagio_funil = 'convertida'), 0) as valor_convertido,
      count(*) filter (where nf.estagio_funil = 'perdida')::int as perdidas,
      count(*) filter (where nf.estagio_funil = 'expirada')::int as expiradas
    from public.notas_fiscais nf
    group by 1, 2
  ) t;

  return jsonb_build_object('tem_acesso', true, 'faixas', v);
end $$;
revoke execute on function antecipacao_metricas_faixa() from public;
grant execute on function antecipacao_metricas_faixa() to authenticated;

-- ─── Resumo do funil por estágio (contagens do Kanban, em uma chamada) ───────
create or replace function antecipacao_resumo_funil()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if not public.app_tem_modulo('antecipacao') then
    return jsonb_build_object('tem_acesso', false);
  end if;

  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v
  from (
    select
      nf.estagio_funil,
      nf.faixa,
      count(*)::int as notas,
      coalesce(sum(nf.valor), 0) as valor,
      coalesce(sum(nf.receita_esperada), 0) as receita_esperada
    from public.notas_fiscais nf
    group by 1, 2
  ) t;

  return jsonb_build_object('tem_acesso', true, 'celulas', v);
end $$;
revoke execute on function antecipacao_resumo_funil() from public;
grant execute on function antecipacao_resumo_funil() to authenticated;
