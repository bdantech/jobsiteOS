/**
 * CNPJ is the natural key of `empresas`, so a bad one is a corrupt row that
 * every downstream module inherits. We normalize to 14 digits (matching the
 * `empresas_cnpj_check` constraint) and verify the two check digits — a length
 * check alone would happily accept 00000000000000.
 */

/** Strips formatting: "11.222.333/0001-81" -> "11222333000181" */
export function normalizeCnpj(input: string): string {
  return input.replace(/\D/g, '')
}

/** "11222333000181" -> "11.222.333/0001-81" (for display only) */
export function formatCnpj(cnpj: string): string {
  const d = normalizeCnpj(cnpj)
  if (d.length !== 14) return cnpj
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}

function checkDigit(digits: string, weights: readonly number[]): number {
  const sum = weights.reduce((acc, weight, i) => acc + Number(digits[i]) * weight, 0)
  const remainder = sum % 11
  return remainder < 2 ? 0 : 11 - remainder
}

const FIRST_WEIGHTS = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const
const SECOND_WEIGHTS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const

export function isValidCnpj(input: string): boolean {
  const cnpj = normalizeCnpj(input)

  if (cnpj.length !== 14) return false
  // Rejects 00000000000000, 11111111111111, … which pass the check-digit math.
  if (/^(\d)\1{13}$/.test(cnpj)) return false

  const first = checkDigit(cnpj.slice(0, 12), FIRST_WEIGHTS)
  if (first !== Number(cnpj[12])) return false

  const second = checkDigit(cnpj.slice(0, 13), SECOND_WEIGHTS)
  return second === Number(cnpj[13])
}
