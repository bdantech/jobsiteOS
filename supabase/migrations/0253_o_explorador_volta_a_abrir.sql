/*
 * O Explorador parou de abrir, e a causa foi a 0242 — desta casa.
 *
 * ── O QUE ELA FEZ ───────────────────────────────────────────────────────────
 * A 0242 abriu `mercado_universo` para quem tem `antecipacao`, acrescentando
 * dois EXISTS escritos assim:
 *
 *     exists (select 1 from pre_autorizacoes pa
 *              where pa.fornecedor_cnpj = mercado_universo.cnpj
 *                 or pa.sacado_cnpj     = mercado_universo.cnpj
 *                 or pa.sacado_matriz_cnpj = mercado_universo.cnpj)
 *
 * Um OR de três colunas contra a coluna EXTERNA. O planner não consegue
 * transformar isso num subplano hasheado (as de `notas_fiscais` e `empresas`,
 * que comparam uma coluna só, ele hasheia), então sobra um SubPlan CORRELATO:
 * um Seq Scan por linha de `mercado_universo`, 906.417 vezes, duas vezes.
 *
 * Custo do plano da primeira página: 139.702 antes, 30.475.160 depois. 218×. Na
 * prática a consulta não termina — estourou os 25s de teste.
 *
 * ── AS DUAS CORREÇÕES, E POR QUE AS DUAS ────────────────────────────────────
 * 1. `case` no lugar do `or` de topo. O `or` do SQL não promete curto-circuito, e
 *    o plano provava isso: quem tem o módulo `mercado` pagava os ramos dos outros
 *    dois. O `case` promete, e no plano corrigido todos os SubPlans caros
 *    aparecem como `(never executed)`.
 *
 * 2. Os EXISTS viram `cnpj in (select ... union all select ...)`, uma coluna por
 *    ramo. Aí o planner hasheia UMA vez e compara. Isso não é cosmético: sem
 *    isso, quem tem `antecipacao` e não tem `mercado` continuaria pagando o
 *    scan por linha — só que em silêncio, porque essa pessoa não abre o
 *    Explorador e o custo apareceria espalhado pelo funil.
 *
 * A semântica é a MESMA da 0242, linha por linha: quem tem `mercado` vê tudo;
 * quem tem `antecipacao` vê os CNPJs que aparecem em algo que ele já podia ver;
 * quem tem `empresas` vê quem tem ficha. As tabelas lidas têm RLS própria, então
 * o recorte continua respeitando a carteira de quem pergunta.
 *
 * ── E O ÍNDICE, QUE É OUTRO PROBLEMA ────────────────────────────────────────
 * Mesmo com a política consertada a página levava 6,2s: Seq Scan de 906 mil
 * linhas mais um top-N sort, porque `order by capital_social desc, cnpj` não
 * tinha índice. Isso é ANTERIOR à 0242 — o Explorador já estava ruim, e a
 * regressão só empurrou de "lento" para "não abre".
 *
 * Com o índice o Sort vira Index Scan e a leitura para nas 25 primeiras linhas:
 *
 *     quebrado (0242)      > 25.000 ms   (timeout)
 *     só o `case`            6.238 ms
 *     `case` + índice            4,8 ms
 */

drop policy if exists mercado_universo_select on public.mercado_universo;

create policy mercado_universo_select on public.mercado_universo
  for select using (
    case
      when (select public.app_tem_modulo('mercado')) then true
      else
        (
          (select public.app_tem_modulo('antecipacao'))
          and mercado_universo.cnpj in (
                select nf.fornecedor_cnpj   from public.notas_fiscais nf
            union all select nf.sacado_cnpj from public.notas_fiscais nf
            union all select pa.fornecedor_cnpj     from public.pre_autorizacoes pa
            union all select pa.sacado_cnpj         from public.pre_autorizacoes pa
            union all select pa.sacado_matriz_cnpj  from public.pre_autorizacoes pa
            union all select st.credor_cnpj         from public.sienge_titulos st
            union all select st.sacado_cnpj         from public.sienge_titulos st
            union all select st.sacado_matriz_cnpj  from public.sienge_titulos st
          )
        )
        or (
          (select public.app_tem_modulo('empresas'))
          and mercado_universo.cnpj in (select e.cnpj from public.empresas e)
        )
    end
  );

-- A ordenação padrão do Explorador (web e mobile leem a mesma), agora por índice.
create index if not exists mercado_universo_capital_cnpj_idx
  on public.mercado_universo (capital_social desc nulls last, cnpj asc);
