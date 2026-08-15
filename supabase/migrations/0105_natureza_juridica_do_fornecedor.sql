-- =============================================================================
-- 0105 — Natureza jurídica do fornecedor como variável de faixa
--
-- "Ltda ou S.A.?" é uma pergunta de régua: quem antecipa recebível não é o mesmo
-- perfil de quem é empresário individual, e hoje a regra de faixa não conseguia
-- nem enunciar a distinção. O dado já estava em `mercado_universo`, vindo do dump
-- da Receita — faltava chegar a `notas_funil`, que é a única superfície que o
-- catálogo de faixas (`packages/core/src/antecipacao/faixas.ts`) pode nomear.
--
-- POR QUE A COLUNA É O CÓDIGO, E NÃO O TEXTO. Porque o texto não é um valor, são
-- dois. Medido nos 899.295 CNPJs com natureza preenchida:
--
--     "2062 - Sociedade Empresária Limitada"   627.012 linhas
--     "2062"                                     5.597 linhas
--
-- É a MESMA natureza. Uma regra `natureza = 'Sociedade Empresária Limitada'`
-- pegaria as primeiras e perderia as segundas, sem erro e sem aviso — a pior
-- família de bug que este módulo já colecionou. O código de 4 dígitos é único,
-- estável entre revisões da tabela do IBGE (o 2321 mudou de "Advocacia" para
-- "Advogados") e é o que fica gravado na definição da regra.
--
-- 12 linhas da base trazem só três dígitos ("206", "213", "232") — o dígito
-- verificador se perdeu na origem. Elas viram NULL em vez de virarem um código
-- inventado: nulo é "não sei", que é a verdade, e a regra pode alcançá-lo com o
-- operador "não definido".
--
-- A normalização aqui é o espelho de `codigoNaturezaJuridica()` em
-- `packages/core/src/perfil/natureza-juridica.ts`, que já fazia o mesmo em TS para o
-- perfil. As duas precisam concordar: a tela lê o código pelo TS e a reclassificação
-- casa pelo SQL. Os rótulos ficam só no core (`NATUREZA_JURIDICA_LABELS`) — repetir
-- 92 descrições num CASE de SQL seria uma segunda tabela para envelhecer sozinha.
-- =============================================================================

-- Uma função e não uma expressão solta na view, pelo mesmo motivo de
-- `cnae_grupos_de`: é a definição da normalização, e ela tem um par em TS
-- (`codigoNaturezaJuridica`). Espalhada em três `regexp_replace` iguais, o dia em
-- que a Receita mudar o formato do texto vira uma caça a ocorrências.
create or replace function public.natureza_juridica_codigo(bruto text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when regexp_replace(split_part(bruto, ' - ', 1), '\D', '', 'g') ~ '^[0-9]{4}$'
      then regexp_replace(split_part(bruto, ' - ', 1), '\D', '', 'g')
    else null
  end
$$;

comment on function public.natureza_juridica_codigo(text) is
  'O código de 4 dígitos da tabela do IBGE a partir do texto do dump da Receita, '
  'que vem em dois formatos ("2062 - Sociedade Empresária Limitada" e "2062"). '
  'Devolve NULL para o que não normaliza em 4 dígitos — 12 CNPJs da base perderam o '
  'dígito verificador na origem, e um código inventado seria pior que "não sei".';

create or replace view public.notas_funil
with (security_invoker = true) as
 SELECT nf.access_key,
    nf.nf_id_externo,
    nf.tipo AS tipo_nf,
    nf.direction,
    nf.numero,
    nf.serie,
    nf.valor,
    nf.emitida_em,
    nf.vencimento,
    nf.vencimento_origem,
    nf.status_sync,
    nf.parcelas,
    nf.faixa,
    nf.faixa_regra_versao,
    nf.faixa_motivo,
    nf.faixa_alterada_em,
    nf.estagio_funil,
    nf.estagio_alterado_em,
    nf.perda_motivo,
    nf.receita_esperada,
    nf.taxa_usada,
    nf.sincronizada_em,
    nf.vencimento - CURRENT_DATE AS dias_para_vencimento,
    nf.fornecedor_cnpj,
    nf.fornecedor_nome,
    COALESCE(nf.fornecedor_cadastrado, false) AS fornecedor_cadastrado,
    nf.fornecedor_empresa_id,
    COALESCE(fe.uf, fu.uf) AS fornecedor_uf,
    COALESCE(fpa.tem_protesto, false) AS fornecedor_tem_protesto,
    fco.cnpj IS NOT NULL AS fornecedor_e_cliente_onepay,
    fco.last_anticipation IS NOT NULL OR fe.ultima_antecipacao IS NOT NULL AS fornecedor_ja_antecipou,
        CASE
            WHEN NOT COALESCE(nf.fornecedor_cadastrado, false) THEN 'aquisicao'::text
            WHEN fco.last_anticipation IS NOT NULL OR fe.ultima_antecipacao IS NOT NULL THEN 'recorrencia'::text
            ELSE 'ativacao'::text
        END AS fornecedor_tipagem,
    fsup.valor IS NOT NULL AS fornecedor_suprimido,
    nf.sacado_cnpj,
    nf.sacado_nome,
    COALESCE(nf.sacado_cadastrado, false) AS sacado_cadastrado,
    nf.sacado_empresa_id,
    nf.contato_sacado,
    COALESCE(se.uf, su.uf) AS sacado_uf,
    nf.credit_status AS sacado_credito_status,
    nf.credit_role AS sacado_credito_role,
    nf.credit_limite AS sacado_limite,
    nf.credit_disponivel AS sacado_limite_disponivel,
    COALESCE(nf.credit_disponivel, 0::numeric) >= nf.valor AS sacado_limite_cobre_nota,
    nf.contato_fornecedor,
    COALESCE(su.cnae_principal, se.cnae_principal) AS sacado_cnae_principal,
    NULLIF(COALESCE(su.cnae_grupos, cnae_grupos_de(se.cnae_principal, NULL::text[])), '{}'::text[]) AS sacado_cnae_grupos,
    COALESCE(NULLIF(COALESCE(su.cnae_grupos, cnae_grupos_de(se.cnae_principal, NULL::text[])), '{}'::text[]) && ARRAY['41'::text, '42'::text, '43'::text], false) AS sacado_construcao,
    COALESCE(su.razao_social, se.razao_social) AS sacado_razao_social,
    COALESCE(su.municipio, se.municipio) AS sacado_municipio,
    fu.capital_social AS fornecedor_capital_social,
    fu.situacao_cadastral AS fornecedor_situacao_cadastral,
    fpa.valor_total AS fornecedor_protesto_valor,
    fnf.ultimo_numero_nf AS fornecedor_ultimo_numero_nf,
    nf.natureza_operacao,
    COALESCE(nf.operavel_manual, nf.operavel) AS operavel,
    nf.nao_operavel_motivo,
    su.camada AS sacado_camada,
    fpa.consultado_em AS fornecedor_protesto_em,
    nf.conversao_antecipacao_id,
    nf.conversao_em_disputa,
    ant.gross_value AS conversao_valor,
    ant.monthly_interest_rate AS conversao_taxa,
    ant.status AS conversao_status,
    nf.vendedor_id,
    nf.vendedor_origem,
    se.gestao_operacao AS sacado_gestao_operacao,
    fsi.cnpj IS NOT NULL AS fornecedor_sem_interesse,
    -- Do FORNECEDOR (`fu`), não do sacado: a pergunta é sobre quem emite a nota e
    -- vai antecipar. A do sacado seria outra variável, e não foi pedida.
    natureza_juridica_codigo(fu.natureza_juridica) AS fornecedor_natureza_juridica
   FROM notas_fiscais nf
     LEFT JOIN empresas fe ON fe.id = nf.fornecedor_empresa_id
     LEFT JOIN empresas se ON se.id = nf.sacado_empresa_id
     LEFT JOIN mercado_universo fu ON fu.cnpj = nf.fornecedor_cnpj
     LEFT JOIN mercado_universo su ON su.cnpj = nf.sacado_cnpj
     LEFT JOIN protestos_atual fpa ON fpa.cnpj = nf.fornecedor_cnpj
     LEFT JOIN clientes_onepay fco ON fco.cnpj = nf.fornecedor_cnpj
     LEFT JOIN supressao fsup ON fsup.escopo = 'empresa'::text AND fsup.valor = nf.fornecedor_cnpj AND (fsup.expira_em IS NULL OR fsup.expira_em >= CURRENT_DATE)
     LEFT JOIN antecipacao_fornecedor_sem_interesse fsi ON fsi.cnpj = nf.fornecedor_cnpj
     LEFT JOIN antecipacoes ant ON ant.id_externo = nf.conversao_antecipacao_id
     LEFT JOIN LATERAL ( SELECT max(n2.numero::bigint) AS ultimo_numero_nf
           FROM notas_fiscais n2
          WHERE n2.fornecedor_cnpj = nf.fornecedor_cnpj AND n2.tipo = 'NFe'::text AND n2.numero ~ '^[0-9]{1,9}$'::text) fnf ON true;

comment on column public.notas_funil.fornecedor_natureza_juridica is
  'Código de 4 dígitos da natureza jurídica do fornecedor (tabela do IBGE), '
  'normalizado por natureza_juridica_codigo(). Variável do motor de faixa; o rótulo '
  'mora no core (NATUREZA_JURIDICA_LABELS), não no banco.';
