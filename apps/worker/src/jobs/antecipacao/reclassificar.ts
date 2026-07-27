import type pg from 'pg'
import { compileFaixaToSql } from '../../../../../packages/core/src/antecipacao/faixas.js'
import { FAIXA_ORDEM, type Faixa } from '../../../../../packages/core/src/antecipacao/schemas.js'
import { formatarMoeda } from '../../../../../packages/core/src/antecipacao/economia.js'
import type { Consultavel } from '../../db.js'
import { logger } from '../../logger.js'
import { notificarPerfis } from '../../radar/eventos.js'
import { lerConfigEconomia, lerConfigFunil } from '../../antecipacao/config.js'

/**
 * Reclassificação + expiração do funil (§4). Roda todo dia e depois de cada sync.
 *
 * SEM ISTO O FUNIL APODRECE EM DUAS SEMANAS: as notas não mudam, o calendário
 * muda. Uma nota que estava em faixa alta com 40 dias de prazo vira, sozinha,
 * uma nota impossível de operar — e continuaria no topo do Kanban ordenada por
 * receita esperada, que também está errada, porque a receita depende do prazo.
 *
 * Em bulk, nunca linha a linha: uma varredura de `notas_funil` atribui a faixa de
 * cada nota numa temp table, e os UPDATEs seguintes tocam só o que MUDOU.
 *
 * A precedência é fixa e vem antes das regras, de propósito:
 *   1. fornecedor suprimido  → fora das faixas (motivo `suprimido`)
 *   2. prazo < minimo_operavel → fora das faixas (motivo `expirada`)
 *   3. alta → boa → media, a primeira que casar
 *   4. nenhuma → fora das faixas (motivo `fora_das_faixas`)
 * Deixar 1 e 2 para as regras significaria repetir as duas condições em cada uma
 * das três — e esquecer numa delas seria mandar mensagem para quem pediu para
 * não ser abordado.
 */

export interface ResultadoReclassificacao {
  avaliadas: number
  faixas_alteradas: number
  por_faixa: Record<string, number>
  expiradas: number
  estagios_expirados: number
  receitas_recalculadas: number
  eventos: number
  pushes_faixa_alta: number
  regras: Record<string, number>
}

interface RegraFaixaAtiva {
  faixa: Faixa
  versao: number
  definicao: unknown
}

async function regrasAtivas(db: Consultavel): Promise<RegraFaixaAtiva[]> {
  const { rows } = await db.query<{ faixa: string; versao: number; definicao: unknown }>(
    'select faixa, versao, definicao from faixa_regras where ativa',
  )
  return rows
    .filter((r): r is { faixa: Faixa; versao: number; definicao: unknown } => r.faixa in FAIXA_ORDEM)
    .sort((a, b) => FAIXA_ORDEM[a.faixa] - FAIXA_ORDEM[b.faixa])
}

/** compileFaixaToSql sempre numera de $1. Emendar três regras exige renumerar. */
function deslocarPlaceholders(texto: string, deslocamento: number): string {
  if (deslocamento === 0) return texto
  return texto.replace(/\$(\d+)/g, (_, n: string) => `$${Number(n) + deslocamento}`)
}

interface ExpressaoFaixa {
  /** CASE que devolve a faixa (ou null) sobre as colunas de notas_funil. */
  sqlFaixa: string
  /** CASE paralelo que devolve o MOTIVO — a explicação de "sumiu do Kanban". */
  sqlMotivo: string
  values: unknown[]
  versoes: Record<string, number>
}

export function expressaoFaixa(
  regras: readonly RegraFaixaAtiva[],
  minimoOperavel: number,
  hoje: Date = new Date(),
): ExpressaoFaixa {
  const values: unknown[] = []
  const versoes: Record<string, number> = {}
  const quandosFaixa: string[] = []
  const quandosMotivo: string[] = []

  // $1 é sempre o mínimo operável, para que as duas expressões o compartilhem.
  values.push(minimoOperavel)
  const guardas =
    'when fornecedor_suprimido then %s ' +
    'when dias_para_vencimento is null or dias_para_vencimento < $1 then %s '

  quandosFaixa.push(guardas.replace(/%s/g, 'null::text'))
  quandosMotivo.push(guardas.replace('%s', `'suprimido'`).replace('%s', `'expirada'`))

  for (const regra of regras) {
    const { text, values: v } = compileFaixaToSql(regra.definicao, hoje)
    const deslocado = deslocarPlaceholders(text, values.length)
    quandosFaixa.push(`when ${deslocado} then '${regra.faixa}' `)
    quandosMotivo.push(`when ${deslocado} then 'regra' `)
    values.push(...v)
    versoes[regra.faixa] = regra.versao
  }

  return {
    sqlFaixa: `case ${quandosFaixa.join('')} else null::text end`,
    sqlMotivo: `case ${quandosMotivo.join('')} else 'fora_das_faixas' end`,
    values,
    versoes,
  }
}

export async function reclassificarFunil(client: pg.Client): Promise<ResultadoReclassificacao> {
  const [cfgFunil, cfgEconomia, regras] = await Promise.all([
    lerConfigFunil(),
    lerConfigEconomia(),
    regrasAtivas(client),
  ])

  const { sqlFaixa, sqlMotivo, values, versoes } = expressaoFaixa(
    regras,
    cfgFunil.minimo_operavel_dias,
  )

  logger.info({ regras: versoes, minimo: cfgFunil.minimo_operavel_dias }, 'Reclassificando o funil.')

  // ── 1. O calendário andou: prazo e receita esperada primeiro. A receita usa a
  // taxa que JÁ foi gravada na nota (taxa_usada), caindo no padrão quando não há
  // — recalcular a taxa aqui reescreveria a economia de uma nota sem que nenhum
  // dado de crédito tivesse mudado.
  const recalculo = await client.query(
    `update notas_fiscais set
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

  // ── 2. Uma varredura: a faixa e o motivo de cada nota, numa temp table.
  await client.query('drop table if exists stg_faixa')
  await client.query(
    'create temp table stg_faixa (access_key text primary key, faixa text, motivo text)',
  )
  await client.query(
    `insert into stg_faixa (access_key, faixa, motivo)
     select access_key, (${sqlFaixa})::text, (${sqlMotivo})::text
     from notas_funil
     where estagio_funil not in ('convertida', 'perdida')`,
    values,
  )
  await client.query('analyze stg_faixa')

  const { rows: distribuicao } = await client.query<{ faixa: string | null; total: number }>(
    'select faixa, count(*)::int as total from stg_faixa group by faixa',
  )
  const porFaixa: Record<string, number> = {}
  let avaliadas = 0
  for (const r of distribuicao) {
    porFaixa[r.faixa ?? 'sem_faixa'] = r.total
    avaliadas += r.total
  }

  // ── 3. Eventos ANTES do update: precisam da faixa ANTIGA. Só para notas cujo
  // fornecedor existe em `empresas` — uma nota de fornecedor sem cadastro não tem
  // timeline onde escrever.
  const eventos = await client.query(
    `insert into empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
     select
       nf.fornecedor_empresa_id,
       case when s.faixa is null and s.motivo = 'expirada' then 'nf.expirada' else 'nf.faixa_alterada' end,
       jsonb_build_object(
         'titulo', case
           when s.faixa is null and s.motivo = 'expirada' then 'Nota expirada'
           when s.faixa is null then 'Nota saiu das faixas'
           else 'Nota entrou na faixa ' || s.faixa
         end,
         'resumo', coalesce(nf.fornecedor_nome, nf.fornecedor_cnpj) || ': nota de R$ '
                   || to_char(nf.valor, 'FM999G999G990D00') || ' — faixa '
                   || coalesce(nf.faixa, 'nenhuma') || ' → ' || coalesce(s.faixa, 'nenhuma')
                   || ' (' || s.motivo || ').',
         'url', '/antecipacao?nota=' || nf.access_key,
         'access_key', nf.access_key,
         'de', nf.faixa,
         'para', s.faixa,
         'motivo', s.motivo,
         'regra_versao', ($1::jsonb ->> s.faixa)::int,
         'valor', nf.valor,
         'receita_esperada', nf.receita_esperada
       ),
       null
     from notas_fiscais nf
     join stg_faixa s on s.access_key = nf.access_key
     where nf.faixa is distinct from s.faixa
       and nf.fornecedor_empresa_id is not null`,
    [JSON.stringify(versoes)],
  )

  // Coletado ANTES do update: depois dele, "entrou na faixa alta agora" não é mais
  // uma pergunta que o banco possa responder.
  const entradasAlta = await coletarFaixaAlta(client)

  const atualizadas = await client.query(
    `update notas_fiscais nf set
       faixa = s.faixa,
       faixa_motivo = s.motivo,
       faixa_regra_versao = ($1::jsonb ->> s.faixa)::int,
       faixa_alterada_em = now()
     from stg_faixa s
     where s.access_key = nf.access_key
       and (nf.faixa is distinct from s.faixa or nf.faixa_motivo is distinct from s.motivo)`,
    [JSON.stringify(versoes)],
  )

  // ── 4. Expiração do ESTÁGIO. Sair da faixa não é o mesmo que sair do funil:
  // uma nota que apenas deixou de casar a regra continua a_prospectar (a regra
  // pode voltar a casar amanhã). Mas uma nota que EXPIROU e estava em prospecção
  // ativa acabou — e precisa sair do Kanban com o motivo à vista.
  const estagios = await client.query(
    `update notas_fiscais nf set
       estagio_funil = 'expirada',
       estagio_alterado_em = now()
     from stg_faixa s
     where s.access_key = nf.access_key
       and s.motivo = 'expirada'
       and nf.estagio_funil in ('a_prospectar', 'em_prospeccao', 'em_negociacao', 'antecipacao_andamento')`,
  )

  const expiradas = await client.query<{ total: number }>(
    `select count(*)::int as total from stg_faixa where motivo = 'expirada'`,
  )

  const limites = await sinalizarLimiteInsuficiente(client)
  const pushes = await notificarFaixaAlta(entradasAlta)

  const resultado: ResultadoReclassificacao = {
    avaliadas,
    faixas_alteradas: atualizadas.rowCount ?? 0,
    por_faixa: porFaixa,
    expiradas: expiradas.rows[0]?.total ?? 0,
    estagios_expirados: estagios.rowCount ?? 0,
    receitas_recalculadas: recalculo.rowCount ?? 0,
    eventos: (eventos.rowCount ?? 0) + limites,
    pushes_faixa_alta: pushes,
    regras: versoes,
  }

  logger.info(resultado, 'Reclassificação do funil concluída.')
  return resultado
}

/**
 * Push para o Comercial quando uma nota ENTRA na faixa alta (§7).
 *
 * Por que aqui e não numa regra de `notificacao_regras`: o gatilho de fan-out casa
 * apenas o TIPO do evento, não o payload — uma regra em `nf.faixa_alterada`
 * dispararia também ao sair da faixa e ao entrar em média, e num sync 6× ao dia
 * isso é ruído suficiente para o time desligar as notificações. E o gatilho não faz
 * push: ele grava o sino e para. Push é notify(), que precisa do service role.
 *
 * Uma notificação por RODADA, agrupada, com deep link para o funil. Uma por nota
 * transformaria um sync de 40 notas novas em 40 buzinas no bolso do vendedor.
 */
interface EntradasFaixaAlta {
  total: number
  valor: number
  receita: number
  access_key: string | null
  fornecedor: string | null
}

/**
 * Precisa rodar ANTES do UPDATE: depois dele `notas_fiscais.faixa` já é igual a
 * `stg_faixa.faixa` e o "entrou agora" deixa de ser expressável.
 */
async function coletarFaixaAlta(client: pg.Client): Promise<EntradasFaixaAlta | null> {
  const { rows } = await client.query<EntradasFaixaAlta>(
    `select
       count(*)::int as total,
       coalesce(sum(nf.valor), 0)::numeric as valor,
       coalesce(sum(nf.receita_esperada), 0)::numeric as receita,
       (array_agg(nf.access_key order by nf.receita_esperada desc nulls last))[1] as access_key,
       (array_agg(coalesce(nf.fornecedor_nome, nf.fornecedor_cnpj)
                  order by nf.receita_esperada desc nulls last))[1] as fornecedor
     from notas_fiscais nf
     join stg_faixa s on s.access_key = nf.access_key
     where s.faixa = 'alta'
       and nf.faixa is distinct from s.faixa`,
  )
  const r = rows[0]
  return r && r.total > 0 ? r : null
}

async function notificarFaixaAlta(r: EntradasFaixaAlta | null): Promise<number> {
  if (!r) return 0

  const titulo =
    r.total === 1 ? 'Nova nota em faixa alta' : `${r.total} novas notas em faixa alta`
  const corpo =
    r.total === 1
      ? `${r.fornecedor ?? 'Fornecedor'}: ${formatarMoeda(Number(r.valor))}, receita esperada ${formatarMoeda(Number(r.receita))}.`
      : `${formatarMoeda(Number(r.valor))} em notas, receita esperada ${formatarMoeda(Number(r.receita))}. A maior é de ${r.fornecedor ?? '—'}.`

  await notificarPerfis(['Comercial', 'Admin'], {
    titulo,
    corpo,
    // Deep link: no mobile o linking resolve /antecipacao contra a aba do módulo, e
    // `?nota=` leva ao card. Uma notificação sem destino é uma notificação que
    // obriga a pessoa a procurar do que ela estava falando.
    url: r.total === 1 && r.access_key ? `/antecipacao?nota=${r.access_key}` : '/antecipacao',
  })

  return r.total
}

/**
 * `sacado.limite_insuficiente` (§7): a demanda do pipeline contra uma construtora
 * passou do limite disponível dela. É o sinal para o time de Crédito agir ANTES
 * de o comercial vender algo que não cabe.
 *
 * Emitido no máximo uma vez por dia por sacado: o job roda 7× ao dia (diário +
 * pós-sync) e um evento por execução viraria spam no sino de quem mais precisa
 * dele.
 */
async function sinalizarLimiteInsuficiente(client: pg.Client): Promise<number> {
  const r = await client.query(
    `insert into empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
     select
       s.sacado_empresa_id,
       'sacado.limite_insuficiente',
       jsonb_build_object(
         'titulo', 'Limite do sacado insuficiente',
         'resumo', coalesce(s.sacado_nome, s.sacado_cnpj) || ': pipeline de R$ '
                   || to_char(s.demanda_pipeline, 'FM999G999G990D00') || ' contra limite disponível de R$ '
                   || to_char(coalesce(s.available_limit, 0), 'FM999G999G990D00') || '.',
         'url', '/antecipacao/sacados',
         'cnpj', s.sacado_cnpj,
         'demanda', s.demanda_pipeline,
         'disponivel', coalesce(s.available_limit, 0),
         'excedente', s.demanda_pipeline - coalesce(s.available_limit, 0)
       ),
       null
     from antecipacao_sacados s
     where s.demanda_pipeline > coalesce(s.available_limit, 0)
       and not exists (
         select 1 from empresa_eventos e
         where e.tipo = 'sacado.limite_insuficiente'
           and e.payload ->> 'cnpj' = s.sacado_cnpj
           and e.criado_em > now() - interval '1 day'
       )`,
  )
  return r.rowCount ?? 0
}
