-- 0182 — A lista de contas não pode ser por linha.
--
-- `comercial_contas_fase` (0181) montava `volume_mes` e `comissao_mes` como subconsultas
-- CORRELACIONADAS, uma por empresa. `app_holding_do_sacado` é uma função POR LINHA, então
-- cada uma das ~200 contas varria `antecipacoes` inteira chamando a função em cada linha:
-- 200 × 1.073 = 214 mil execuções da função por carregamento de tela.
--
-- 35.071 ms. O timeout do PostgREST para `authenticated` é 8 segundos, então a chamada
-- morria no meio e o cliente recebia uma lista vazia — sem erro, sem log, sem sintoma
-- nenhum além de "a tela não lista nada".
--
-- Com CTEs a função roda uma vez por antecipação em vez de uma vez por (empresa ×
-- antecipação), e os quatro agregados viram hash joins: 87 ms.
--
-- O aviso já estava escrito, em dois lugares — no comentário do `comissao_reclassificacao`
-- (0132 §7.6) e no `alertaReclassificacaoJob`. Ambos dizem, com estas palavras, que a
-- agregação vem de um CTE e não de subconsultas correlacionadas porque
-- `app_holding_do_sacado` é uma função por linha. Repeti o erro que o próprio repositório
-- documentava.

create or replace function public.comercial_contas_fase()
returns jsonb language sql stable security definer set search_path = '' as $function$
  with vol as (
    select public.app_holding_do_sacado(a.sacado_cnpj) as empresa_id,
           sum(a.gross_value) as volume_mes,
           count(*)::int as cessoes_mes
    from public.antecipacoes a
    where a.regrediu_em is null
      and a.convertida_em >= date_trunc('month', now() at time zone 'America/Sao_Paulo')
    group by 1
  ),
  com as (
    select l.empresa_id, sum(l.valor) as comissao_mes
    from public.comissao_lancamentos_v2 l
    where l.competencia = (date_trunc('month', now() at time zone 'America/Sao_Paulo'))::date
    group by 1
  ),
  tit as (
    -- `distinct on` e não `limit 1` numa subconsulta: com split de titularidade a conta
    -- tem duas linhas vigentes, e a tela mostra a mais recente em vez de recusar a linha.
    select distinct on (c.empresa_id) c.empresa_id, v.nome
    from public.vendedor_carteira c
    join public.vendedores v on v.id = c.vendedor_id
    where c.papel = 'vendedor' and c.ate is null
    order by c.empresa_id, c.desde desc
  ),
  aj as (
    select h.empresa_id, count(*)::int as ajustes
    from public.conta_fase_historico h group by 1
  )
  select case when not public.app_tem_modulo('comercial') then '[]'::jsonb else coalesce(
    (select jsonb_agg(to_jsonb(x) order by x.volume_mes desc, x.razao_social)
     from (
       select e.id as empresa_id,
              e.razao_social,
              e.cnpj,
              e.estagio,
              e.gestao_operacao,
              e.marco_ativacao,
              e.fase_manual,
              tit.nome as titular,
              coalesce(vol.volume_mes, 0) as volume_mes,
              coalesce(vol.cessoes_mes, 0) as cessoes_mes,
              coalesce(com.comissao_mes, 0) as comissao_mes,
              coalesce(aj.ajustes, 0) as ajustes
       from public.empresas e
       left join vol on vol.empresa_id = e.id
       left join com on com.empresa_id = e.id
       left join tit on tit.empresa_id = e.id
       left join aj  on aj.empresa_id  = e.id
       where e.estagio = 'cliente'
          or (e.estagio = 'ex_cliente'
              and (vol.empresa_id is not null or com.empresa_id is not null))
     ) x),
    '[]'::jsonb) end;
$function$;

comment on function public.comercial_contas_fase is
  'O relógio de cada cliente ATUAL, mais o ex-cliente que operou no mês corrente. As '
  'agregações vêm de CTEs, e não de subconsultas correlacionadas: `app_holding_do_sacado` é '
  'uma função POR LINHA, e uma subconsulta por empresa varre `antecipacoes` inteira para '
  'cada conta — 35 segundos contra os 8 do timeout do PostgREST, e a tela recebia lista '
  'vazia sem erro nenhum.';

-- ─── §2 A lista é de CLIENTES, não de tudo o que já foi cliente ─────────────
--
-- `estagio in (cliente, ex_cliente)` é a régua do `app_holding_do_sacado`, e eu a copiei
-- sem perguntar se ela servia AQUI. Ela serve lá porque a pergunta é "de quem é esta
-- cessão?", e uma cessão pode ser de quem saiu no mês passado. Aqui a pergunta é outra:
-- "quais contas eu gerencio?" — e a resposta são 55 linhas, não 196.
--
-- Os 141 ex-clientes eram história: sem operação, sem comissão, sem relógio para ajustar.
-- Enterravam as 55 que importam numa lista quatro vezes maior.
--
-- O ex-cliente que operou NO MÊS continua entrando, e não é exceção de conveniência: são
-- três contas com 10 cessões e R$ 226 mil em setembro, gerando comissão agora. Escondê-las
-- trocaria uma lista poluída por um ponto cego — e ponto cego é o defeito que este módulo
-- passou a semana inteira consertando.
