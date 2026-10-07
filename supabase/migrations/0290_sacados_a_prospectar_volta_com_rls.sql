/*
 * "Sacados a Prospectar" volta — e a view dela estava ABERTA.
 *
 * ── O QUE ESTAVA ERRADO ─────────────────────────────────────────────────────
 * A tela foi apagada pela 0222 (absorvida por "Sacados por NF"), mas a view ficou, e
 * ficou sem `security_invoker` e com grant de SELECT para `anon`. Sem a opção, ela
 * roda com as permissões do dono e passa por cima da RLS de `notas_fiscais`: medido
 * em 07/10/2026, o originador lia os 1.877 sacados da base inteira — e quem tivesse
 * só a chave pública do app (que vai no bundle do navegador) lia o mesmo, sem login.
 * É a terceira vez do padrão da 0099/0225.
 *
 * ── A CORREÇÃO ──────────────────────────────────────────────────────────────
 *   - `security_invoker = true`: a RLS de `notas_fiscais` volta a valer — o mesmo
 *     originador passa a ver 66, os das notas dele;
 *   - `anon` perde o SELECT;
 *   - a view lê `notas_fiscais` direto e busca a ficha da Receita só DEPOIS de
 *     agregar, pela `app__cadastro_do_cnpj` (0255) — a mesma reescrita da 0289. Como
 *     invoker sobre `notas_funil` ela pagaria a política de `mercado_universo` nota a
 *     nota.
 *
 * Mesmo resultado: as 13 colunas, na mesma ordem e tipo, e o mesmo recorte —
 * sacado sem empresa cadastrada (`sacado_empresa_id is null`) com CNAE de construção
 * (divisões 41/42/43). Conferido antes de aplicar, sem RLS: 1.877 linhas, zero
 * diferenças. Com a RLS: 203 ms como admin, 70 ms como originador.
 *
 * Os campos de `notas_funil` que a antiga lia vinham de `coalesce(cadastro, empresa)`;
 * com `sacado_empresa_id is null` o lado da empresa é sempre nulo, então sobra o
 * cadastro — e é ele que a função devolve.
 */

create or replace view public.antecipacao_sacados_a_prospectar
with (security_invoker = true) as
 WITH agregado AS (
         SELECT nf.sacado_cnpj,
            max(nf.sacado_nome) AS nome_na_nota,
            count(*)::integer AS notas,
            sum(nf.valor) AS valor_agregado,
            count(DISTINCT nf.fornecedor_cnpj)::integer AS fornecedores,
            -- A expressão de `notas_funil.fornecedor_ja_antecipou`.
            count(*) FILTER (WHERE fco.last_anticipation IS NOT NULL OR fe.ultima_antecipacao IS NOT NULL)::integer AS notas_de_quem_ja_antecipou,
            max(nf.emitida_em) AS ultima_nota_em,
            min(nf.emitida_em) AS primeira_nota_em
           FROM notas_fiscais nf
             LEFT JOIN empresas fe ON fe.id = nf.fornecedor_empresa_id
             LEFT JOIN clientes_onepay fco ON fco.cnpj = nf.fornecedor_cnpj
          WHERE nf.sacado_empresa_id IS NULL
          GROUP BY nf.sacado_cnpj
        )
 SELECT a.sacado_cnpj,
    COALESCE(su.razao_social, a.nome_na_nota) AS sacado_nome,
    NULL::uuid AS sacado_empresa_id,
    su.uf AS sacado_uf,
    su.municipio AS sacado_municipio,
    su.cnae_principal AS sacado_cnae_principal,
    a.notas,
    a.valor_agregado,
    a.fornecedores,
    a.notas_de_quem_ja_antecipou,
    a.ultima_nota_em,
    a.primeira_nota_em,
    su.camada AS sacado_camada
   FROM agregado a
     CROSS JOIN LATERAL app__cadastro_do_cnpj(a.sacado_cnpj) su(cnpj, razao_social, nome_fantasia, uf, municipio, capital_social, situacao_cadastral, natureza_juridica, cnae_principal, cnae_grupos, camada)
  WHERE su.cnae_grupos && ARRAY['41'::text, '42'::text, '43'::text];

revoke all on public.antecipacao_sacados_a_prospectar from anon;
grant select on public.antecipacao_sacados_a_prospectar to authenticated;
