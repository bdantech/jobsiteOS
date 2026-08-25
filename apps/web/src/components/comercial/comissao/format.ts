/**
 * Formatação da tela de comissão.
 *
 * Vive num arquivo só porque o extrato, o simulador e o painel mostram os MESMOS números
 * — e um `toLocaleString` copiado com opção diferente é como a mesma cessão aparece
 * como R$ 450,00 numa tela e R$ 450 na outra, fazendo alguém conferir a conta à mão.
 */

export const brl = (n: number | null | undefined): string =>
  Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** Sem centavos: volumes na casa dos milhões não ganham nada com eles. */
export const brlCurto = (n: number | null | undefined): string =>
  Number(n ?? 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  })

export const numero = (n: number | null | undefined, casas = 0): string =>
  Number(n ?? 0).toLocaleString('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  })

export const data = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleDateString('pt-BR') : '—'

export const dataHora = (iso: string | null | undefined): string =>
  iso
    ? new Date(iso).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—'

/** `2026-08-01` → `ago/2026`. A competência é um MÊS, e um dia 1º ali só distrai. */
export const mesDaCompetencia = (competencia: string): string => {
  if (!competencia) return '—'
  const d = new Date(`${competencia.slice(0, 10)}T12:00:00`)
  return d.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).replace('. de', '/')
}

/** A variação contra o mês anterior, já com sinal e com o caso "de zero para algo". */
export function variacao(atual: number, anterior: number): { texto: string; positiva: boolean } | null {
  if (anterior === 0) return atual === 0 ? null : { texto: 'primeiro mês com lançamento', positiva: atual > 0 }
  const pct = ((atual - anterior) / Math.abs(anterior)) * 100
  return {
    texto: `${pct >= 0 ? '+' : ''}${numero(pct, 1)}% vs. mês anterior`,
    positiva: pct >= 0,
  }
}
