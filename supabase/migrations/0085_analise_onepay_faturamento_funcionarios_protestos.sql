-- ─────────────────────────────────────────────────────────────────────────────
-- A aba Análise ganha quatro recortes: faturamento, funcionários e dois de protesto
--
-- Os três primeiros seguem o padrão dos que já existem — um agregado por faixa, com
-- clique abrindo a lista de clientes. Os de protesto são de outra natureza e por isso
-- vêm prontos como RANKING, não como faixa: a pergunta ali não é "como se distribuem"
-- e sim "quais são os piores", e faixa não responde isso.
--
-- ─── PROTESTO É DO GRUPO, NÃO DO CNPJ ───────────────────────────────────────
-- Um cliente que opera por SPEs tem o protesto na SPE, não na matriz. Somar só o
-- CNPJ do cliente mostraria zero justamente em quem tem risco espalhado — e a
-- rotina mensal de protestos já consulta matriz + SPEs por esse motivo. Cliente sem
-- grupo é um grupo de um.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.radar_onepay_analytics()
returns jsonb language plpgsql stable security definer set search_path to '' as $function$
declare v jsonb;
begin
  if not public.app_tem_modulo('radar') then
    return jsonb_build_object('tem_acesso', false);
  end if;

  with base as (
    select c.cnpj, c.nome, c.empresa_id,
           u.uf, u.camada, u.capital_social, u.grupo_id,
           e.faturamento_anual, e.funcionarios
    from public.clientes_onepay c
    left join public.mercado_universo u on u.cnpj = c.cnpj
    left join public.empresas e on e.cnpj = c.cnpj
  ),
  regiao as (
    select case
      when uf in ('AC','AP','AM','PA','RO','RR','TO') then 'norte'
      when uf in ('AL','BA','CE','MA','PB','PE','PI','RN','SE') then 'nordeste'
      when uf in ('DF','GO','MT','MS') then 'centro_oeste'
      when uf in ('ES','MG','RJ','SP') then 'sudeste'
      when uf in ('PR','RS','SC') then 'sul'
      else 'sem_uf' end as regiao,
      count(*)::int as n
    from base group by 1
  ),
  cam as (
    select camada, count(*)::int as n from base where camada is not null group by 1
  ),
  cap as (
    select case
      when capital_social is null then 'sem_dado'
      when capital_social < 500000 then 'f1'
      when capital_social < 2000000 then 'f2'
      when capital_social < 5000000 then 'f3'
      when capital_social < 10000000 then 'f4'
      when capital_social < 20000000 then 'f5'
      when capital_social < 50000000 then 'f6'
      when capital_social < 100000000 then 'f7'
      else 'f8' end as faixa,
      count(*)::int as n
    from base group by 1
  ),
  -- Faixas de faturamento: os cortes acompanham o que separa cliente pequeno de
  -- médio no funil, e o teto do Simples (4,8 mi) é um deles de propósito.
  fat as (
    select case
      when faturamento_anual is null then 'sem_dado'
      when faturamento_anual < 4800000 then 'f1'
      when faturamento_anual < 20000000 then 'f2'
      when faturamento_anual < 50000000 then 'f3'
      when faturamento_anual < 100000000 then 'f4'
      when faturamento_anual < 300000000 then 'f5'
      else 'f6' end as faixa,
      count(*)::int as n
    from base group by 1
  ),
  func as (
    select case
      when funcionarios is null or funcionarios = 0 then 'sem_dado'
      when funcionarios < 10 then 'f1'
      when funcionarios < 50 then 'f2'
      when funcionarios < 100 then 'f3'
      when funcionarios < 250 then 'f4'
      else 'f5' end as faixa,
      count(*)::int as n
    from base group by 1
  ),
  -- Protesto de cada CNPJ com o detalhe achatado: estado → cartório → título.
  -- SP devolve `protesto[]`, o Nacional devolve `titulos[]`; os dois têm dataProtesto
  -- e valorProtestado. Cartório sem detalhe simplesmente não rende linha aqui — o
  -- total dele continua valendo no valor_total do snapshot.
  titulos as (
    select pa.cnpj,
      case when t->>'dataProtesto' ~ '^\d{2}/\d{2}/\d{4}$'
           then to_date(t->>'dataProtesto', 'DD/MM/YYYY') end as data,
      coalesce(
        nullif(replace(regexp_replace(coalesce(t->>'valorProtestado',''), '[^0-9,]', '', 'g'), ',', '.'), '')::numeric,
        0
      ) as valor
    from public.protestos_atual pa,
      lateral jsonb_array_elements(
        case when jsonb_typeof(pa.cartorios) = 'array' then pa.cartorios else '[]'::jsonb end) uf,
      lateral jsonb_array_elements(
        case when jsonb_typeof(uf->'cartorios') = 'array' then uf->'cartorios' else '[]'::jsonb end) c,
      lateral jsonb_array_elements(
        case when jsonb_typeof(coalesce(c->'protesto', c->'titulos')) = 'array'
             then coalesce(c->'protesto', c->'titulos') else '[]'::jsonb end) t
    where pa.tem_protesto
  ),
  -- O grupo de cada cliente. Sem grupo_id, o "grupo" é o próprio CNPJ.
  membros as (
    select b.cnpj as cliente, u2.cnpj as membro
    from base b join public.mercado_universo u2 on u2.grupo_id = b.grupo_id
    where b.grupo_id is not null
    union
    select b.cnpj, b.cnpj from base b
  ),
  por_cliente as (
    select m.cliente,
      coalesce(sum(pa.valor_total), 0) as valor,
      coalesce(sum(pa.qtd_protestos), 0)::int as qtd,
      count(distinct pa.cnpj) filter (where pa.tem_protesto)::int as empresas_com_protesto
    from membros m
    left join public.protestos_atual pa on pa.cnpj = m.membro and pa.tem_protesto
    group by 1
  ),
  recentes as (
    select m.cliente,
      count(*)::int as qtd,
      coalesce(sum(t.valor), 0) as valor,
      max(t.data) as ultimo
    from membros m join titulos t on t.cnpj = m.membro
    where t.data is not null and t.data >= (current_date - interval '12 months')
    group by 1
  )
  select jsonb_build_object(
    'tem_acesso', true,
    'total', (select count(*)::int from base),
    'por_regiao', (select coalesce(jsonb_object_agg(regiao, n), '{}'::jsonb) from regiao),
    'por_camada', (select coalesce(jsonb_object_agg(camada, n), '{}'::jsonb) from cam),
    'por_capital', (select coalesce(jsonb_object_agg(faixa, n), '{}'::jsonb) from cap),
    'por_faturamento', (select coalesce(jsonb_object_agg(faixa, n), '{}'::jsonb) from fat),
    'por_funcionarios', (select coalesce(jsonb_object_agg(faixa, n), '{}'::jsonb) from func),
    'protestos_grupo', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.valor desc nulls last), '[]'::jsonb)
      from (
        select b.cnpj, b.nome, b.empresa_id, (b.grupo_id is not null) as tem_grupo,
               p.valor, p.qtd, p.empresas_com_protesto
        from base b join por_cliente p on p.cliente = b.cnpj
        -- Sem protesto não entra na lista: o pedido é ranking de quem tem.
        where p.valor > 0 or p.qtd > 0
        order by p.valor desc nulls last
        limit 30
      ) x
    ),
    'protestos_recentes', (
      select coalesce(jsonb_agg(to_jsonb(y) order by y.qtd desc, y.valor desc), '[]'::jsonb)
      from (
        select b.cnpj, b.nome, b.empresa_id, r.qtd, r.valor, r.ultimo
        from base b join recentes r on r.cliente = b.cnpj
        order by r.qtd desc, r.valor desc
        limit 15
      ) y
    )
  ) into v;
  return v;
end $function$;

comment on function public.radar_onepay_analytics is
  'Agregados dos clientes Onepay para a aba Análise: região, camada, capital, '
  'faturamento, funcionários e dois rankings de protesto (total do grupo e últimos '
  '12 meses). Protesto é somado no GRUPO — cliente que opera por SPE tem o protesto '
  'na SPE, não na matriz.';

-- ─── As duas faixas novas viram recorte clicável ─────────────────────────────

create or replace function public.radar_onepay_clientes(p_dimensao text, p_valor text)
returns jsonb language plpgsql stable security definer set search_path to '' as $function$
declare v jsonb;
begin
  if not public.app_tem_modulo('radar') then
    return jsonb_build_object('tem_acesso', false);
  end if;

  with base as (
    select c.cnpj, c.nome, c.empresa_id, u.uf, u.camada, u.capital_social,
           e.faturamento_anual, e.funcionarios
    from public.clientes_onepay c
    left join public.mercado_universo u on u.cnpj = c.cnpj
    left join public.empresas e on e.cnpj = c.cnpj
  ),
  filtrado as (
    select b.* from base b
    where case p_dimensao
      when 'regiao' then case p_valor
        when 'norte' then b.uf in ('AC','AP','AM','PA','RO','RR','TO')
        when 'nordeste' then b.uf in ('AL','BA','CE','MA','PB','PE','PI','RN','SE')
        when 'centro_oeste' then b.uf in ('DF','GO','MT','MS')
        when 'sudeste' then b.uf in ('ES','MG','RJ','SP')
        when 'sul' then b.uf in ('PR','RS','SC')
        when 'sem_uf' then b.uf is null
        else false end
      when 'camada' then b.camada = p_valor
      when 'capital' then case p_valor
        when 'sem_dado' then b.capital_social is null
        when 'f1' then b.capital_social < 500000
        when 'f2' then b.capital_social >= 500000 and b.capital_social < 2000000
        when 'f3' then b.capital_social >= 2000000 and b.capital_social < 5000000
        when 'f4' then b.capital_social >= 5000000 and b.capital_social < 10000000
        when 'f5' then b.capital_social >= 10000000 and b.capital_social < 20000000
        when 'f6' then b.capital_social >= 20000000 and b.capital_social < 50000000
        when 'f7' then b.capital_social >= 50000000 and b.capital_social < 100000000
        when 'f8' then b.capital_social >= 100000000
        else false end
      when 'faturamento' then case p_valor
        when 'sem_dado' then b.faturamento_anual is null
        when 'f1' then b.faturamento_anual < 4800000
        when 'f2' then b.faturamento_anual >= 4800000 and b.faturamento_anual < 20000000
        when 'f3' then b.faturamento_anual >= 20000000 and b.faturamento_anual < 50000000
        when 'f4' then b.faturamento_anual >= 50000000 and b.faturamento_anual < 100000000
        when 'f5' then b.faturamento_anual >= 100000000 and b.faturamento_anual < 300000000
        when 'f6' then b.faturamento_anual >= 300000000
        else false end
      when 'funcionarios' then case p_valor
        when 'sem_dado' then coalesce(b.funcionarios, 0) = 0
        when 'f1' then b.funcionarios > 0 and b.funcionarios < 10
        when 'f2' then b.funcionarios >= 10 and b.funcionarios < 50
        when 'f3' then b.funcionarios >= 50 and b.funcionarios < 100
        when 'f4' then b.funcionarios >= 100 and b.funcionarios < 250
        when 'f5' then b.funcionarios >= 250
        else false end
      else false end
  )
  select coalesce(jsonb_agg(to_jsonb(f) order by f.nome nulls last), '[]'::jsonb) into v
  from (select cnpj, nome, empresa_id, uf, camada, capital_social from filtrado) f;

  return jsonb_build_object('tem_acesso', true, 'clientes', v);
end $function$;

-- ─── O detalhe de protesto de um cliente, para o gráfico de evolução ─────────
-- Mesma forma de `empresa_grupo_protestos`, mas partindo do CNPJ do cliente e
-- funcionando quando ele não tem grupo (aí o grupo é ele mesmo). A tela reaproveita
-- o mesmo componente de gráfico da ficha da empresa.

create or replace function public.radar_onepay_protestos_cliente(p_cnpj text)
returns jsonb language plpgsql stable security definer set search_path to '' as $function$
declare v_grupo uuid; v jsonb;
begin
  if not public.app_tem_modulo('radar') then
    return jsonb_build_object('tem_acesso', false);
  end if;

  select grupo_id into v_grupo from public.mercado_universo where cnpj = p_cnpj;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.valor_total desc nulls last), '[]'::jsonb) into v
  from (
    select pa.cnpj,
           coalesce(e.razao_social, u.razao_social, co.nome, pa.cnpj) as nome,
           u.empresa_id, pa.valor_total, pa.qtd_protestos, pa.consultado_em, pa.cartorios
    from public.protestos_atual pa
    left join public.mercado_universo u on u.cnpj = pa.cnpj
    left join public.empresas e on e.id = u.empresa_id
    left join public.clientes_onepay co on co.cnpj = pa.cnpj
    where pa.tem_protesto
      and (case when v_grupo is null then pa.cnpj = p_cnpj else u.grupo_id = v_grupo end)
  ) t;

  return jsonb_build_object('tem_acesso', true, 'empresas', v);
end $function$;

revoke execute on function public.radar_onepay_protestos_cliente(text) from public;
grant execute on function public.radar_onepay_protestos_cliente(text) to authenticated, service_role;

comment on function public.radar_onepay_protestos_cliente is
  'Snapshots de protesto do GRUPO de um cliente Onepay (ou só dele, se não tiver '
  'grupo), com o jsonb de cartórios para a tela desenhar a evolução no tempo.';
