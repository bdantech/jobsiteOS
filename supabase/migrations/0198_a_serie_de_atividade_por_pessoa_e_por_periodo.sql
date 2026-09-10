-- A série de atividade passa a ser por pessoa e por período escolhido.
--
-- O gráfico era de barras empilhadas por dia: a altura da coluna era o time e cada faixa
-- uma pessoa. Isso responde bem "quanto o time fez hoje" e mal "como o Fabio vem se
-- comportando" — para seguir uma pessoa era preciso comparar a espessura de uma faixa que
-- flutua de posição conforme os outros sobem e descem. O pedido é uma LINHA por pessoa.
--
-- Do lado do banco, duas mudanças:
--
-- ── 1. GRANULARIDADE, E POR QUE ELA NÃO PODE SER FEITA NA TELA ─────────────────────
-- Agrupar dias em semanas somando os pontos diários funcionaria para `mensagens` e daria
-- número ERRADO para `empresas`: a empresa tocada na segunda e na terça conta duas vezes
-- na soma, e a pergunta "quantas empresas distintas na semana" exige o distinct sobre a
-- semana inteira. Por isso o balde é decidido aqui, onde o distinct ainda alcança as
-- linhas cruas.
--
-- `date_trunc('week')` no Postgres começa na SEGUNDA, que é o que "semana comercial"
-- significa para quem lê este painel.
--
-- ── 2. A DIVISÃO ENVIADAS/RECEBIDAS ────────────────────────────────────────────────
-- O tooltip do ponto precisa dizer as duas, e a série trazia só o total. Elas seguem os
-- MESMOS filtros do resto (inclusive o de direção): com "só enviadas" selecionado, o
-- gráfico mostra enviadas e o tooltip mostra enviadas — um número que aparece no balão
-- sem estar na linha faria o balão contradizer o desenho.
--
-- ── O NOME DA CHAVE MUDA JUNTO ─────────────────────────────────────────────────────
-- `por_dia` → `por_periodo`, e `dia` → `periodo`. Um campo chamado `dia` que guarda o
-- início de um mês é o tipo de mentira pequena que custa uma tarde de alguém seis meses
-- depois. Só a web consome esta RPC, e ela vai no mesmo commit.

create or replace function public.app_comunicacao_atividade_series(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_eu uuid := public.app_vendedor_atual();
  v_gestor boolean := public.app_gestor_comercial();
  v_de date := coalesce(nullif(p ->> 'de', '')::date, current_date - 29);
  v_ate date := coalesce(nullif(p ->> 'ate', '')::date, current_date);
  v_canal text := nullif(p ->> 'canal', '');
  v_direcao text := nullif(p ->> 'direcao', '');
  v_gran text := lower(coalesce(nullif(p ->> 'granularidade', ''), 'dia'));
  v_visiveis uuid[];
  v_periodo jsonb;
  v_hora jsonb;
begin
  if not public.app_tem_modulo('comunicacao') then
    raise exception 'Sem acesso ao módulo Comunicação.' using errcode = '42501';
  end if;

  -- Valor estranho vira 'dia' em vez de erro: é parâmetro de tela, e uma exceção aqui
  -- apagaria o gráfico inteiro por causa de um seletor.
  if v_gran not in ('dia', 'semana', 'mes') then
    v_gran := 'dia';
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
    return jsonb_build_object(
      'tem_acesso', false, 'granularidade', v_gran,
      'por_periodo', '[]'::jsonb, 'por_hora', '[]'::jsonb
    );
  end if;

  with base as (
    select
      c.vendedor_id,
      v.nome as vendedor_nome,
      v.is_ia,
      (c.criado_em at time zone 'America/Sao_Paulo')::date as dia,
      extract(hour from c.criado_em at time zone 'America/Sao_Paulo')::int as hora,
      c.direcao,
      c.empresa_id,
      c.conversa_id
    from public.comunicacoes c
    join public.vendedores v on v.id = c.vendedor_id
    where c.vendedor_id = any (v_visiveis)
      and c.canal <> 'interno'
      and (v_canal is null or c.canal = v_canal)
      and (v_direcao is null or c.direcao = v_direcao)
      and (c.criado_em at time zone 'America/Sao_Paulo')::date between v_de and v_ate
  ), balde as (
    select
      case v_gran
        when 'semana' then date_trunc('week', dia)::date
        when 'mes'    then date_trunc('month', dia)::date
        else dia
      end as periodo,
      base.*
    from base
  )
  select
    coalesce((
      select jsonb_agg(x order by x ->> 'periodo', x ->> 'vendedor_nome')
      from (
        select jsonb_build_object(
          'periodo', periodo,
          'vendedor_id', vendedor_id,
          'vendedor_nome', vendedor_nome,
          'is_ia', is_ia,
          -- O distinct é sobre o BALDE, não sobre o dia: é o que torna a visão semanal
          -- e a mensal contas de verdade em vez de somas de contas.
          'empresas', count(distinct coalesce(empresa_id::text, 'conversa:' || conversa_id::text)),
          'mensagens', count(*),
          'enviadas', count(*) filter (where direcao = 'saida'),
          'recebidas', count(*) filter (where direcao = 'entrada')
        ) as x
        from balde
        group by periodo, vendedor_id, vendedor_nome, is_ia
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
  into v_periodo, v_hora;

  return jsonb_build_object(
    'tem_acesso', true, 'de', v_de, 'ate', v_ate, 'granularidade', v_gran,
    'por_periodo', v_periodo, 'por_hora', v_hora
  );
end $function$;
