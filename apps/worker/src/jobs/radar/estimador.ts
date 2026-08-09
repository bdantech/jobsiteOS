// Caminhos específicos, nunca o barrel: ver a nota em funcionarios.ts.
import { EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import {
  MODELOS,
  anoReferenciaEstimativa,
  calibrarEstimador,
  estimarFaturamento,
  origemVence,
  variouOSuficiente,
  type Coeficientes,
} from '../../../../../packages/core/src/radar/faturamento.js'
import type { Json } from '../../../../../packages/core/src/types/database.js'
import { pool, supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'
import { lerConfigFaturamento } from '../../radar/config.js'
import { emitirEvento } from '../../radar/eventos.js'
import { gravarMetrica } from './funcionarios.js'
import { montarAmostra, type AmostraComOrigem, type LinhaAmostra } from './amostras.js'

/**
 * Calibração e estimativa de faturamento (04c §6) — os dois jobs mensais.
 *
 * A ideia inteira cabe numa frase: **os clientes que declaram faturamento são a régua
 * para estimar quem não declara**. A calibração mede, nos declarantes, quanto
 * faturamento cada sinal (funcionários, MRR do ERP, usuários do ERP) costuma
 * significar — e quanto cada um ERRA. A estimativa aplica isso em quem falta.
 *
 * Isso também é o limite honesto do método: ele só funciona enquanto clientes e
 * prospects forem medidos pela MESMA régua, mesmo que torta. O headcount do Apollo
 * subconta canteiro nos dois lados, e é por isso que subcontar não estraga o ratio.
 * No dia em que o cliente tiver headcount do eSocial e o prospect não, o coeficiente
 * calibrado num vira erro sistemático no outro — e ninguém vai notar, porque o número
 * continuará com a mesma cara.
 */

// ─── §6.1 Calibração ────────────────────────────────────────────────────────

interface LinhaSinais {
  cnpj: string
  empresa_id: string | null
  tipo: string | null
  funcionarios: number | null
  erp_mrr: number | null
  qtd_usuarios_erp: number | null
  opcao_simples: boolean | null
  data_exclusao_simples: string | null
  regime_tributario: string | null
}

/**
 * Uma amostra por CNPJ: o faturamento conhecido mais recente, com os sinais de hoje.
 *
 * Declarações antigas não são descartadas da série — só não entram na calibração,
 * porque parear "faturamento de 2023" com "headcount de agora" produziria um ratio
 * que não descreve nenhum dos dois momentos.
 *
 * O faturamento pode vir do cliente (`declarado_cliente`) ou de ranking publicado
 * (`publicacao`, ligado por `usar_amostras_publicadas`). Qual sinal cada procedência
 * pode emprestar é decidido por `montarAmostra`, que é testado — ver amostras.ts.
 */
async function amostrasDeCalibracao(usarPublicadas: boolean): Promise<AmostraComOrigem[]> {
  const { rows } = await pool.query<LinhaAmostra>(
    `
    select distinct on (m.cnpj)
      m.cnpj,
      m.valor,
      m.origem,
      e.tipo,
      e.funcionarios,
      e.funcionarios_origem,
      e.erp_mrr,
      (e.erp_detalhes ->> 'qtd_usuarios')::int as qtd_usuarios_erp
    from empresa_metricas m
    join empresas e on e.id = m.empresa_id
    where m.metrica = 'faturamento_anual'
      and m.valor > 0
      and (m.origem = 'declarado_cliente' or ($1 and m.origem = 'publicacao'))
    -- Declarado vence publicado no mesmo CNPJ: o cliente falando de si é a melhor
    -- verdade que existe, e o distinct on pega a primeira linha da ordenação.
    order by m.cnpj, (m.origem = 'declarado_cliente') desc, m.capturado_em desc
  `,
    [usarPublicadas],
  )

  return rows.map(montarAmostra)
}

export interface ResultadoCalibracaoJob {
  versao: number | null
  amostras: number
  /** Quantas vieram do cliente e quantas de ranking publicado. */
  amostras_por_origem: Record<string, number>
  n_por_tipo: Record<string, number>
  erro_por_modelo: Record<string, number | null>
  motivo?: string
}

export async function calibrarEstimadorJob(): Promise<ResultadoCalibracaoJob> {
  const cfg = await lerConfigFaturamento()
  const amostras = await amostrasDeCalibracao(cfg.usar_amostras_publicadas)

  const porOrigem = amostras.reduce<Record<string, number>>((acc, a) => {
    acc[a.origem_faturamento] = (acc[a.origem_faturamento] ?? 0) + 1
    return acc
  }, {})

  if (amostras.length === 0) {
    // Sem amostra não há régua, e estimar sem régua seria inventar. Falhar
    // explicitamente é o que faz alguém ir preencher o primeiro faturamento.
    logger.warn('Calibração sem amostras: nenhum faturamento conhecido.')
    return {
      versao: null,
      amostras: 0,
      amostras_por_origem: porOrigem,
      n_por_tipo: {},
      erro_por_modelo: {},
      motivo: 'sem_amostras',
    }
  }

  const r = calibrarEstimador(amostras, { nMinimoPorTipo: cfg.n_minimo_calibracao_por_tipo })

  const { data: ultima } = await supabaseAdmin
    .from('estimador_versoes')
    .select('versao')
    .order('versao', { ascending: false })
    .limit(1)
    .maybeSingle()
  const versao = (ultima?.versao ?? 0) + 1

  // Desativa a anterior ANTES de inserir a nova: se a inserção falhar, ficamos sem
  // versão ativa (e o job de estimativa para, ruidosamente) em vez de com duas.
  await supabaseAdmin.from('estimador_versoes').update({ ativa: false }).eq('ativa', true)

  const { error } = await supabaseAdmin.from('estimador_versoes').insert({
    versao,
    coeficientes: r.coeficientes as unknown as Json,
    n_amostras_por_tipo: r.nPorTipo as unknown as Json,
    erro_mediano_por_modelo: r.erroPorModelo as unknown as Json,
    ativa: true,
  })
  if (error) throw new Error(`Falha ao gravar versão do estimador: ${error.message}`)

  await emitirEvento(null, EVENTO_TIPOS.ESTIMADOR_RECALIBRADO, {
    titulo: 'Estimador recalibrado',
    resumo:
      `Versão ${versao}, calibrada em ${amostras.length} empresa(s): ` +
      `${porOrigem.declarado_cliente ?? 0} declaradas pelo cliente` +
      (porOrigem.publicacao ? `, ${porOrigem.publicacao} de ranking publicado` : '') +
      '.',
    url: '/radar/estimador',
    versao,
    amostras: amostras.length,
    amostras_por_origem: porOrigem,
  })

  logger.info(
    { versao, amostras: amostras.length, porOrigem, nPorTipo: r.nPorTipo, erro: r.erroPorModelo },
    'Estimador recalibrado.',
  )
  return {
    versao,
    amostras: amostras.length,
    amostras_por_origem: porOrigem,
    n_por_tipo: r.nPorTipo,
    erro_por_modelo: r.erroPorModelo,
  }
}

// ─── §6.2 Estimativa ────────────────────────────────────────────────────────

export interface ResultadoEstimativaJob {
  versao: number | null
  /** O ano que as estimativas desta rodada preenchem. */
  ano_referencia: number
  avaliadas: number
  estimadas: number
  gravadas: number
  sem_sinal: number
  /** Empresas puladas porque o ano de referência já tem valor real. */
  ja_sabidas: number
  motivo?: string
}

/**
 * Os CNPJs cujo faturamento do ano de referência já é SABIDO — declarado pelo cliente
 * ou publicado num ranking.
 *
 * Um conjunto carregado de uma vez, e não uma consulta por empresa: o loop já faz uma
 * ida ao banco por linha, e a resposta aqui é a mesma para 5 mil delas.
 */
async function cnpjsComValorReal(ano: number): Promise<Set<string>> {
  const { rows } = await pool.query<{ cnpj: string }>(
    `
    select distinct m.cnpj
    from empresa_metricas m
    where m.metrica = 'faturamento_anual'
      and m.origem in ('declarado_cliente', 'publicacao')
      and public.app_ano_referencia_metrica(m.detalhes, m.capturado_em, m.origem) = $1
  `,
    [ano],
  )
  return new Set(rows.map((r) => r.cnpj))
}

/**
 * Estima todas as empresas com pelo menos um sinal.
 *
 * Varre `empresas` (não o universo): o cache vive aqui, e estimar um CNPJ que
 * ninguém promoveu produziria um número sem onde morar. Os sinais do Simples vêm de
 * `mercado_universo` pelo join — é a Receita que sabe se a empresa é optante.
 */
export async function estimarFaturamentoJob(): Promise<ResultadoEstimativaJob> {
  const cfg = await lerConfigFaturamento()
  const ano = anoReferenciaEstimativa()

  const { data: versaoAtiva } = await supabaseAdmin
    .from('estimador_versoes')
    .select('versao, coeficientes')
    .eq('ativa', true)
    .order('calibrado_em', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!versaoAtiva) {
    // Sem calibração não se estima. Um "modelo" com coeficientes inventados
    // preencheria a base inteira de números plausíveis e errados — e plausível é
    // exatamente o que ninguém questiona.
    logger.warn('Estimativa abortada: nenhuma versão ativa do estimador.')
    return {
      versao: null,
      ano_referencia: ano,
      avaliadas: 0,
      estimadas: 0,
      gravadas: 0,
      sem_sinal: 0,
      ja_sabidas: 0,
      motivo: 'sem_calibracao',
    }
  }

  const coef = versaoAtiva.coeficientes as unknown as Coeficientes
  const acc: ResultadoEstimativaJob = {
    versao: versaoAtiva.versao,
    ano_referencia: ano,
    avaliadas: 0,
    estimadas: 0,
    gravadas: 0,
    sem_sinal: 0,
    ja_sabidas: 0,
  }

  // Quem já nos contou (ou publicou) o faturamento deste ano não precisa de chute.
  // E não é só ruído na tela: são justamente os declarantes que formam a régua da
  // calibração — gravar um palpite ao lado da verdade que o calibrou não acrescenta
  // nada e ainda aparece na ficha competindo com ela.
  const sabidos = await cnpjsComValorReal(ano)

  const { rows } = await pool.query<LinhaSinais>(`
    select
      e.cnpj,
      e.id as empresa_id,
      e.tipo,
      e.funcionarios,
      e.funcionarios_origem,
      e.erp_mrr,
      (e.erp_detalhes ->> 'qtd_usuarios')::int as qtd_usuarios_erp,
      u.opcao_simples,
      u.data_exclusao_simples,
      e.regime_tributario
    from empresas e
    left join mercado_universo u on u.cnpj = e.cnpj
    where coalesce(e.funcionarios, 0) > 0
       or coalesce(e.erp_mrr, 0) > 0
       or coalesce((e.erp_detalhes ->> 'qtd_usuarios')::int, 0) > 0
       or coalesce(u.opcao_simples, false)
       or u.data_exclusao_simples is not null
  `)

  for (const linha of rows) {
    acc.avaliadas++

    if (sabidos.has(linha.cnpj)) {
      acc.ja_sabidas++
      continue
    }

    const r = estimarFaturamento(
      {
        tipo: linha.tipo,
        funcionarios: linha.funcionarios,
        erp_mrr: linha.erp_mrr === null ? null : Number(linha.erp_mrr),
        qtd_usuarios_erp: linha.qtd_usuarios_erp,
        opcao_simples: linha.opcao_simples,
        data_exclusao_simples: linha.data_exclusao_simples,
        regime_tributario: linha.regime_tributario,
      },
      coef,
      {
        teto_simples: cfg.teto_simples,
        teto_presumido: cfg.teto_presumido,
        pct_teto_simples_default: cfg.pct_teto_simples_default,
      },
    )

    if (r.valor === null || r.origem === null) {
      acc.sem_sinal++
      continue
    }
    acc.estimadas++

    // O último snapshot de MODELO é a referência da variação — não o valor vigente.
    // Comparar com um valor declarado faria o job regravar todo mês só porque a
    // estimativa nunca vai bater com a declaração.
    const { data: ultimo } = await supabaseAdmin
      .from('empresa_metricas')
      .select('valor')
      .eq('cnpj', linha.cnpj)
      .eq('metrica', 'faturamento_anual')
      .in('origem', ['modelo', 'bracket_simples'])
      .order('capturado_em', { ascending: false })
      .limit(1)
      .maybeSingle()

    const anterior = ultimo ? Number(ultimo.valor) : null
    if (!variouOSuficiente(r.valor, anterior, cfg.variacao_minima_snapshot)) continue

    await gravarMetrica({
      cnpj: linha.cnpj,
      empresaId: linha.empresa_id,
      metrica: 'faturamento_anual',
      valor: r.valor,
      origem: r.origem,
      confianca: r.confianca,
      detalhes: {
        // O ano que esta estimativa preenche. Sem ele, a série mistura "R$ 83M
        // declarado (2025)" com "R$ 154M estimado (?)" e a ficha mostra as duas com a
        // mesma cara de número atual.
        ano,
        versao_estimador: versaoAtiva.versao,
        modelos: r.modelos.map((m) => ({ id: m.id, valor: Math.round(m.valor), peso: Number(m.peso.toFixed(3)) })),
        // As famílias INDEPENDENTES que sustentaram a confiança. Sem isto, uma
        // estimativa 'media' de dois modelos e uma de um modelo ficam
        // indistinguíveis na explicação — e elas não são a mesma coisa.
        familias: r.familias,
        restricoes: r.restricoes,
      },
    })
    acc.gravadas++

    // O evento só sai quando o CACHE muda. Se o valor vigente é declarado, a
    // estimativa entra na série e não vira notificação — ninguém precisa saber que o
    // modelo discordou do cliente.
    const { data: emp } = await supabaseAdmin
      .from('empresas')
      .select('faturamento_origem, faturamento_anual')
      .eq('id', linha.empresa_id ?? '')
      .maybeSingle()

    if (emp && origemVence(r.origem, emp.faturamento_origem)) {
      await emitirEvento(linha.empresa_id, EVENTO_TIPOS.FATURAMENTO_REESTIMADO, {
        titulo: 'Faturamento reestimado',
        resumo:
          anterior === null
            ? `Estimativa inicial para ${ano}: ${moeda(r.valor)} (${r.confianca}).`
            : `Faturamento estimado para ${ano}: ${moeda(anterior)} → ${moeda(r.valor)} (${r.confianca}).`,
        url: linha.empresa_id ? `/empresas/${linha.empresa_id}` : undefined,
        de: anterior,
        para: r.valor,
        origem: r.origem,
        confianca: r.confianca,
        versao_estimador: versaoAtiva.versao,
      })
    }
  }

  logger.info(acc, 'Estimativa de faturamento concluída.')
  return acc
}

function moeda(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

/** Erro mediano por modelo, para a página do Estimador. Exportado para reuso na tool. */
export function erroLegivel(erroPorModelo: Record<string, number | null>): string {
  return MODELOS.map((m) => {
    const e = erroPorModelo[m]
    return `${m}: ${e === null || e === undefined ? '—' : `${(Math.exp(e) * 100 - 100).toFixed(0)}%`}`
  }).join(' · ')
}
