import {
  COBRANCA_ESTAGIO_LABELS,
  SINISTRO_ESTAGIO_LABELS,
  type CobrancaEstagio,
  type SinistroEstagio,
} from '@jobsiteos/core'

/** Formatações compartilhadas pelas telas da Cobrança. */

export function brl(v: number | string | null | undefined, casas = 2): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—'
  return Number(v).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  })
}

export function data(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(v.length === 10 ? `${v}T12:00:00` : v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR')
}

export function dataHora(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function cnpj(v: string | null | undefined): string {
  const d = (v ?? '').replace(/\D/g, '')
  if (d.length !== 14) return v ?? '—'
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
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
  parada_cobertura: 'Parada de cobertura',
  notificacao_seguradora: 'Notificar a seguradora',
  data_perda: 'Data da Perda',
  envio_sinistro: 'Envio do sinistro',
}

/**
 * A cor do prazo: é o que o olho procura primeiro na lista. Vermelho a 5 dias ou
 * menos (a janela crítica de D+85), âmbar a 15, neutro depois disso.
 */
export function corDoPrazo(dias: number | null | undefined): string {
  if (dias === null || dias === undefined) return 'text-muted-foreground'
  if (dias <= 5) return 'text-destructive font-semibold'
  if (dias <= 15) return 'text-amber-600 dark:text-amber-400 font-medium'
  return 'text-muted-foreground'
}

export function prazoTexto(dias: number | null | undefined): string {
  if (dias === null || dias === undefined) return '—'
  if (dias < 0) return `vencido há ${-dias} d`
  if (dias === 0) return 'hoje'
  return `em ${dias} d`
}
