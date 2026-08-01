import type { Consultavel } from '../../db.js'
import type { ConfigCoortes } from '../../../../../packages/core/src/perfil/schemas.js'
import type { LinhaPerfil } from '../../../../../packages/core/src/perfil/variaveis.js'

/**
 * As coortes do Perfil (04f §2), e a linha achatada que o contraste consome.
 *
 * Uma decisão governa o arquivo: TODAS as coortes saem da MESMA consulta, com as
 * MESMAS colunas. É o que garante que "sacado pesado" e "empresa do SOM" sejam
 * comparáveis — se cada lado viesse de uma query própria, uma diferença de join
 * (um LEFT que virou INNER) apareceria como um achado de lift 3.
 *
 * A fonte é `mercado_explorador`, e não `mercado_universo`: é a MESMA superfície
 * contra a qual as regras de camada compilam. Auditar a régua contra uma visão
 * diferente daquela em que ela roda seria auditar outra coisa.
 */

/** As colunas que o catálogo do Perfil lê, mais o que a auditoria precisa. */
const COLUNAS = `
  base.cnpj,
  x.uf,
  x.municipio,
  x.tipo,
  x.natureza_juridica,
  x.porte_rfb,
  x.capital_social,
  x.situacao_cadastral,
  x.opcao_simples,
  x.data_exclusao_simples,
  x.regime_tributario,
  x.qtd_filiais,
  x.grupo_spes_total,
  x.grupo_spes_24m,
  x.obras_ativas,
  x.obras_iniciadas_24m,
  x.m2_em_execucao,
  x.erp_atual,
  x.erp_mrr,
  x.qtd_usuarios_erp,
  x.funcionarios,
  x.funcionarios_crescimento_12m,
  x.faturamento_estimado,
  x.tem_protesto,
  x.score_credito,
  x.camada,
  x.e_cliente_onepay,
  -- Idade em ANOS, calculada aqui: o catálogo de regras a deriva para uma data
  -- (indexável), mas o perfil precisa do número para faixar e para propor corte.
  case when x.data_inicio_atividade is null then null
       else extract(year from age(current_date, x.data_inicio_atividade))::int end as idade_anos,
  pa.valor_total as protesto_valor_total,
  (c.cnpj is not null and c.status = 'ativo') as certificado_ativo,
  e.tipagem_antecipacao
`

/**
 * Tudo é LEFT JOIN a partir da FONTE DA COORTE, nunca INNER a partir do universo.
 *
 * Foi um bug real, medido: começando por `mercado_explorador`, 4 dos 9
 * fornecedores conversores sumiam da coorte — eles operam de verdade, mas nunca
 * passaram pelo lookup cadastral e por isso não existem no universo. A coorte
 * reportava 5 e ninguém tinha como saber que eram 9.
 *
 * Com LEFT JOIN eles ficam, com as variáveis de empresa nulas — e "nulo" o
 * contraste já sabe tratar: sai do numerador E do denominador, e derruba a
 * COBERTURA, que é exatamente o sinal que o leitor precisa ver.
 */
const JOINS = `
  left join mercado_explorador x on x.cnpj = base.cnpj
  left join protestos_atual pa on pa.cnpj = base.cnpj
  left join certificados c on c.cnpj = base.cnpj
  left join empresas e on e.cnpj = base.cnpj
`

export interface Coorte {
  id: string
  rotulo: string
  linhas: LinhaPerfil[]
}

/**
 * Sacados PESADOS e DORMENTES, dos clientes Onepay.
 *
 * Os dois lados saem de `clientes_onepay`, e é isso que torna esta a comparação
 * com melhor controle da trilha: já são todos clientes, então a diferença não
 * pode ser "um lado foi prospectado e o outro não".
 */
export async function coortesSacados(
  db: Consultavel,
  cfg: ConfigCoortes,
): Promise<{ pesados: Coorte; dormentes: Coorte; medios: Coorte }> {
  const { rows } = await db.query<LinhaPerfil & { coorte: string }>(
    `select ${COLUNAS},
       case
         when coalesce(base.consumed_pct, 0) >= $1
           or coalesce(base.anticipations_last_2m, 0) >= $2 then 'pesados'
         when coalesce(base.days_without_anticipation, 999999) >= $3 then 'dormentes'
         else 'medios'
       end as coorte
     from clientes_onepay base
     ${JOINS}`,
    [cfg.pesado_consumo_pct, cfg.pesado_antecipacoes_2m, cfg.dormente_dias],
  )

  const de = (id: string, rotulo: string): Coorte => ({
    id,
    rotulo,
    linhas: rows.filter((r) => r.coorte === id),
  })

  return {
    pesados: de('pesados', 'sacados pesados'),
    dormentes: de('dormentes', 'sacados dormentes'),
    medios: de('medios', 'sacados de atividade média'),
  }
}

/** Todos os clientes Onepay, para o contraste contra o SOM não-cliente. */
export async function coorteClientes(db: Consultavel): Promise<Coorte> {
  const { rows } = await db.query<LinhaPerfil>(
    `select ${COLUNAS} from clientes_onepay base ${JOINS}`,
  )
  return { id: 'clientes', rotulo: 'clientes', linhas: rows }
}

/**
 * O controle das camadas: SOM que ainda NÃO é cliente.
 *
 * `limit` porque o SOM tem 1.692 hoje mas a régua pode mudar — e um controle de
 * 800 mil linhas não melhora nenhuma prevalência, só derruba o job. O corte é
 * por `cnpj` para ser estável entre execuções: uma amostra que muda de
 * composição a cada mês faria a tendência do snapshot medir a amostra, não o
 * mercado.
 */
export async function coorteSomNaoCliente(
  db: Consultavel,
  limite: number,
): Promise<Coorte> {
  const { rows } = await db.query<LinhaPerfil>(
    `select ${COLUNAS}
     from mercado_explorador base
     ${JOINS}
     where base.camada = 'som'
       and coalesce(base.e_cliente_onepay, false) = false
     order by base.cnpj
     limit $1`,
    [limite],
  )
  return { id: 'som_nao_cliente', rotulo: 'empresas do SOM que ainda não são clientes', linhas: rows }
}

// ─── Trilha de fornecedores ─────────────────────────────────────────────────

/**
 * As agregações de NF por fornecedor.
 *
 * A unidade da trilha é o FORNECEDOR, não a nota — porque a conversão acontece
 * por fornecedor (ele decide antecipar), e contar por nota daria peso 40 a quem
 * emitiu 40 notas e peso 1 a quem emitiu uma. O ticket, o prazo e o número de
 * sacados chegam já agregados na linha.
 */
const AGREGADOS_NF = `
  select
    n.fornecedor_cnpj as cnpj,
    count(*)::int as nf_qtd_vivas,
    count(distinct n.sacado_cnpj)::int as nf_qtd_sacados,
    avg(n.valor)::numeric as nf_ticket_medio,
    avg(n.receita_esperada)::numeric as nf_receita_esperada_media,
    avg(n.vencimento - n.emitida_em::date)::numeric as nf_prazo_medio,
    mode() within group (order by n.tipo) as nf_tipo_predominante,
    mode() within group (order by n.credit_status) as nf_sacado_credito_status,
    mode() within group (order by n.faixa) as nf_faixa_predominante,
    bool_or(coalesce(n.credit_disponivel, 0) >= n.valor) as nf_limite_cobre
  from notas_fiscais n
  group by n.fornecedor_cnpj
`

/**
 * CONVERSORES × EXPOSTOS NÃO-CONVERSORES.
 *
 * O controle é o ponto (§2): os dois lados tiveram NF em faixa no período, ou
 * seja, a MESMA exposição. Comparar conversores contra "todos os fornecedores"
 * mediria sobretudo quem entrou no funil, não quem converte dentro dele — e o
 * achado resultante ("conversores têm mais notas") seria uma tautologia com cara
 * de descoberta.
 */
export async function coortesFornecedores(
  db: Consultavel,
  janelaDias: number,
  limiteControle: number,
): Promise<{ conversores: Coorte; expostos: Coorte }> {
  const conversores = await db.query<LinhaPerfil>(
    `with nf as (${AGREGADOS_NF})
     select ${COLUNAS}, base.nf_qtd_vivas, base.nf_qtd_sacados, base.nf_ticket_medio,
            base.nf_receita_esperada_media, base.nf_prazo_medio, base.nf_tipo_predominante,
            base.nf_sacado_credito_status, base.nf_faixa_predominante, base.nf_limite_cobre
     from nf base
     ${JOINS}
     where exists (
       select 1 from antecipacoes a
       where a.fornecedor_cnpj = base.cnpj
         and a.convertida_em is not null
         and a.convertida_em >= now() - make_interval(days => $1)
     )`,
    [janelaDias],
  )

  const expostos = await db.query<LinhaPerfil>(
    `with nf as (${AGREGADOS_NF})
     select ${COLUNAS}, base.nf_qtd_vivas, base.nf_qtd_sacados, base.nf_ticket_medio,
            base.nf_receita_esperada_media, base.nf_prazo_medio, base.nf_tipo_predominante,
            base.nf_sacado_credito_status, base.nf_faixa_predominante, base.nf_limite_cobre
     from nf base
     ${JOINS}
     where exists (
       select 1 from notas_fiscais n2
       where n2.fornecedor_cnpj = base.cnpj and n2.faixa is not null
     )
     and not exists (
       select 1 from antecipacoes a
       where a.fornecedor_cnpj = base.cnpj
         and a.convertida_em is not null
         and a.convertida_em >= now() - make_interval(days => $1)
     )
     order by base.cnpj
     limit $2`,
    [janelaDias, limiteControle],
  )

  return {
    conversores: {
      id: 'conversores',
      rotulo: 'fornecedores que converteram',
      linhas: conversores.rows,
    },
    expostos: {
      id: 'expostos_nao_conversores',
      rotulo: 'fornecedores expostos que não converteram',
      linhas: expostos.rows,
    },
  }
}
