import type { Supabase } from '../registry/types.js'

/**
 * O que o limite consumido na plataforma diz sobre os vencidos de um grupo (0270, 0273).
 *
 * Nasceu como ESTIMATIVA do pago, quando `titulos` vinha de `antecipacoes` e a
 * antecipação paga continuava `BILLET_SWAPPED`. Desde 0273 os títulos vêm com a
 * liquidação da produção, e a mesma conta virou CONFERÊNCIA: `consumido − a vencer`
 * contra o vencido que temos em aberto. Grupo "em dia" agora é vencido que a produção
 * ainda não baixou — ou que o limite já liberou. É do GRUPO: diz QUANTO, não QUAIS.
 */

export const SITUACOES_RECONCILIACAO = ['em_dia', 'parcial', 'confirma', 'sem_dado', 'sem_vencidos'] as const
export type SituacaoReconciliacao = (typeof SITUACOES_RECONCILIACAO)[number]

export const SITUACAO_RECONCILIACAO_LABELS: Record<SituacaoReconciliacao, string> = {
  em_dia: 'Em dia pela plataforma',
  parcial: 'Parte do vencido já foi paga',
  confirma: 'Plataforma confirma o vencido',
  sem_dado: 'Sem dado da plataforma',
  sem_vencidos: 'Sem vencidos',
}

export interface ReconciliacaoGrupo {
  sacado_matriz_cnpj: string
  aberto: number
  vencido: number
  a_vencer: number
  qtd_vencidos: number
  consumido: number | null
  consumido_em: string | null
  /** Vencido realmente em aberto, estimado. `null` quando a plataforma não tem o grupo. */
  vencido_estimado: number | null
  situacao: SituacaoReconciliacao
}

const num = (v: unknown): number => Number(v ?? 0)
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

function situacaoDe(v: unknown): SituacaoReconciliacao {
  return (SITUACOES_RECONCILIACAO as readonly string[]).includes(String(v)) ? (v as SituacaoReconciliacao) : 'sem_dado'
}

/** Um grupo, ou todos (`matrizes` omitido). O mapa é por `sacado_matriz_cnpj`. */
export async function buscarReconciliacaoCobranca(
  supabase: Supabase,
  matrizes?: readonly string[],
): Promise<Map<string, ReconciliacaoGrupo>> {
  const { data, error } = await supabase.rpc('app_cobranca_reconciliacao', {
    p_matrizes: matrizes ? [...matrizes] : null,
  })
  if (error) throw new Error(error.message)
  const mapa = new Map<string, ReconciliacaoGrupo>()
  for (const r of data ?? []) {
    mapa.set(r.sacado_matriz_cnpj, {
      sacado_matriz_cnpj: r.sacado_matriz_cnpj,
      aberto: num(r.aberto),
      vencido: num(r.vencido),
      a_vencer: num(r.a_vencer),
      qtd_vencidos: num(r.qtd_vencidos),
      consumido: numOuNull(r.consumido),
      consumido_em: r.consumido_em,
      vencido_estimado: numOuNull(r.vencido_estimado),
      situacao: situacaoDe(r.situacao),
    })
  }
  return mapa
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

/** A frase que a tela e as tools mostram — com os números, para a pessoa conferir a conta. */
export function explicarReconciliacao(r: ReconciliacaoGrupo): string {
  switch (r.situacao) {
    case 'sem_vencidos':
      return 'O grupo não tem títulos vencidos.'
    case 'sem_dado':
      return (
        'A plataforma não tem limite registrado para este grupo: não há como confirmar se os vencidos ' +
        'foram pagos. Confira com a produção antes de cobrar.'
      )
    case 'em_dia':
      return (
        `A plataforma registra ${brl(r.consumido ?? 0)} de limite consumido, e ${brl(r.a_vencer)} ainda vão vencer: ` +
        `os ${brl(r.vencido)} vencidos daqui já não consomem limite e provavelmente já foram pagos, ` +
        'mesmo que a baixa ainda não tenha chegado da produção.'
      )
    case 'parcial':
      return (
        `A plataforma registra ${brl(r.consumido ?? 0)} consumidos para ${brl(r.a_vencer)} a vencer: dos ` +
        `${brl(r.vencido)} vencidos daqui, cerca de ${brl(r.vencido_estimado ?? 0)} estão de fato em aberto. ` +
        'O limite não diz quais títulos — confira antes de selecionar.'
      )
    case 'confirma':
      return `A plataforma confirma: os ${brl(r.vencido)} vencidos continuam consumindo limite, isto é, não foram pagos.`
  }
}
