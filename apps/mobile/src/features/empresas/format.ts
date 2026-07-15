import {
  ESTAGIO_LABELS,
  EVENTO_LABELS,
  TIPO_EMPRESA_LABELS,
  formatCnpj,
  type Estagio,
  type TipoEmpresa,
} from '@jobsiteos/core'

import type { BadgeVariant } from '@/components/ui/badge'
import type { EmpresaListItem } from './types'

/**
 * `empresas.estagio` and `.tipo` are plain `text` in the generated Database types
 * (CHECK constraints, not enums), so a row can carry a value the registry doesn't
 * label — e.g. after a migration adds a stage this build predates. Fall back to
 * the raw value instead of rendering `undefined`.
 */
export function estagioLabel(estagio: string): string {
  return ESTAGIO_LABELS[estagio as Estagio] ?? estagio
}

export function tipoLabel(tipo: string): string {
  return TIPO_EMPRESA_LABELS[tipo as TipoEmpresa] ?? tipo
}

export function eventoLabel(tipo: string): string {
  return EVENTO_LABELS[tipo] ?? tipo
}

/** The funnel, read as colour: cold → outline, won → brand, churned → destructive. */
const ESTAGIO_VARIANTS: Record<Estagio, BadgeVariant> = {
  mercado: 'outline',
  lead: 'secondary',
  prospect: 'default',
  cliente: 'success',
  ex_cliente: 'destructive',
}

export function estagioVariant(estagio: string): BadgeVariant {
  return ESTAGIO_VARIANTS[estagio as Estagio] ?? 'secondary'
}

/** A company may have no razao_social (the column is nullable). Never render "null". */
export function empresaTitulo(
  empresa: Pick<EmpresaListItem, 'razao_social' | 'nome_fantasia' | 'cnpj'>,
): string {
  return empresa.nome_fantasia || empresa.razao_social || formatCnpj(empresa.cnpj)
}

/** "São Paulo · SP", or null when neither is set. */
export function localizacao(municipio: string | null, uf: string | null): string | null {
  const parts = [municipio, uf].filter((part): part is string => Boolean(part))
  return parts.length > 0 ? parts.join(' · ') : null
}

const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

export function formatDateTime(iso: string): string {
  return dateTimeFormatter.format(new Date(iso))
}

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

/** `erp_mrr` is `numeric` → `number | null`. R$ 0,00 is a real value; null is not. */
export function formatMrr(valor: number | null): string | null {
  return valor === null ? null : currencyFormatter.format(valor)
}
