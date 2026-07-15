import { ESTAGIO_LABELS, ESTAGIOS, TIPO_EMPRESA_LABELS, type Estagio, type TipoEmpresa } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { ESTAGIO_VARIANTE } from './constants'

/**
 * `estagio` and `tipo` are `text` columns in the database (CHECK-constrained,
 * not enums), so what comes back over the wire is `string`. These guards are the
 * boundary where an unknown value from the DB becomes a typed one — an
 * out-of-range value renders as itself instead of crashing the row.
 */
export function isEstagio(valor: string): valor is Estagio {
  return (ESTAGIOS as readonly string[]).includes(valor)
}

export function labelEstagio(valor: string): string {
  return isEstagio(valor) ? ESTAGIO_LABELS[valor] : valor
}

export function labelTipo(valor: string): string {
  return valor in TIPO_EMPRESA_LABELS ? TIPO_EMPRESA_LABELS[valor as TipoEmpresa] : valor
}

export function EstagioBadge({ estagio, className }: { estagio: string; className?: string }) {
  return (
    <Badge
      variant={isEstagio(estagio) ? ESTAGIO_VARIANTE[estagio] : 'neutral'}
      className={className}
    >
      {labelEstagio(estagio)}
    </Badge>
  )
}
