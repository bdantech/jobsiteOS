-- ═════════════════════════════════════════════════════════════════════════════
-- 0210 — A régua do SDR por origem do lead, e o dinheiro que é pessoal
--
-- Três pedidos independentes da mesma conversa sobre comissão.
--
-- ─── §1 A PENALIDADE PRECISA DE UM TIPO DE ORIGEM ──────────────────────────
-- Marcar reunião com quem não tem fit passa a descontar do SDR. O desconto é um
-- lançamento como qualquer outro, e por isso precisa de um `origem_tipo` próprio —
-- não de um `ajuste_manual`, que diria que um gestor digitou o número à mão.
--
-- O `origem_id` da penalidade é o id do ACEITE, o mesmo da reunião que ela desconta.
-- Com a unicidade (papel, origem_tipo, origem_id, vendedor_id) que a tabela já tem,
-- reavaliar o fit dez vezes continua sendo uma penalidade só — sem precisar de coluna
-- de "já cobrei".
--
-- ─── §2 DINHEIRO NÃO SEGUE A MESMA RÉGUA QUE TRABALHO ──────────────────────
-- `app_vendedores_visiveis()` responde "de quem eu enxergo o trabalho": funil,
-- carteira, Meu Dia, fila de aceite. Para o AUXILIAR ela devolve, além dele mesmo:
--
--   o superior (o closer)                     ← correto: ele trabalha as contas do closer
--   TODOS OS ACESSOS CRUZADOS DO SUPERIOR     ← e aqui o dinheiro vazou
--
-- A segunda linha existe por um bom motivo no trabalho: se o Fábio enxerga o funil de
-- outro vendedor, a Pamella precisa enxergar também para ajudá-lo. Mas as duas
-- políticas de `comissao_lancamentos` usavam essa MESMA função, e o efeito foi que a
-- auxiliar passou a ver a folha de gente com quem ela não tem relação nenhuma.
--
-- A régua do dinheiro é mais curta, e é uma função separada em vez de um `case` dentro
-- da existente porque as duas perguntas vão divergir de novo:
--
--   gestor        → todos
--   qualquer um   → ele mesmo + os acessos concedidos A ELE, nominalmente
--
-- O auxiliar não perde nada com isso. A linha dele JÁ É a do closer com o percentual
-- aplicado: o motor deriva um lançamento de AUXILIAR de cada lançamento de VENDEDOR do
-- closer, com a mesma descrição e o mesmo sacado, valendo `repasse_auxiliar_pct` ÷ nº de
-- auxiliares. O extrato dela é o do Fábio linha a linha, na escala dela — e o valor
-- cheio do Fábio é remuneração do Fábio.
--
-- ─── §3 QUEM ENXERGA MAIS DE UM PRECISA DO SELETOR ─────────────────────────
-- A tela de comissões só mostrava o seletor de pessoa para GESTOR. Mas um closer com
-- acesso cruzado publicado enxerga outras folhas — o RLS já deixa — e ficava sem como
-- escolher qual ver: o extrato vinha misturado, sem filtro. A tela passa a perguntar ao
-- banco quantos ele enxerga, em vez de deduzir do cargo.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── §1 ─────────────────────────────────────────────────────────────────────

alter table public.comissao_lancamentos_v2
  drop constraint if exists comissao_lancamentos_v2_origem_check;

-- A lista vem do banco vivo, não da migração original: `estorno` e `ajuste_manual`
-- entraram depois da 0132, e recriar o CHECK a partir do arquivo antigo apagaria os dois.
alter table public.comissao_lancamentos_v2
  add constraint comissao_lancamentos_v2_origem_check
  check (origem_tipo in (
    'nf_convertida',
    'sdr_reuniao',
    'sdr_conta_fechada',
    'sdr_penalidade_sem_fit',
    'estorno',
    'ajuste_manual'
  ));

-- ─── §2 ─────────────────────────────────────────────────────────────────────

create or replace function public.app_vendedores_visiveis_comissao()
returns uuid[] language sql stable security definer set search_path = '' as $function$
  select case
    when public.app_gestor_comercial()
      then coalesce((select array_agg(v.id) from public.vendedores v), '{}'::uuid[])
    else coalesce((
      select array_agg(distinct s.x)
      from (
        select public.app_vendedor_atual() as x
        union
        /*
         * Só o que foi concedido A ELE, nominalmente. Sem a herança dos acessos do
         * superior que a régua do TRABALHO tem: ajudar um closer a tocar as contas
         * dele não é motivo para ver a folha de um terceiro.
         */
        select a.pode_ver_vendedor_id
        from public.vendedor_acessos a
        where a.vendedor_id = public.app_vendedor_atual()
      ) s
      where s.x is not null
    ), '{}'::uuid[])
  end;
$function$;

comment on function public.app_vendedores_visiveis_comissao is
  'De quem esta pessoa pode ver a FOLHA. Mais curta que `app_vendedores_visiveis`, que '
  'responde de quem ela vê o TRABALHO: o auxiliar enxerga o funil do closer e os acessos '
  'cruzados dele, mas não a remuneração de terceiros.';

revoke execute on function public.app_vendedores_visiveis_comissao() from public, anon;
grant execute on function public.app_vendedores_visiveis_comissao() to authenticated, service_role;

drop policy if exists comissao_lancamentos_v2_select on public.comissao_lancamentos_v2;
create policy comissao_lancamentos_v2_select on public.comissao_lancamentos_v2
  for select using (
    (select public.app_tem_modulo('comercial'))
    and vendedor_id = any (coalesce((select public.app_vendedores_visiveis_comissao()), '{}'::uuid[]))
  );

drop policy if exists comissao_lancamentos_select on public.comissao_lancamentos;
create policy comissao_lancamentos_select on public.comissao_lancamentos
  for select using (
    (select public.app_tem_modulo('comercial'))
    and vendedor_id = any (coalesce((select public.app_vendedores_visiveis_comissao()), '{}'::uuid[]))
  );

-- ─── §3 ─────────────────────────────────────────────────────────────────────
--
-- Espelha `comercial_vendedores_visiveis`, só que pela régua do dinheiro. A tela usa a
-- CONTAGEM para decidir se o seletor faz sentido: um item é a própria pessoa, e um
-- seletor de uma opção é um controle que não controla nada.

create or replace function public.comercial_vendedores_da_comissao()
returns jsonb language sql stable security definer set search_path = '' as $function$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.nome), '[]'::jsonb)
  from (
    select v.id, v.nome, v.tipo, v.is_ia
    from public.vendedores v
    where v.ativo
      and public.app_tem_modulo('comercial')
      and v.id = any (coalesce(public.app_vendedores_visiveis_comissao(), '{}'::uuid[]))
  ) x;
$function$;

comment on function public.comercial_vendedores_da_comissao is
  'Os vendedores cuja FOLHA quem chama pode abrir. Alimenta o seletor da tela de '
  'comissões, que antes só existia para gestor e deixava o closer com acesso cruzado '
  'vendo tudo misturado, sem filtro.';

revoke execute on function public.comercial_vendedores_da_comissao() from public, anon;
grant execute on function public.comercial_vendedores_da_comissao() to authenticated, service_role;
