import type pg from 'pg'
import { FAIXA_ORDEM, type Faixa } from '../../../../../packages/core/src/antecipacao/schemas.js'
import { lerConfigEconomia, lerConfigFunil } from '../../antecipacao/config.js'
import { logger } from '../../logger.js'
import { expressaoFaixa } from '../antecipacao/reclassificar.js'

/**
 * A FAIXA das duas fontes novas (04s) — pelo MESMO motor, sobre a MESMA projeção.
 *
 * ── POR QUE UM ARQUIVO SEPARADO, E NÃO UM PARÂMETRO NO OUTRO ────────────────
 * `jobs/antecipacao/reclassificar.ts` é o funil de NFs, e o Prompt é explícito:
 * o funil atual não pode ser alterado. Generalizá-lo para três tabelas mexeria em
 * cada UPDATE que hoje roda sobre dezenas de milhares de notas por noite — para
 * ganhar o quê, uma função em vez de duas.
 *
 * O que NÃO se duplica é a decisão: `expressaoFaixa` é importada de lá. As regras
 * são dado gravado em `faixa_regras`, compiladas uma vez, e as três fontes são
 * classificadas pela mesma expressão SQL sobre as mesmas colunas. Se duas cópias
 * da regra existissem, uma pré-autorização e a NF dela poderiam cair em faixas
 * diferentes — e o funil passaria a discordar de si mesmo na mesma tela.
 *
 * ── A PRECEDÊNCIA É A MESMA, E VEM ANTES DAS REGRAS ─────────────────────────
 *   1. fornecedor suprimido    → fora das faixas
 *   2. prazo < mínimo operável → fora das faixas (`expirada`)
 *   3. alta → boa → media, a primeira que casar
 *   4. nenhuma                 → fora das faixas
 */

export interface ResultadoReclassificacaoOportunidades {
  pre_autorizacoes: { avaliadas: number; alteradas: number; expiradas: number }
  titulos: { avaliadas: number; alteradas: number; expiradas: number }
  por_faixa: Record<string, number>
}

interface RegraFaixaAtiva {
  faixa: Faixa
  versao: number
  definicao: unknown
}

async function regrasAtivas(db: pg.Client): Promise<RegraFaixaAtiva[]> {
  const { rows } = await db.query<{ faixa: string; versao: number; definicao: unknown }>(
    'select faixa, versao, definicao from faixa_regras where ativa',
  )
  return rows
    .filter((r): r is RegraFaixaAtiva => r.faixa in FAIXA_ORDEM)
    .sort((a, b) => FAIXA_ORDEM[a.faixa] - FAIXA_ORDEM[b.faixa])
}

/** As duas tabelas, e como cada uma se identifica na projeção. */
const FONTES = [
  { tipo: 'pre_autorizacao', tabela: 'pre_autorizacoes', chave: 'id_externo' },
  { tipo: 'titulo', tabela: 'sienge_titulos', chave: 'id_externo' },
] as const

export async function reclassificarOportunidades(
  client: pg.Client,
): Promise<ResultadoReclassificacaoOportunidades> {
  const [cfgFunil, cfgEconomia, regras] = await Promise.all([
    lerConfigFunil(),
    lerConfigEconomia(),
    regrasAtivas(client),
  ])

  const { sqlFaixa, sqlMotivo, values, versoes } = expressaoFaixa(
    regras,
    cfgFunil.minimo_operavel_dias,
  )

  const acc: ResultadoReclassificacaoOportunidades = {
    pre_autorizacoes: { avaliadas: 0, alteradas: 0, expiradas: 0 },
    titulos: { avaliadas: 0, alteradas: 0, expiradas: 0 },
    por_faixa: {},
  }

  for (const fonte of FONTES) {
    /*
     * 1. O calendário andou. Prazo e receita esperada primeiro, porque a faixa
     *    depende dos dois — e a receita usa a taxa JÁ GRAVADA, caindo no padrão
     *    quando não há. Recalcular a taxa aqui reescreveria a economia sem que
     *    nenhum dado de crédito tivesse mudado.
     */
    await client.query(
      `update ${fonte.tabela} set
         dias_para_vencimento = (vencimento - current_date)::int,
         receita_esperada = case
           when vencimento is null then null
           when (vencimento - current_date) <= 0 then 0
           else round(valor * (coalesce(taxa_usada, $1::numeric) / 100)
                      * ((vencimento - current_date)::numeric / 30), 2)
         end
       where estagio_funil not in ('convertida', 'perdida')
         and (dias_para_vencimento is distinct from (vencimento - current_date)::int
              or receita_esperada is null)`,
      [cfgEconomia.taxa_mensal_padrao],
    )

    // 2. Uma varredura da PROJEÇÃO: faixa e motivo de cada item, numa temp table.
    await client.query('drop table if exists stg_faixa_op')
    await client.query(
      'create temp table stg_faixa_op (id text primary key, faixa text, motivo text)',
    )
    await client.query(
      `insert into stg_faixa_op (id, faixa, motivo)
       select id, (${sqlFaixa})::text, (${sqlMotivo})::text
       from funil_oportunidades
       where tipo = '${fonte.tipo}'
         and estagio_funil not in ('convertida', 'perdida')`,
      values,
    )
    await client.query('analyze stg_faixa_op')

    const { rows: distribuicao } = await client.query<{ faixa: string | null; total: number }>(
      'select faixa, count(*)::int as total from stg_faixa_op group by faixa',
    )
    const alvo = fonte.tipo === 'titulo' ? acc.titulos : acc.pre_autorizacoes
    for (const r of distribuicao) {
      const chave = r.faixa ?? 'sem_faixa'
      acc.por_faixa[chave] = (acc.por_faixa[chave] ?? 0) + r.total
      alvo.avaliadas += r.total
    }

    // 3. Só o que MUDOU. Reescrever tudo faria `faixa_alterada_em` deixar de
    //    significar qualquer coisa — e é essa data que explica um card que subiu.
    const alteradas = await client.query(
      `update ${fonte.tabela} t set
         faixa = s.faixa,
         faixa_motivo = s.motivo,
         faixa_regra_versao = ($1::jsonb ->> s.faixa)::int,
         faixa_alterada_em = now()
       from stg_faixa_op s
       where s.id = t.${fonte.chave}::text
         and (t.faixa is distinct from s.faixa or t.faixa_motivo is distinct from s.motivo)`,
      [JSON.stringify(versoes)],
    )
    alvo.alteradas = alteradas.rowCount ?? 0

    /*
     * 4. Expiração do ESTÁGIO — e sair da faixa não é sair do funil.
     *
     * Um item que apenas deixou de casar a regra continua `a_prospectar`: a regra
     * pode voltar a casar amanhã. Mas um que EXPIROU e estava em prospecção ativa
     * acabou, e precisa sair do Kanban com o motivo à vista.
     */
    const expiradas = await client.query(
      `update ${fonte.tabela} t set
         estagio_funil = 'expirada',
         estagio_alterado_em = now()
       from stg_faixa_op s
       where s.id = t.${fonte.chave}::text
         and s.motivo = 'expirada'
         and t.estagio_funil in ('a_prospectar', 'em_prospeccao', 'em_negociacao',
                                 'antecipacao_andamento')`,
    )
    alvo.expiradas = expiradas.rowCount ?? 0
  }

  await client.query('drop table if exists stg_faixa_op')
  logger.info(acc, 'Reclassificação das fontes novas do funil concluída.')
  return acc
}
