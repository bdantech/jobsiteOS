-- ─────────────────────────────────────────────────────────────────────────────
-- 0145 — As contas de WhatsApp voltam a ser editáveis, e onde elas vivem agora
--
-- A 0144 acrescentou a `whatsapp_contas` as cinco colunas que DECIDEM o
-- comportamento do canal (`tipo`, `mensagens_por_dia`, `warmup_iniciado_em`,
-- `intervalo_min_seg`, `intervalo_max_seg`) e não mexeu em duas coisas que
-- precisavam ter sido mexidas junto. Esta migração fecha as duas.
--
-- 1) GRANT. A 0052 revogou o select de TABELA em `whatsapp_contas` e passou a
--    conceder coluna por coluna, justamente para que `token_secret_id` ficasse
--    ilegível. O efeito colateral só aparece agora: um grant coluna a coluna não
--    alcança colunas FUTURAS. As cinco nasceram sem select, e a tela de
--    Configurações da Comunicação — que as lê — quebrava com
--    `permission denied for table whatsapp_contas`. O conserto é conceder as
--    cinco explicitamente, nunca reconceder a tabela: um `grant select on table`
--    aqui reabriria o ponteiro do Vault e desfaria a 0052 em silêncio.
--
-- 2) ESCRITA. `app_salvar_whatsapp_conta` (0047) continuava salvando a metade
--    antiga da linha. Marcar um número como `ia` ou iniciar o warmup só era
--    possível por SQL direto — e sem `tipo = 'ia'` a persona não envia nada,
--    então a configuração que o produto exige não tinha caminho pela UI.
--
-- E, de tabela, as três telas (contas, régua de disparo, outbox) passam a viver
-- no menu de Comunicação. O select delas era `app_tem_modulo('antecipacao')`;
-- passa a aceitar também `comunicacao`. Não é alargamento real de exposição:
-- quem tem Comunicação já lê o ledger inteiro (`comunicacoes_select`), e a
-- outbox é um subconjunto do que vai virar ledger. O que muda é a fila deixar de
-- sumir para quem tem o módulo onde a tela agora está.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. As cinco colunas ganham select (coluna a coluna, jamais a tabela) ────
grant select (tipo, mensagens_por_dia, warmup_iniciado_em, intervalo_min_seg, intervalo_max_seg)
  on public.whatsapp_contas to authenticated;

-- ─── 2. As três telas seguem o módulo em que passaram a morar ───────────────
drop policy if exists whatsapp_contas_select on public.whatsapp_contas;
create policy whatsapp_contas_select on public.whatsapp_contas for select to authenticated
  using (
    (select public.app_tem_modulo('antecipacao'))
    or (select public.app_tem_modulo('comunicacao'))
  );

drop policy if exists mensagens_outbox_select on public.mensagens_outbox;
create policy mensagens_outbox_select on public.mensagens_outbox for select to authenticated
  using (
    (select public.app_tem_modulo('antecipacao'))
    or (select public.app_tem_modulo('comunicacao'))
  );

drop policy if exists faixa_disparos_select on public.faixa_disparos;
create policy faixa_disparos_select on public.faixa_disparos for select to authenticated
  using (
    (select public.app_tem_modulo('antecipacao'))
    or (select public.app_tem_modulo('comunicacao'))
  );

-- ─── 3. A escrita alcança a linha inteira ───────────────────────────────────
create or replace function app_salvar_whatsapp_conta(p jsonb)
returns whatsapp_contas language plpgsql security definer set search_path = '' as $$
declare
  v_conta public.whatsapp_contas;
  v_ator uuid := auth.uid();
  v_token text := nullif(p ->> 'token', '');
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_tipo text := nullif(p ->> 'tipo', '');
  v_teto int;
  v_min int;
  v_max int;
  v_secret uuid;
begin
  -- DEFINER porque escreve no schema `vault`, que `authenticated` não alcança —
  -- e é precisamente por isso que o token não pode voltar por PostgREST.
  if not public.app_is_admin() then
    raise exception 'Somente administradores gerenciam contas de WhatsApp.' using errcode = '42501';
  end if;

  -- A linha atual entra ANTES da validação porque um PATCH parcial precisa ser
  -- validado contra o que a linha vai ficar, não contra o que veio no corpo.
  -- Mandar só `intervalo_min_seg = 90` numa conta cujo máximo é 70 tem de falhar
  -- com uma frase, e não com o texto de um CHECK.
  if v_id is not null then
    select * into v_conta from public.whatsapp_contas where id = v_id for update;
    if v_conta.id is null then
      raise exception 'Conta de WhatsApp não encontrada.' using errcode = 'no_data_found';
    end if;
  end if;

  if v_tipo is not null and v_tipo not in ('relacionamento', 'ia', 'plantao') then
    raise exception 'Tipo de conta inválido: %. Use relacionamento, ia ou plantao.', v_tipo
      using errcode = '23514';
  end if;

  v_teto := coalesce(nullif(p ->> 'mensagens_por_dia', '')::int, v_conta.mensagens_por_dia, 200);
  v_min := coalesce(nullif(p ->> 'intervalo_min_seg', '')::int, v_conta.intervalo_min_seg, 25);
  v_max := coalesce(nullif(p ->> 'intervalo_max_seg', '')::int, v_conta.intervalo_max_seg, 70);

  if v_teto < 0 or v_teto > 2000 then
    raise exception 'Teto diário fora do intervalo permitido (0 a 2000).' using errcode = '23514';
  end if;
  if v_min < 0 or v_min > 3600 then
    raise exception 'Intervalo mínimo fora do permitido (0 a 3600 segundos).' using errcode = '23514';
  end if;
  if v_max < 0 or v_max > 7200 then
    raise exception 'Intervalo máximo fora do permitido (0 a 7200 segundos).' using errcode = '23514';
  end if;
  if v_min > v_max then
    raise exception 'O intervalo mínimo (%) não pode ser maior que o máximo (%).', v_min, v_max
      using errcode = '23514';
  end if;

  if v_id is null then
    insert into public.whatsapp_contas (
      apelido, numero, provedor, usuario_responsavel, ativo,
      tipo, mensagens_por_dia, warmup_iniciado_em, intervalo_min_seg, intervalo_max_seg
    )
    values (
      p ->> 'apelido',
      regexp_replace(coalesce(p ->> 'numero', ''), '\D', '', 'g'),
      coalesce(p ->> 'provedor', 'wasender'),
      nullif(p ->> 'usuario_responsavel', '')::uuid,
      coalesce((p ->> 'ativo')::boolean, true),
      coalesce(v_tipo, 'relacionamento'),
      v_teto,
      nullif(p ->> 'warmup_iniciado_em', '')::date,
      v_min,
      v_max
    )
    returning * into v_conta;
  else
    update public.whatsapp_contas set
      apelido = coalesce(p ->> 'apelido', apelido),
      numero = coalesce(regexp_replace(nullif(p ->> 'numero', ''), '\D', '', 'g'), numero),
      provedor = coalesce(p ->> 'provedor', provedor),
      usuario_responsavel = coalesce(nullif(p ->> 'usuario_responsavel', '')::uuid, usuario_responsavel),
      ativo = coalesce((p ->> 'ativo')::boolean, ativo),
      tipo = coalesce(v_tipo, tipo),
      mensagens_por_dia = v_teto,
      intervalo_min_seg = v_min,
      intervalo_max_seg = v_max,
      -- Presença da chave, não o valor: `warmup_iniciado_em: null` LIMPA o
      -- warmup (a conta volta ao teto cheio, decisão consciente de um admin) e
      -- a chave ausente preserva. Com `coalesce` cru não haveria como desligar.
      warmup_iniciado_em = case
        when p ? 'warmup_iniciado_em' then nullif(p ->> 'warmup_iniciado_em', '')::date
        else warmup_iniciado_em
      end
    where id = v_id
    returning * into v_conta;
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
  'Cria/atualiza uma conta de WhatsApp, inclusive tipo, teto diário, warmup e intervalo entre envios. O token vai para o Supabase Vault e o audit_log registra apenas QUE houve troca — nunca o valor.';
