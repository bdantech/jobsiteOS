-- ─────────────────────────────────────────────────────────────────────────────
-- 0260 — O closer põe no funil de vendas, e o pedido de crédito não espera
--
-- ─── 1. UMA PORTA MANUAL PARA O FUNIL DE VENDAS ─────────────────────────────
-- Até aqui a única coisa que criava uma venda era o SDR agendando reunião
-- (`app_mover_lead_sdr`). Empresa que chegava ao closer por outro caminho — um
-- contato que ele mesmo tem, uma indicação — não tinha como entrar no funil dele
-- sem fingir uma passagem pelo SDR.
--
-- `app_criar_venda` é o espelho da 0146 (`app_criar_lead_sdr`) do lado de vendas:
--   quem ........ closer (`tipo = 'vendedor'`) põe no PRÓPRIO funil; admin escolhe
--                 o closer. O perfil "Comercial" é gestor em outras telas, mas o
--                 pedido foi closer ou admin, e é isso que está aqui.
--   onde ........ `reuniao_agendada`, o primeiro estágio — sem reunião marcada
--                 ainda; é o closer quem a marca.
--   quem barra .. cliente e ex-cliente (mesma razão da 0146), e venda VIVA — a
--                 definição de `vendaNoFunil` no core (`situacao <> 'perdido'` e
--                 sem primeira operação), não a de `estagio`, que a 0094 aposentou.
-- O lead do SDR, se houver, não é tocado: ele segue sendo do SDR, e esta venda
-- não herda `sdr_lead_id` — ela não veio de reunião agendada por ele.
--
-- ─── 2. ADMIN, CLOSER E ORIGINADOR PEDEM ANÁLISE A QUALQUER HORA ────────────
-- `app__abrir_analise_credito` recusava o pedido quando o CNPJ já tinha análise
-- em andamento. Para quem vende, isso travava a conversa: a análise aberta podia
-- estar parada há semanas em docs pendentes, pedida por outra pessoa, com outro
-- limite. A 0208 já trata várias análises abertas por empresa — "enquanto não há
-- decisão, uma empresa pode ter quantas análises forem precisas" —, então o que
-- sai é só a recusa, e só para esses três papéis. Os outros caminhos
-- (prospecção, perfis sem papel comercial) seguem com a regra antiga.
--
-- A decisão de "quem pode sempre" mora em `app_pode_pedir_analise_sempre()`,
-- que a tela também lê: uma régua só para o botão e para o banco.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1 ───────────────────────────────────────────────────────────────────────

create or replace function public.app_criar_venda(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_ator uuid := auth.uid();
  v_empresa public.empresas;
  v_admin boolean := public.app_is_admin();
  v_eu uuid := public.app_vendedor_atual();
  v_destino uuid := nullif(p ->> 'vendedor_id', '')::uuid;
  v_closer public.vendedores;
  v_viva uuid;
  v_venda uuid;
begin
  if not public.app_tem_modulo('comercial') then
    raise exception 'Sem acesso ao módulo Comercial.' using errcode = '42501';
  end if;

  if not v_admin and coalesce(public.app_vendedor_tipo(), '') <> 'vendedor' then
    raise exception 'Só closer ou admin põe empresa direto no funil de vendas.'
      using errcode = '42501';
  end if;

  select * into v_empresa from public.empresas where id = nullif(p ->> 'empresa_id', '')::uuid;
  if v_empresa.id is null then
    raise exception 'Empresa não encontrada.' using errcode = 'P0002';
  end if;

  if v_empresa.estagio in ('cliente', 'ex_cliente') then
    raise exception
      'Esta empresa é % da OnePay e não entra no funil de vendas.',
      case v_empresa.estagio when 'cliente' then 'cliente' else 'ex-cliente' end
      using errcode = '23514';
  end if;

  select id into v_viva from public.vendas
  where empresa_id = v_empresa.id and situacao <> 'perdido' and primeira_operacao_em is null
  order by criada_em desc limit 1;
  if v_viva is not null then
    raise exception 'Esta empresa já tem uma venda viva no funil de vendas.'
      using errcode = '23505', detail = v_viva::text;
  end if;

  -- Closer só põe no próprio funil; admin escolhe.
  v_destino := coalesce(v_destino, v_eu);
  if v_destino is null then
    raise exception 'Escolha o closer que vai trabalhar esta empresa.' using errcode = '23502';
  end if;
  if not v_admin and v_destino <> coalesce(v_eu, '00000000-0000-0000-0000-000000000000'::uuid) then
    raise exception 'Só o admin põe empresa no funil de outro closer.' using errcode = '42501';
  end if;

  select * into v_closer from public.vendedores where id = v_destino and ativo;
  if v_closer.id is null then
    raise exception 'Closer inativo ou inexistente.' using errcode = '23503';
  end if;
  if v_closer.tipo <> 'vendedor' then
    raise exception '% não é closer — o funil de vendas é dele.', v_closer.nome
      using errcode = '23514';
  end if;

  insert into public.vendas (empresa_id, vendedor_id, estagio)
  values (v_empresa.id, v_closer.id, 'reuniao_agendada')
  returning id into v_venda;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_empresa.id, 'venda.criada', jsonb_build_object(
    'titulo', 'No funil de vendas de ' || v_closer.nome,
    'resumo', coalesce(v_empresa.razao_social, v_empresa.cnpj)
              || ' entrou direto no funil de vendas, sem passar pelo SDR.',
    'url', '/comercial/vendas',
    'venda_id', v_venda, 'para', v_closer.id, 'origem', 'manual'
  ), v_ator);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'comercial.venda_criada_manual', 'vendas', v_venda::text,
    jsonb_build_object('empresa_id', v_empresa.id, 'vendedor_id', v_closer.id));

  return jsonb_build_object(
    'venda_id', v_venda,
    'vendedor_id', v_closer.id,
    'vendedor_nome', v_closer.nome
  );
end;
$$;

revoke all on function public.app_criar_venda(jsonb) from public, anon;
grant execute on function public.app_criar_venda(jsonb) to authenticated;

-- ── 2 ───────────────────────────────────────────────────────────────────────

create or replace function public.app_pode_pedir_analise_sempre()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select public.app_is_admin()
      or coalesce(public.app_vendedor_tipo(), '') in ('vendedor', 'originador')
$$;

revoke all on function public.app_pode_pedir_analise_sempre() from public, anon;
grant execute on function public.app_pode_pedir_analise_sempre() to authenticated;

-- Parâmetro novo com default: as chamadas de 5 argumentos (prospecção) seguem
-- iguais. Sem o `drop`, a versão antiga e a nova seriam ambíguas para elas.
drop function public.app__abrir_analise_credito(uuid, numeric, text, text, uuid);

create function public.app__abrir_analise_credito(
  p_empresa_id uuid,
  p_limite numeric,
  p_observacoes text,
  p_origem_motivo text,
  p_ator uuid,
  p_mesmo_com_aberta boolean default false
)
returns public.analises_credito
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_empresa public.empresas;
  v_linha public.analises_credito;
begin
  select * into v_empresa from public.empresas where id = p_empresa_id;
  if v_empresa.id is null then
    raise exception 'Empresa não encontrada.' using errcode = 'no_data_found';
  end if;

  if v_empresa.tipo not in ('construtora', 'incorporadora') then
    raise exception 'Análise de crédito é para sacados (construtora/incorporadora).'
      using errcode = '22023';
  end if;

  if not p_mesmo_com_aberta and exists (
    select 1 from public.analises_credito a
    where a.cnpj = v_empresa.cnpj
      and a.estagio in ('rascunho', 'solicitada', 'docs_pendentes', 'docs_recebidos',
                        'enviada_seguradora', 'em_analise')
  ) then
    raise exception 'Já existe uma análise em andamento para este CNPJ.' using errcode = '23505';
  end if;

  insert into public.analises_credito (
    empresa_id, cnpj, estagio, limite_solicitado, observacoes, solicitada_por, origem_motivo
  )
  values (
    v_empresa.id, v_empresa.cnpj, 'solicitada',
    coalesce(p_limite, public.app_arredondar_limite_sugerido(v_empresa.limite_potencial)),
    nullif(p_observacoes, ''), p_ator, nullif(p_origem_motivo, '')
  )
  returning * into v_linha;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (
    v_empresa.id, 'analise.solicitada',
    jsonb_build_object(
      'titulo', 'Análise de crédito solicitada',
      'resumo', 'Limite solicitado: R$ ' ||
                to_char(coalesce(v_linha.limite_solicitado, 0), 'FM999G999G999G990D00') || '.',
      'url', '/credito/analises/' || v_linha.id,
      'analise_id', v_linha.id,
      'origem_motivo', v_linha.origem_motivo
    ),
    p_ator
  );

  return v_linha;
end $function$;

revoke all on function public.app__abrir_analise_credito(uuid, numeric, text, text, uuid, boolean)
  from public, anon, authenticated;

create or replace function public.app_solicitar_analise(p jsonb)
returns public.analises_credito
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_ator uuid := auth.uid();
  v_linha public.analises_credito;
begin
  if not (public.app_tem_modulo('credito') or public.app_tem_modulo('empresas')) then
    raise exception 'Sem acesso para solicitar análise de crédito.' using errcode = '42501';
  end if;

  v_linha := public.app__abrir_analise_credito(
    (p ->> 'empresa_id')::uuid,
    nullif(p ->> 'limite_solicitado', '')::numeric,
    p ->> 'observacoes',
    null,
    v_ator,
    public.app_pode_pedir_analise_sempre()
  );

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'analise.solicitada', 'analises_credito', v_linha.id::text, p);

  return v_linha;
end $function$;
