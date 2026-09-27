import type { EstadoDisjuntor } from './schemas.js'

/**
 * O DISJUNTOR (Prompt 09 §9.2). Não é aprovação humana — é parada automática. Ninguém
 * precisa vigiar, mas o agente não corre uma semana ladeira abaixo.
 *
 * ─── A JANELA É POR CONTAGEM, NÃO POR TEMPO ─────────────────────────────────
 * "Das últimas 20 ações, 3 geraram supressão" é um fato sobre o comportamento do agente.
 * "Na última hora, 1 supressão em 2 ações" é ruído: com volume baixo, taxa por hora engana,
 * e o disjuntor abriria na primeira recusa da segunda-feira. Por isso: JANELA INCOMPLETA
 * NÃO ABRE — com menos ações que a janela, não há taxa, só anedota.
 *
 * ─── SÓ AS AÇÕES QUE TÊM DESFECHO CONTAM ────────────────────────────────────
 * Consultar a agenda ou ler o histórico não diz nada sobre como o agente está tratando as
 * pessoas. Contam as ações com `sinal` diferente de `neutro` — mensagem que saiu (ou foi
 * recusada), ligação que voltou, escalação, falha técnica.
 *
 * ─── ULTRAPASSOU, ABRE. ABERTO, SÓ UMA PESSOA FECHA ─────────────────────────
 * Qualquer taxa ESTRITAMENTE acima do limiar abre (no limiar exato, não). Aberto, o
 * disjuntor fica aberto até uma reabertura manual registrada (`app_agentes_reabrir_
 * disjuntor`), que também zera a janela — senão as mesmas ações o reabririam no ciclo
 * seguinte. Em alerta (acima de 75% de algum limiar) ele não para nada: só aparece no
 * cartão do agente.
 */

export type SinalAcao = 'neutro' | 'ok' | 'supressao' | 'sem_interesse' | 'escalacao' | 'falha_tecnica'

export interface ConfigDisjuntor {
  janela_acoes: number
  limiar_supressao: number
  limiar_sem_interesse: number
  limiar_escalacao: number
  limiar_falha_tecnica: number
}

export type MetricaDisjuntor = 'supressao' | 'sem_interesse' | 'escalacao' | 'falha_tecnica'

export const METRICA_DISJUNTOR_LABELS: Record<MetricaDisjuntor, string> = {
  supressao: 'pedidos de supressão',
  sem_interesse: 'recusas sem interesse',
  escalacao: 'escalações para humano',
  falha_tecnica: 'falhas técnicas',
}

export interface AvaliacaoDisjuntor {
  estado: EstadoDisjuntor
  /** Presente quando abriu nesta avaliação: a métrica, a taxa e o limiar. */
  motivo?: string
  metrica?: MetricaDisjuntor
  /** Taxas da janela, para o cartão do agente. Nulo com janela incompleta. */
  taxas: Record<MetricaDisjuntor, number> | null
  acoesNaJanela: number
}

/** Fração de "alerta": acima disto de qualquer limiar, o cartão acende. */
const FRACAO_ALERTA = 0.75

export function avaliarDisjuntor(args: {
  /** Sinais das ações desde `janela_desde`, MAIS RECENTE PRIMEIRO. */
  sinais: readonly SinalAcao[]
  config: ConfigDisjuntor
  estadoAtual: EstadoDisjuntor
}): AvaliacaoDisjuntor {
  const comDesfecho = args.sinais.filter((s) => s !== 'neutro')
  const janela = comDesfecho.slice(0, args.config.janela_acoes)

  if (args.estadoAtual === 'aberto') {
    return { estado: 'aberto', taxas: taxasDe(janela), acoesNaJanela: janela.length }
  }
  if (janela.length < args.config.janela_acoes) {
    return { estado: 'ok', taxas: null, acoesNaJanela: janela.length }
  }

  const taxas = taxasDe(janela)!
  const limiares: Record<MetricaDisjuntor, number> = {
    supressao: args.config.limiar_supressao,
    sem_interesse: args.config.limiar_sem_interesse,
    escalacao: args.config.limiar_escalacao,
    falha_tecnica: args.config.limiar_falha_tecnica,
  }

  // A ordem de prioridade do motivo é a do dano: supressão primeiro.
  for (const m of ['supressao', 'sem_interesse', 'escalacao', 'falha_tecnica'] as const) {
    if (taxas[m] > limiares[m] + 1e-9) {
      return {
        estado: 'aberto',
        metrica: m,
        motivo:
          `${METRICA_DISJUNTOR_LABELS[m]}: ${Math.round(taxas[m] * 100)}% das últimas ${janela.length} ações ` +
          `(limite ${Math.round(limiares[m] * 100)}%).`,
        taxas,
        acoesNaJanela: janela.length,
      }
    }
  }

  const alerta = (Object.keys(limiares) as MetricaDisjuntor[]).some((m) => taxas[m] > limiares[m] * FRACAO_ALERTA)
  return { estado: alerta ? 'alerta' : 'ok', taxas, acoesNaJanela: janela.length }
}

function taxasDe(janela: readonly SinalAcao[]): Record<MetricaDisjuntor, number> | null {
  if (janela.length === 0) return null
  const conta = (s: SinalAcao) => janela.filter((x) => x === s).length / janela.length
  return {
    supressao: conta('supressao'),
    sem_interesse: conta('sem_interesse'),
    escalacao: conta('escalacao'),
    falha_tecnica: conta('falha_tecnica'),
  }
}
