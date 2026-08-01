import { medianaPositiva } from '../credito/economia.js'

/**
 * Calibração com a carteira REAL (04e §5).
 *
 * `taxa_padrao_am`, `prazo_medio_dias` e `valor_medio_nf` são as três constantes
 * que a receita esperada do funil e o valor esperado do Crédito multiplicam.
 * Hoje elas são digitadas: `2,6% a.m.`, `45 dias`, `R$ 25 mil` — números que
 * alguém achou razoáveis um dia. As antecipações concluídas dizem quais eles
 * REALMENTE são.
 *
 * Mediana, não média: uma antecipação de R$ 4 milhões numa carteira de tickets de
 * R$ 30 mil não deve reescrever o ticket médio de ninguém.
 *
 * A função só CALCULA. Aplicar é decisão de operador (§5) — trocar sozinho a
 * constante que define a receita esperada de todo o funil, em cima de um mês
 * atípico, é o tipo de automação que ninguém pede e todo mundo descobre tarde.
 *
 * `medianaPositiva` vem do Crédito porque é a mesma função (descarta zero e
 * negativo) e um segundo "quase igual" é como duas telas passam a discordar.
 */

export interface AmostraCarteira {
  monthly_interest_rate?: number | null
  anticipation_days?: number | null
  gross_value?: number | null
}

export interface ValorCalibrado {
  /** `null` quando não houve amostra suficiente — nunca um número inventado. */
  valor: number | null
  /** Quantas antecipações efetivamente entraram nesta mediana. */
  n: number
}

export interface CalibracaoCarteira {
  taxa_am: ValorCalibrado
  prazo_dias: ValorCalibrado
  valor_medio_nf: ValorCalibrado
  /** Antecipações consideradas na janela. */
  amostras: number
}

/**
 * Mínimo de amostras por métrica. Abaixo disso o resultado é `null` e a tela diz
 * "sem amostra suficiente" — bem melhor que uma mediana de duas linhas
 * apresentada com a mesma confiança de uma de duzentas.
 */
export const N_MINIMO_PADRAO = 5

export function calibrarCarteira(
  amostras: readonly AmostraCarteira[],
  nMinimo: number = N_MINIMO_PADRAO,
): CalibracaoCarteira {
  const calibrar = (valores: readonly (number | null | undefined)[]): ValorCalibrado => {
    const positivos = valores.filter((v): v is number => typeof v === 'number' && v > 0)
    if (positivos.length < nMinimo) return { valor: null, n: positivos.length }
    return { valor: medianaPositiva(positivos), n: positivos.length }
  }

  return {
    taxa_am: calibrar(amostras.map((a) => a.monthly_interest_rate)),
    prazo_dias: calibrar(amostras.map((a) => a.anticipation_days)),
    valor_medio_nf: calibrar(amostras.map((a) => a.gross_value)),
    amostras: amostras.length,
  }
}

/**
 * Quanto a configuração atual se afasta da carteira, em pontos percentuais
 * relativos. É o que decide se a tela mostra "em linha" ou "revisar" — sem isso
 * a comparação vira dois números lado a lado e cada um interpreta o seu.
 */
export function desvioRelativo(
  configurado: number | null | undefined,
  calibrado: number | null | undefined,
): number | null {
  if (typeof configurado !== 'number' || typeof calibrado !== 'number') return null
  if (!(calibrado > 0)) return null
  return ((configurado - calibrado) / calibrado) * 100
}
