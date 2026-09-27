import {
  COBRANCA_ESTAGIO_LABELS,
  SINISTRO_ESTAGIO_LABELS,
  type CobrancaEstagio,
  type SinistroEstagio,
} from '@jobsiteos/core'

/** As formatações da Cobrança no celular — as mesmas regras de components/cobranca/format.ts da web. */

export function brl(v: number | string | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—'
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

/** Data-only chega como `YYYY-MM-DD`: meio-dia local para o fuso não empurrar para ontem. */
export function dataBr(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(v.length === 10 ? `${v}T12:00:00` : v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR')
}

export function estagioLabel(e: string | null | undefined): string {
  if (!e) return '—'
  return COBRANCA_ESTAGIO_LABELS[e as CobrancaEstagio] ?? e
}

export function sinistroEstagioLabel(e: string | null | undefined): string {
  if (!e) return '—'
  return SINISTRO_ESTAGIO_LABELS[e as SinistroEstagio] ?? e
}

export const MARCO_APOLICE_LABELS: Record<string, string> = {
  parada_cobertura: 'Parada de cobertura (D+60)',
  notificacao_seguradora: 'Notificar a seguradora (D+90)',
  data_perda: 'Data da Perda (D+180)',
  envio_sinistro: 'Envio do sinistro',
}

export function marcoLabel(m: string | null | undefined): string {
  if (!m) return 'Sem prazo de apólice ativo'
  return MARCO_APOLICE_LABELS[m] ?? m
}

/**
 * A cor do prazo, a mesma régua da web: vermelho a 5 dias ou menos (a janela crítica
 * de D+85), âmbar a 15, neutro depois. É o que o olho procura primeiro na lista.
 */
export function corDoPrazo(dias: number | null | undefined): string {
  if (dias === null || dias === undefined) return 'text-muted-foreground'
  if (dias <= 5) return 'text-destructive font-semibold'
  if (dias <= 15) return 'text-amber-600 font-medium'
  return 'text-muted-foreground'
}

export function prazoTexto(dias: number | null | undefined): string {
  if (dias === null || dias === undefined) return '—'
  if (dias < 0) return `vencido há ${-dias} d`
  if (dias === 0) return 'hoje'
  return `em ${dias} d`
}
