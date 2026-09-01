-- ═════════════════════════════════════════════════════════════════════════════
-- 0152 — O segredo do webhook é POR NÚMERO, como o token de envio
--
-- O Wasender emite as credenciais por número: um access token e um webhook
-- secret para cada. O token de envio já era por conta (`token_secret_id`, no
-- Vault, desde a 0045); o segredo do webhook era UM SÓ, na variável de ambiente
-- `WASENDER_WEBHOOK_SECRET`.
--
-- Com dois números o desenho quebrava em silêncio: os webhooks do primeiro
-- passariam, os do segundo levariam 401 — e um 401 num webhook não aparece em
-- lugar nenhum da tela. As respostas daquele número simplesmente não chegariam.
--
-- ─── HASH, E NÃO VAULT ──────────────────────────────────────────────────────
-- O token de envio vai para o Vault porque precisamos LÊ-LO para enviar. O
-- segredo do webhook nunca é lido: ele só é COMPARADO com o que chegou. Guardar
-- o SHA-256 basta, e é estritamente mais seguro — não existe caminho que o
-- devolva, nem para o service role.
--
-- Também é mais barato: a validação vira uma consulta indexada por hash, em vez
-- de N leituras do Vault (uma por conta candidata) num caminho quente.
--
-- Um hash de valor é reversível por tabela arco-íris quando o segredo é fraco.
-- Este não é: quem o gera é o provedor, com entropia de credencial.
-- ═════════════════════════════════════════════════════════════════════════════

alter table public.whatsapp_contas
  add column webhook_secret_hash text,
  add column webhook_secret_definido_em timestamptz;

/* A busca da validação: um webhook chega, vira hash, e precisa achar a conta.
   Parcial porque a maioria das contas não tem segredo próprio. */
create index whatsapp_contas_webhook_hash_idx
  on public.whatsapp_contas (webhook_secret_hash)
  where webhook_secret_hash is not null;

/*
 * A DATA é legível; o HASH não.
 *
 * Mesma régua do `token_secret_id` (0052): a tela precisa dizer "definido em
 * {data}" e oferecer substituir, e não precisa de mais nada. E o grant vai
 * coluna a coluna porque foi assim que a 0052 fechou esta tabela — um
 * `grant select on table` reabriria o ponteiro do Vault junto.
 */
grant select (webhook_secret_definido_em) on public.whatsapp_contas to authenticated;

comment on column public.whatsapp_contas.webhook_secret_hash is
  'SHA-256 do segredo de webhook DESTE número, emitido pelo provedor. Nunca é lido — '
  'só comparado. Sem grant de select para authenticated.';

-- ─── Escrita: entra pela mesma RPC que já salva a conta ─────────────────────

create or replace function app_salvar_whatsapp_conta(p jsonb)
returns whatsapp_contas language plpgsql security definer set search_path = '' as $$
declare
  v_conta public.whatsapp_contas;
  v_ator uuid := auth.uid();
  v_token text := nullif(p ->> 'token', '');
  v_webhook text := nullif(p ->> 'webhook_secret', '');
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_tipo text := nullif(p ->> 'tipo', '');
  v_teto int;
  v_min int;
  v_max int;
  v_secret uuid;
begin
  if not public.app_is_admin() then
    raise exception 'Somente administradores gerenciam contas de WhatsApp.' using errcode = '42501';
  end if;

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

  /* O segredo do webhook vira HASH e o valor original é descartado aqui mesmo:
     nada no sistema precisa lê-lo de volta, só compará-lo. */
  if v_webhook is not null then
    update public.whatsapp_contas
      set webhook_secret_hash = encode(extensions.digest(v_webhook, 'sha256'), 'hex'),
          webhook_secret_definido_em = now()
      where id = v_conta.id
      returning * into v_conta;
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (
    v_ator, 'antecipacao.whatsapp_conta_salva', 'whatsapp_contas', v_conta.id::text,
    -- Nem o token nem o segredo do webhook entram no audit_log. Registra-se que
    -- houve troca, não o valor.
    (p - 'token' - 'webhook_secret') || jsonb_build_object(
      'token_alterado', v_token is not null,
      'webhook_secret_alterado', v_webhook is not null
    )
  );

  return v_conta;
end; $$;

comment on function app_salvar_whatsapp_conta(jsonb) is
  'Cria/atualiza uma conta de WhatsApp, inclusive tipo, teto, warmup, intervalo e o '
  'segredo de webhook DESTE número. O token vai para o Vault; o segredo do webhook vira '
  'hash — ele nunca é lido, só comparado.';

-- ─── Validação: qual conta emitiu este webhook ──────────────────────────────

/*
 * Recebe o segredo CRU e devolve a conta, ou null.
 *
 * O hash é feito aqui dentro para que o segredo não precise transitar pré-digerido
 * por quem chama — e para que exista um lugar só onde se decide qual algoritmo é.
 *
 * Devolve o NÚMERO junto: o webhook do provedor nem sempre diz de qual sessão veio,
 * e quando ele não diz, o segredo é a própria identificação.
 */
create or replace function public.app__conta_do_webhook(p_segredo text)
returns table (id uuid, numero text, apelido text)
language sql stable security definer set search_path = '' as $$
  select c.id, c.numero, c.apelido
  from public.whatsapp_contas c
  where c.ativo
    and c.webhook_secret_hash is not null
    and c.webhook_secret_hash = encode(extensions.digest(coalesce(p_segredo, ''), 'sha256'), 'hex')
  limit 1;
$$;

revoke all on function public.app__conta_do_webhook(text) from public, anon, authenticated;
grant execute on function public.app__conta_do_webhook(text) to service_role;

comment on function public.app__conta_do_webhook is
  'A conta cujo segredo de webhook casa com o recebido. Service role apenas: é a '
  'autenticação do webhook, e quem pode chamá-la pode testar segredos.';
