import {
  EVENTO_TIPOS,
  MODELOS,
  calibrarEstimador,
  estimarFaturamento,
  origemVence,
  variouOSuficiente,
  type AmostraCalibracao,
  type Coeficientes,
} from '../../../../../packages/core/src/index.js'
import type { Json } from '../../../../../packages/core/src/types/database.js'
import { pool, supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'
import { lerConfigFaturamento } from '../../radar/config.js'
import { emitirEvento } from '../../radar/eventos.js'
import { gravarMetrica } from './funcionarios.js'

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
 * Uma amostra por CNPJ: o snapshot declarado mais recente, com os sinais de hoje.
 *
 * Declarações antigas não são descartadas da série — só não entram na calibração,
 * porque parear "faturamento de 2023" com "headcount de agora" produziria um ratio
 * que não descreve nenhum dos dois momentos.
 */
async function amostrasDeclaradas(): Promise<AmostraCalibracao[]> {
  const { rows } = await pool.query<{
    cnpj: string
    valor: string
    tipo: string | null
    funcionarios: number | null
    erp_mrr: string | null
    qtd_usuarios_erp: number | null
  }>(`
    select distinct on (m.cnpj)
      m.cnpj,
      m.valor,
      e.tipo,
      e.funcionarios,
      e.erp_mrr,
      (e.erp_detalhes ->> 'qtd_usuarios')::int as qtd_usuarios_erp
    from empresa_metricas m
    join empresas e on e.id = m.empresa_id
    where m.metrica = 'faturamento_anual'
      and m.origem = 'declarado_cliente'
      and m.valor > 0
    order by m.cnpj, m.capturado_em desc
  `)

  return rows.map((r) => ({
    tipo: r.tipo,
    faturamento_declarado: Number(r.valor),
    funcionarios: r.funcionarios,
    erp_mrr: r.erp_mrr === null ? null : Number(r.erp_mrr),
    qtd_usuarios_erp: r.qtd_usuarios_erp,
  }))
}

export interface ResultadoCalibracaoJob {
  versao: number | null
  amostras: number
  n_por_tipo: Record<string, number>
  erro_por_modelo: Record<string, number | null>
  motivo?: string
}

export async function calibrarEstimadorJob(): Promise<ResultadoCalibracaoJob> {
  const cfg = await lerConfigFaturamento()
  const amostras = await amostrasDeclaradas()

  if (amostras.length === 0) {
    // Sem declarante não há régua, e estimar sem régua seria inventar. Falhar
    // explicitamente é o que faz alguém ir preencher o primeiro faturamento.
    logger.warn('Calibração sem amostras: nenhum cliente com faturamento declarado.')
    return { versao: null, amostras: 0, n_por_tipo: {}, erro_por_modelo: {}, motivo: 'sem_amostras' }
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
    resumo: `Versão ${versao}, calibrada em ${amostras.length} cliente(s) com faturamento declarado.`,
    url: '/settings/estimador',
    versao,
    amostras: amostras.length,
  })

  logger.info({ versao, amostras: amostras.length, nPorTipo: r.nPorTipo }, 'Estimador recalibrado.')
  return {
    versao,
    amostras: amostras.length,
    n_por_tipo: r.nPorTipo,
    erro_por_modelo: r.erroPorModelo,
  }
}

// ─── §6.2 Estimativa ────────────────────────────────────────────────────────

export interface ResultadoEstimativaJob {
  versao: number | null
  avaliadas: number
  estimadas: number
  gravadas: number
  sem_sinal: number
  motivo?: string
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
    return { versao: null, avaliadas: 0, estimadas: 0, gravadas: 0, sem_sinal: 0, motivo: 'sem_calibracao' }
  }

  const coef = versaoAtiva.coeficientes as unknown as Coeficientes
  const acc: ResultadoEstimativaJob = {
    versao: versaoAtiva.versao,
    avaliadas: 0,
    estimadas: 0,
    gravadas: 0,
    sem_sinal: 0,
  }

  const { rows } = await pool.query<LinhaSinais>(`
    select
      e.cnpj,
      e.id as empresa_id,
      e.tipo,
      e.funcionarios,
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
        versao_estimador: versaoAtiva.versao,
        modelos: r.modelos.map((m) => ({ id: m.id, valor: Math.round(m.valor), peso: Number(m.peso.toFixed(3)) })),
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
            ? `Estimativa inicial: ${moeda(r.valor)} (${r.confianca}).`
            : `Faturamento estimado: ${moeda(anterior)} → ${moeda(r.valor)} (${r.confianca}).`,
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
