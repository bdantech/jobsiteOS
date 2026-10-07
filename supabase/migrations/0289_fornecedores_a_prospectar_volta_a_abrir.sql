/*
 * "Fornecedores a Prospectar" não abre: a política de `mercado_universo`, outra vez.
 *
 * ── A MEDIÇÃO (07/10/2026, como admin, com a RLS ligada) ────────────────────
 *     a consulta da tela (1ª página de 1.000) ......... 33.873 ms
 *     só `antecipacao_sacados_com_credito` ............ 17.916 ms   (1.818 linhas)
 *     dela, só os sacados aprovados ...................    881 ms   (90 linhas)
 *
 * O timeout do papel `authenticated` é 8 s. A tela não está lenta: ela não abre.
 *
 * ── DOIS CUSTOS, E NENHUM DELES É A AGREGAÇÃO ───────────────────────────────
 * 1. `antecipacao_sacados_com_credito` expande os 90 sacados aprovados para as
 *    empresas do MESMO GRUPO com dois joins diretos em `mercado_universo`. A
 *    política dela é o `case` da 0253, e o ramo caro entra no custo estimado mesmo
 *    quando não executa (0255): o planner desiste do índice e varre as 910 mil
 *    linhas — duas vezes — para achar umas 1.800.
 * 2. A view da tela agregava `notas_funil` linha a linha: 67 mil notas de 90 dias,
 *    cada uma montada inteira (duas fichas de cadastro, protesto, supressão, Onepay,
 *    antecipação, último número de NF) para no fim sobrar contagem e soma por
 *    fornecedor.
 *
 * ── A CORREÇÃO ──────────────────────────────────────────────────────────────
 * 1. `app__cnpjs_do_mesmo_grupo`: a expansão por grupo como SECURITY DEFINER, por
 *    índice (PK e `mercado_universo_grupo_idx`). É a decisão da 0241/0255 aplicada a
 *    uma resolução que recebe CNPJs que o chamador JÁ TEM e devolve só CNPJs.
 * 2. A view da tela lê `notas_fiscais` direto e só busca a ficha da Receita DEPOIS
 *    de agregar — uma chamada por fornecedor (≈2.700), não por nota.
 *
 * Mesmo resultado: as colunas, a janela de 90 dias, o filtro de "sem interesse" e o
 * de "já cadastrado" são os de antes. `notas_funil` não filtra linha nenhuma (só
 * junta colunas), então trocar a fonte não muda quem entra. Conferido antes de
 * aplicar, coluna a coluna, contra a view antiga: 2.706 fornecedores, zero
 * diferenças — e as 1.818 linhas de sacados com crédito com a mesma soma md5.
 * Com a RLS: 401 ms como admin, 269 ms como originador (era 33.873 ms).
 *
 * ── O QUE ISSO AMPLIA, DITO EM VOZ ALTA ─────────────────────────────────────
 * Antes, quem não tinha `mercado` só expandia por grupo os CNPJs que a política
 * deixava ver. Agora a expansão vale para todos os sacados aprovados que a pessoa
 * já enxerga em `notas_fiscais`. O que sai da função são CNPJs, dado público da
 * Receita; ninguém ganha o direito de LISTAR `mercado_universo`.
 *
 * `security_invoker` reafirmado nas duas views: a 0099 existe porque um
 * `create or replace view` sem ele entregou a tabela inteira a qualquer logado.
 */

-- ── 1. As empresas do mesmo grupo de uma lista de CNPJs ────────────────────

create or replace function public.app__cnpjs_do_mesmo_grupo(p_cnpjs text[])
returns table (cnpj text)
language sql
stable
security definer
set search_path to ''
as $fn$
  select distinct m.cnpj
    from public.mercado_universo u
    join public.mercado_universo m on m.grupo_id = u.grupo_id
   where u.cnpj = any(p_cnpjs)
     and u.grupo_id is not null;
$fn$;

comment on function public.app__cnpjs_do_mesmo_grupo(text[]) is
  'Os CNPJs que dividem grupo econômico com algum dos CNPJs dados, por índice. SECURITY '
  'DEFINER pela razão da 0255: como invoker, a política de mercado_universo fazia o '
  'planner varrer 910 mil linhas para expandir 90 sacados (17,9 s). Recebe CNPJs que o '
  'chamador já tem e devolve só CNPJs — dado público da Receita.';

revoke execute on function public.app__cnpjs_do_mesmo_grupo(text[]) from public, anon;
grant execute on function public.app__cnpjs_do_mesmo_grupo(text[]) to authenticated, service_role;

-- ── 2. Sacados com crédito: a mesma pergunta, sem varrer o universo ────────

create or replace view public.antecipacao_sacados_com_credito
with (security_invoker = true) as
 WITH aprovados AS (
         SELECT nf.sacado_cnpj AS cnpj
           FROM notas_fiscais nf
          GROUP BY nf.sacado_cnpj
         HAVING bool_or(nf.credit_status = 'APPROVED'::text)
        )
 SELECT cnpj,
    bool_or(proprio) AS aprovacao_propria
   FROM ( SELECT a.cnpj,
            true AS proprio
           FROM aprovados a
        UNION ALL
         SELECT g.cnpj,
            false
           FROM app__cnpjs_do_mesmo_grupo(( SELECT array_agg(a.cnpj) FROM aprovados a)) g(cnpj)) t
  GROUP BY cnpj;

-- ── 3. Fornecedores a prospectar: agrega a nota, e só então busca a ficha ──

create or replace view public.antecipacao_fornecedores_a_prospectar
with (security_invoker = true) as
 WITH agregado AS (
         SELECT nf.fornecedor_cnpj,
            max(nf.fornecedor_nome) AS nome_na_nota,
            (array_agg(nf.fornecedor_empresa_id) FILTER (WHERE nf.fornecedor_empresa_id IS NOT NULL))[1] AS fornecedor_empresa_id,
            max(fe.uf) AS uf_da_empresa,
            count(*)::integer AS notas,
            -- A MESMA expressão de `notas_funil.operavel`: nota cancelada não é operável,
            -- e a marcação manual vence a automática. `nf.operavel` cru contava 238
            -- fornecedores a mais.
            count(*) FILTER (WHERE nf.situacao = 'valida'::text AND COALESCE(nf.operavel_manual, nf.operavel))::integer AS notas_operaveis,
            count(DISTINCT nf.sacado_cnpj)::integer AS sacados,
            sum(nf.valor) AS valor_agregado,
            max(nf.emitida_em) AS ultima_nota_em,
            min(nf.emitida_em) AS primeira_nota_em
           FROM notas_fiscais nf
             JOIN antecipacao_sacados_com_credito cc ON cc.cnpj = nf.sacado_cnpj
             LEFT JOIN empresas fe ON fe.id = nf.fornecedor_empresa_id
          WHERE nf.emitida_em >= (now() - '90 days'::interval)
            AND NOT (EXISTS ( SELECT 1
                   FROM antecipacao_fornecedor_sem_interesse fsi
                  WHERE fsi.cnpj = nf.fornecedor_cnpj))
            AND NOT (EXISTS ( SELECT 1
                   FROM notas_fiscais n2
                  WHERE n2.fornecedor_cnpj = nf.fornecedor_cnpj AND n2.fornecedor_cadastrado))
          GROUP BY nf.fornecedor_cnpj
        )
 SELECT a.fornecedor_cnpj,
    COALESCE(fu.razao_social, a.nome_na_nota) AS fornecedor_nome,
    a.fornecedor_empresa_id,
    COALESCE(a.uf_da_empresa, fu.uf) AS fornecedor_uf,
    fu.municipio AS fornecedor_municipio,
    fu.cnae_principal AS fornecedor_cnae_principal,
    fu.situacao_cadastral AS fornecedor_situacao_cadastral,
    a.notas,
    a.notas_operaveis,
    a.sacados,
    a.valor_agregado,
    a.ultima_nota_em,
    a.primeira_nota_em
   FROM agregado a
     LEFT JOIN LATERAL app__cadastro_do_cnpj(a.fornecedor_cnpj) fu(cnpj, razao_social, nome_fantasia, uf, municipio, capital_social, situacao_cadastral, natureza_juridica, cnae_principal, cnae_grupos, camada) ON true;
