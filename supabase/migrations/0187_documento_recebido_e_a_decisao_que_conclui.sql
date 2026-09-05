-- ═════════════════════════════════════════════════════════════════════════════
-- 0187 — Documento recebido, a decisão que conclui, e o fim de "expirada"
--
-- Três mudanças na esteira de crédito, e as três nascem do mesmo desconforto:
-- a coluna em que a análise está precisava dizer o que está acontecendo com ela.
--
-- ── 1. `docs_recebidos` ────────────────────────────────────────────────────
-- Entre "faltam documentos" e "enviada à seguradora" existia um vazio: a pasta
-- ficou completa, e a análise voltava para `solicitada` — que é a coluna ANTES
-- de `docs_pendentes` no kanban. Quem olhava via o card andar para trás, e não
-- havia onde parar para conferir o que chegou antes de gastar a consulta paga.
--
-- O gatilho da 0160 passa a mirar `docs_recebidos` pelo mesmo motivo: o fato que
-- ele observa é "o último essencial chegou", e o nome disso é documento
-- recebido, não pedido registrado.
--
-- ── 2. `app_concluir_analise` ──────────────────────────────────────────────
-- Até aqui, SÓ o worker escrevia aprovada/negada — a regra existia para impedir
-- que a tela inventasse um limite que a apólice não conhece. Ela continua
-- valendo para o limite: este RPC NÃO toca `limite_aprovado`, que é o número da
-- seguradora. O que ele escreve é o DESFECHO de uma decisão nossa, já registrada
-- em `decisao_interna` pelo confronto (0122) — e por isso exige que ela exista e
-- concorde com o estágio pedido. Sem isso, "aprovada" viraria um clique solto.
--
-- Existe porque metade das análises não vai à seguradora: `operar_sem_cobertura`
-- é uma decisão completa que morria em `docs_recebidos` para sempre, e uma
-- análise decidida presa numa coluna aberta bloqueia a próxima do mesmo CNPJ.
--
-- ── 3. `expirada` sai do vocabulário ───────────────────────────────────────
-- Nenhuma linha usava (conferido no banco vivo antes de mexer no CHECK). Ela era
-- uma COLUNA para um fato que já estava em `expira_em`: uma data no passado diz
-- "venceu" sem precisar de um estágio que apaga o desfecho original — depois de
-- expirar, ninguém mais sabia se aquilo tinha sido aprovado ou aprovado parcial.
--
-- O fato continua: `expirada_em` marca quando a rotina reparou no vencimento, e
-- é ela que torna a rotina idempotente agora que ela não muda mais o estágio.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── 1. O vocabulário ───────────────────────────────────────────────────────

alter table public.analises_credito
  drop constraint if exists analises_credito_estagio_check;

alter table public.analises_credito
  add constraint analises_credito_estagio_check check (estagio in (
    'rascunho', 'solicitada', 'docs_pendentes', 'docs_recebidos',
    'enviada_seguradora', 'em_analise',
    'aprovada', 'aprovada_parcial', 'negada', 'cancelada'
  ));

-- Quando a rotina de expiração reparou que a validade passou. Não é estágio: a
-- análise segue `aprovada` (com `expira_em` no passado, que é o que diz que ela
-- não vale mais). Serve para a rotina não reemitir o mesmo evento todo dia.
alter table public.analises_credito
  add column if not exists expirada_em timestamptz;

comment on column public.analises_credito.expirada_em is
  'Quando a rotina diária reparou que `expira_em` passou. Marcador de idempotência: '
  'o vencimento não muda o estágio, para não apagar o desfecho original.';

-- ─── 2. O que chegou à seguradora ───────────────────────────────────────────
-- Por documento, e não por análise: o analista escolhe quais anexos vão, e sem
-- registro por linha "enviei os documentos" não responde QUAIS.

alter table public.analise_docs
  add column if not exists enviado_seguradora_em timestamptz,
  add column if not exists envio_seguradora_erro text;

comment on column public.analise_docs.enviado_seguradora_em is
  'Quando ESTE documento foi aceito pela API da seguradora. Nulo = não foi escolhido, '
  'ou a tentativa falhou (o motivo fica em `envio_seguradora_erro`).';

-- ─── 3. Mover à mão: `docs_recebidos` entra, `expirada` sai ─────────────────

create or replace function public.app_mover_analise(p jsonb)
returns public.analises_credito language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_linha public.analises_credito;
  v_novo text := p ->> 'estagio';
begin
  if not public.app_tem_modulo('credito') then
    raise exception 'Sem acesso ao módulo Crédito.' using errcode = '42501';
  end if;
  -- `docs_recebidos` é manual DE PROPÓSITO: é a conferência humana da pasta,
  -- entre o que faltava e a consulta paga à seguradora.
  if v_novo not in ('rascunho', 'solicitada', 'docs_pendentes', 'docs_recebidos', 'cancelada') then
    raise exception 'Estágio % não pode ser definido à mão.', v_novo using errcode = '22023';
  end if;

  select * into v_linha from public.analises_credito where id = (p ->> 'id')::uuid;
  if v_linha.id is null then
    raise exception 'Análise não encontrada.' using errcode = 'no_data_found';
  end if;
  if v_linha.estagio in ('aprovada', 'aprovada_parcial', 'negada') then
    raise exception 'Análise já decidida não volta para a esteira.' using errcode = '22023';
  end if;

  update public.analises_credito set
    estagio = v_novo,
    limite_solicitado = coalesce(nullif(p ->> 'limite_solicitado', '')::numeric, limite_solicitado),
    observacoes = coalesce(nullif(p ->> 'observacoes', ''), observacoes),
    atualizada_em = now()
  where id = v_linha.id
  returning * into v_linha;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (
    v_linha.empresa_id, 'analise.movida',
    jsonb_build_object(
      'titulo', 'Análise de crédito movida',
      'resumo', 'Estágio: ' || v_novo || '.',
      'url', '/credito/analises/' || v_linha.id,
      'analise_id', v_linha.id, 'estagio', v_novo
    ),
    v_ator
  );

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'analise.movida', 'analises_credito', v_linha.id::text, p);

  return v_linha;
end; $$;

-- ─── 4. O checklist completo agora para em "documentos recebidos" ──────────

create or replace function public.analise_docs__completar_checklist() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_essenciais text[];
  v_recebidos text[];
begin
  select coalesce(array_agg(t ->> 'id'), '{}')
    into v_essenciais
    from public.credito_config c,
         lateral jsonb_array_elements(c.valor -> 'tipos') t
   where c.chave = 'docs' and (t ->> 'essencial')::boolean;

  if v_essenciais = '{}' then return null; end if;

  select coalesce(array_agg(distinct d.tipo), '{}')
    into v_recebidos
    from public.analise_docs d
   where d.analise_id = new.analise_id;

  -- Sobe para `docs_recebidos`, e não mais para `solicitada`: o fato observado é
  -- "chegou o último essencial". Continua agindo só na SUBIDA e só a partir de
  -- `docs_pendentes` — certidão atrasada não rebobina uma análise já enviada.
  update public.analises_credito
     set estagio = 'docs_recebidos'
   where id = new.analise_id
     and estagio = 'docs_pendentes'
     and v_essenciais <@ v_recebidos;

  return null;
end $$;

-- ─── 5. Concluir a análise pela decisão registrada ─────────────────────────

create or replace function public.app_concluir_analise(p jsonb)
returns public.analises_credito language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_linha public.analises_credito;
  v_novo text := p ->> 'estagio';
  v_motivo text := nullif(btrim(coalesce(p ->> 'motivo', '')), '');
  v_evento text;
begin
  if not public.app_tem_modulo('credito') then
    raise exception 'Somente o perfil Crédito conclui uma análise.' using errcode = '42501';
  end if;
  if v_novo not in ('aprovada', 'aprovada_parcial', 'negada') then
    raise exception 'Desfecho % não existe.', v_novo using errcode = '22023';
  end if;

  select * into v_linha from public.analises_credito where id = (p ->> 'id')::uuid for update;
  if v_linha.id is null then
    raise exception 'Análise não encontrada.' using errcode = 'no_data_found';
  end if;

  -- Antes de `docs_recebidos` não há o que concluir: a pasta ainda não foi
  -- conferida, e um desfecho aqui seria uma decisão sobre nada.
  if v_linha.estagio not in ('docs_recebidos', 'enviada_seguradora', 'em_analise') then
    raise exception 'Uma análise em "%" não pode ser concluída.', v_linha.estagio
      using errcode = '22023';
  end if;

  -- O desfecho é a CONSEQUÊNCIA da decisão registrada no confronto, nunca uma
  -- escolha paralela. Sem `decisao_interna` não há o que consequenciar.
  if v_linha.decisao_interna is null then
    raise exception 'Registre a decisão antes de concluir a análise.' using errcode = '23514';
  end if;
  if (v_linha.decisao_interna = 'nao_operar') <> (v_novo = 'negada') then
    raise exception 'O desfecho % não corresponde à decisão registrada (%).',
      v_novo, v_linha.decisao_interna using errcode = '23514';
  end if;

  -- `limite_aprovado` NÃO é tocado: ele é o número da seguradora, e escrevê-lo
  -- daqui produziria uma cobertura que a apólice não conhece. O nosso número já
  -- está em `limite_operacional`, gravado pelo registro da decisão.
  update public.analises_credito set
    estagio = v_novo,
    decidida_em = coalesce(decidida_em, now()),
    motivo = coalesce(v_motivo, motivo),
    atualizada_em = now()
  where id = v_linha.id
  returning * into v_linha;

  v_evento := case v_novo
    when 'aprovada' then 'analise.aprovada'
    when 'aprovada_parcial' then 'analise.aprovada_parcial'
    else 'analise.negada'
  end;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (
    v_linha.empresa_id, v_evento,
    jsonb_build_object(
      'titulo', 'Análise de crédito concluída por decisão nossa',
      'resumo', coalesce(v_motivo, 'Decisão: ' || v_linha.decisao_interna || '.'),
      'url', '/credito/analises/' || v_linha.id,
      'analise_id', v_linha.id,
      'cnpj', v_linha.cnpj,
      'estagio', v_novo,
      'decisao_interna', v_linha.decisao_interna,
      'limite_operacional', v_linha.limite_operacional,
      'origem', 'decisao_interna'
    ),
    v_ator
  );

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'analise.concluida', 'analises_credito', v_linha.id::text, p);

  return v_linha;
end; $$;

comment on function public.app_concluir_analise(jsonb) is
  'Conclui a esteira a partir da decisão JÁ registrada no confronto. Não escreve '
  '`limite_aprovado` — esse número é da seguradora.';

grant execute on function public.app_concluir_analise(jsonb) to authenticated;
