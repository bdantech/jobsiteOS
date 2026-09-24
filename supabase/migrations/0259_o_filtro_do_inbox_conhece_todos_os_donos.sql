-- ─────────────────────────────────────────────────────────────────────────────
-- 0259 — O filtro do inbox conhece todos os donos
--
-- O seletor "Todos os vendedores" do inbox montava a lista lendo 500 linhas de
-- `inbox_conversas` e tirando os distintos no cliente — sem `order by`. Com 1.058
-- conversas, quem tem poucas saía ou não saía conforme o plano do dia: a Pamela,
-- com 3, sumia do filtro enquanto as conversas dela estavam na lista logo abaixo.
--
-- A pergunta é "quais donos existem", e ela é um DISTINCT — que o PostgREST não
-- faz. Daí a função. INVOKER de propósito: a lista continua sendo "os donos das
-- conversas que ESTA pessoa enxerga", pela mesma RLS de `conversas` que a view do
-- inbox usa, e o `left join` em `vendedores` é o mesmo da view.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.app_inbox_responsaveis()
returns table (id uuid, nome text, is_ia boolean)
language sql
stable
security invoker
set search_path to ''
as $$
  select d.id, coalesce(v.nome, 'Sem nome'), coalesce(v.is_ia, false)
    from (select distinct cv.responsavel_vendedor_id as id
            from public.conversas cv
           where cv.responsavel_vendedor_id is not null) d
    left join public.vendedores v on v.id = d.id
   order by 2
$$;

revoke execute on function public.app_inbox_responsaveis() from public, anon;
grant execute on function public.app_inbox_responsaveis() to authenticated, service_role;
