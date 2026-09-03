-- ============================================================================
-- 0169 — A atividade precisa saber DE QUEM é a mensagem
--
-- O painel de atividade lê `comunicacoes.vendedor_id`, e essa coluna estava
-- preenchida em 12 das 426 linhas do ledger. As 140 mensagens que a equipe
-- mandou pelo próprio celular e as 273 que chegaram dos clientes estavam todas
-- sem dono — de modo que qualquer gráfico de atividade mostraria uma equipe que
-- quase não trabalha, enquanto o WhatsApp dela não para.
--
-- A causa é que `resolverRemetente` só sabe atribuir pela CARTEIRA: ele acha a
-- empresa pelo contato e devolve o dono dela. Quando ninguém identificou o
-- contato ainda — que é o estado normal de uma conversa nova — não há empresa,
-- logo não há dono, e a mensagem fica órfã.
--
-- Mas há outra fonte, e ela é mais direta: o NÚMERO por onde a mensagem passou.
-- As contas de WhatsApp são celulares de pessoas (`usuario_responsavel`), e é o
-- mesmo argumento da 0164 para a posse da conversa — quem atendeu o número é
-- quem falou. Esta migração aplica isso ao que já está gravado; o worker passa a
-- aplicá-lo na ingestão.
--
-- E `app_conversa_vincular` passa a carimbar o dono junto com a empresa: ele já
-- reescrevia `empresa_id` e `contato_id` da conversa inteira ao identificar, e
-- deixar `vendedor_id` de fora fazia a identificação corrigir a timeline sem
-- corrigir o painel.
-- ============================================================================

-- ─── O que já está gravado ──────────────────────────────────────────────────
-- Só onde está nulo: uma linha que já tem dono foi atribuída por quem sabia mais
-- (o compositor sabe quem apertou enviar), e sobrescrever isso seria trocar um
-- fato por uma inferência.
update public.comunicacoes c
set vendedor_id = v.id
from public.whatsapp_contas w
join public.vendedores v on v.usuario_id = w.usuario_responsavel
where c.vendedor_id is null
  and c.conta_remetente = w.numero
  and w.usuario_responsavel is not null;

-- As conversas já identificadas carimbam o dono nas mensagens que vieram antes.
update public.comunicacoes c
set vendedor_id = cv.responsavel_vendedor_id
from public.conversas cv
where c.conversa_id = cv.id
  and c.vendedor_id is null
  and cv.responsavel_vendedor_id is not null;

-- ─── Identificar passa a carimbar o dono também ─────────────────────────────
create or replace function public.app_conversa_vincular(p jsonb)
returns public.conversas language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_nv public.conversas_nao_vinculadas;
  v_empresa public.empresas;
  v_contato public.contatos;
  v_conversa public.conversas;
  v_base text;
  v_vendedor uuid;
begin
  if not public.app_tem_modulo('comunicacao') then
    raise exception 'Sem acesso ao módulo Comunicação.' using errcode = '42501';
  end if;

  select * into v_nv from public.conversas_nao_vinculadas where id = (p ->> 'id')::uuid;
  if v_nv.id is null then
    raise exception 'Conversa não encontrada na fila.' using errcode = 'no_data_found';
  end if;
  if v_nv.status <> 'pendente' then
    raise exception 'Esta conversa já foi resolvida.' using errcode = '23505';
  end if;

  select * into v_empresa from public.empresas where id = (p ->> 'empresa_id')::uuid;
  if v_empresa.id is null then
    raise exception 'Empresa não encontrada.' using errcode = 'no_data_found';
  end if;
  if nullif(p ->> 'nome', '') is null then
    raise exception 'Informe o nome do contato.' using errcode = '23514';
  end if;

  v_base := case when v_empresa.estagio in ('cliente', 'ex_cliente') then 'relacao_comercial'
                 else 'manual' end;

  insert into public.contatos (
    empresa_id, nome, cargo, email, telefone, whatsapp, origem,
    base_legal, base_legal_em, base_legal_detalhe
  ) values (
    v_empresa.id, p ->> 'nome', nullif(p ->> 'cargo', ''),
    case when v_nv.canal = 'email'    then v_nv.identificador_externo end,
    case when v_nv.canal = 'whatsapp' then v_nv.identificador_externo end,
    case when v_nv.canal = 'whatsapp' then v_nv.identificador_externo end,
    'vinculado_inbox', v_base, now(),
    'Vinculado no inbox a partir de ' || v_nv.canal || ' ' || v_nv.identificador_externo
  ) returning * into v_contato;

  select vc.vendedor_id into v_vendedor
    from public.vendedor_carteira vc
    where vc.empresa_id = v_empresa.id and vc.ate is null
    order by case vc.papel when 'originacao' then 1 when 'sdr' then 2 else 3 end
    limit 1;

  insert into public.conversas as cv (canal, identificador_externo, empresa_id, contato_id, responsavel_vendedor_id)
  values (v_nv.canal, v_nv.identificador_externo, v_empresa.id, v_contato.id,
          coalesce(v_vendedor, v_nv.vendedor_sugerido_id))
  on conflict (canal, identificador_externo) do update set
    empresa_id = excluded.empresa_id,
    contato_id = excluded.contato_id,
    responsavel_vendedor_id = coalesce(cv.responsavel_vendedor_id, excluded.responsavel_vendedor_id)
  returning cv.* into v_conversa;

  /*
   * `vendedor_id` entra com COALESCE, ao contrário de empresa e contato.
   *
   * Empresa e contato são sobre QUEM ESTÁ DO OUTRO LADO, e identificar a conversa
   * é justamente descobrir isso — reescrever é o objetivo. `vendedor_id` é sobre
   * QUEM DAQUI FALOU, e isso já aconteceu: a mensagem que saiu do celular do
   * Rodrigo continua sendo do Rodrigo mesmo que a empresa seja da carteira do
   * Fabio. Sobrescrever aqui reescreveria o passado de quem trabalhou.
   */
  update public.comunicacoes
    set empresa_id = v_empresa.id,
        contato_id = v_contato.id,
        vendedor_id = coalesce(vendedor_id, v_conversa.responsavel_vendedor_id)
    where conversa_id = v_conversa.id;

  update public.conversas_nao_vinculadas
    set status = 'vinculada', vinculada_contato_id = v_contato.id,
        resolvida_por = v_ator, resolvida_em = now()
    where id = v_nv.id;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_empresa.id, 'conversa.vinculada',
    jsonb_build_object(
      'titulo', 'Conversa identificada',
      'resumo', coalesce(p ->> 'nome', 'Contato') || ' (' || v_nv.canal || ') vinculado a '
                || coalesce(v_empresa.razao_social, v_empresa.nome_fantasia, v_empresa.cnpj) || '.',
      'url', '/comunicacao/' || v_conversa.id,
      'conversa_id', v_conversa.id,
      'contato_id', v_contato.id,
      'base_legal', v_base),
    v_ator);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'comunicacao.conversa_vinculada', 'conversas', v_conversa.id::text, p);

  return v_conversa;
end $$;

-- ─── As duas séries do painel ───────────────────────────────────────────────
/*
 * A tabela do painel responde "quanto cada um fez no período". As duas perguntas
 * que faltavam são de FORMA, não de volume:
 *
 *   por_dia  — quantas empresas cada pessoa toca por dia, e como isso oscila.
 *              Empresas DISTINTAS, e não mensagens: vinte mensagens para o mesmo
 *              fornecedor são uma conversa, não vinte toques, e contar mensagem
 *              aqui premiaria justamente quem insiste no mesmo lugar.
 *
 *   por_hora — em que horas do dia o trabalho acontece. É o mapa de calor, e ele
 *              existe para uma pergunta operacional: se ninguém fala com o
 *              mercado às 9h, a régua de janela ou a rotina do time está errada.
 *
 * A REGRA DE ACESSO É A MESMA de `app_comunicacao_atividade`, copiada e não
 * generalizada: gestor vê a equipe, quem tem `vendedor_acessos` vê quem lhe
 * deram, e ninguém se vê. Uma função "genérica de atividade" com um parâmetro
 * de modo seria o lugar onde essa regra um dia deixaria de valer para um dos
 * dois chamadores sem que ninguém notasse.
 *
 * O canal aceita whatsapp | email | ligacao | reuniao — o pedido é explícito em
 * valer "para qualquer tipo de comunicação". `interno` fica fora, sempre: alerta
 * de plantão não é trabalho comercial de ninguém.
 */
create or replace function public.app_comunicacao_atividade_series(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_eu uuid := public.app_vendedor_atual();
  v_gestor boolean := public.app_gestor_comercial();
  v_de date := coalesce(nullif(p ->> 'de', '')::date, current_date - 29);
  v_ate date := coalesce(nullif(p ->> 'ate', '')::date, current_date);
  v_canal text := nullif(p ->> 'canal', '');
  v_direcao text := nullif(p ->> 'direcao', '');
  v_visiveis uuid[];
  v_dia jsonb;
  v_hora jsonb;
begin
  if not public.app_tem_modulo('comunicacao') then
    raise exception 'Sem acesso ao módulo Comunicação.' using errcode = '42501';
  end if;

  if v_gestor then
    select coalesce(array_agg(id), '{}') into v_visiveis from public.vendedores where ativo;
  else
    select coalesce(array_agg(a.pode_ver_vendedor_id), '{}') into v_visiveis
      from public.vendedor_acessos a where a.vendedor_id = v_eu;
  end if;

  if v_eu is not null then
    v_visiveis := array_remove(v_visiveis, v_eu);
  end if;

  if coalesce(array_length(v_visiveis, 1), 0) = 0 then
    return jsonb_build_object('tem_acesso', false, 'por_dia', '[]'::jsonb, 'por_hora', '[]'::jsonb);
  end if;

  with base as (
    select
      c.vendedor_id,
      v.nome as vendedor_nome,
      v.is_ia,
      (c.criado_em at time zone 'America/Sao_Paulo')::date as dia,
      extract(hour from c.criado_em at time zone 'America/Sao_Paulo')::int as hora,
      c.empresa_id,
      c.conversa_id
    from public.comunicacoes c
    join public.vendedores v on v.id = c.vendedor_id
    where c.vendedor_id = any (v_visiveis)
      and c.canal <> 'interno'
      and (v_canal is null or c.canal = v_canal)
      and (v_direcao is null or c.direcao = v_direcao)
      and (c.criado_em at time zone 'America/Sao_Paulo')::date between v_de and v_ate
  )
  select
    coalesce((
      select jsonb_agg(x order by x ->> 'dia', x ->> 'vendedor_nome')
      from (
        select jsonb_build_object(
          'dia', dia,
          'vendedor_id', vendedor_id,
          'vendedor_nome', vendedor_nome,
          'is_ia', is_ia,
          -- Empresa é o alvo, mas a conversa não identificada também é trabalho:
          -- sem o fallback, o dia inteiro de quem fala com quem ainda não foi
          -- vinculado apareceria como zero — e é exatamente esse dia que o
          -- gestor quer ver.
          'empresas', count(distinct coalesce(empresa_id::text, 'conversa:' || conversa_id::text)),
          'mensagens', count(*)
        ) as x
        from base
        group by dia, vendedor_id, vendedor_nome, is_ia
      ) d
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(y order by y ->> 'vendedor_nome', (y ->> 'hora')::int)
      from (
        select jsonb_build_object(
          'vendedor_id', vendedor_id,
          'vendedor_nome', vendedor_nome,
          'is_ia', is_ia,
          'hora', hora,
          'total', count(*)
        ) as y
        from base
        group by vendedor_id, vendedor_nome, is_ia, hora
      ) h
    ), '[]'::jsonb)
  into v_dia, v_hora;

  return jsonb_build_object(
    'tem_acesso', true, 'de', v_de, 'ate', v_ate,
    'por_dia', v_dia, 'por_hora', v_hora
  );
end $$;

comment on function public.app_comunicacao_atividade_series(jsonb) is
  'As duas séries do painel de atividade: empresas tocadas por dia e mensagens '
  'por hora do dia, por vendedor. Mesma régua de acesso do painel — ninguém vê '
  'a si mesmo. Horários em America/Sao_Paulo.';

grant execute on function public.app_comunicacao_atividade_series(jsonb) to authenticated, service_role;
