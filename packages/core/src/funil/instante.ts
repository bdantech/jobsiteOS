/**
 * Timestamp da plataforma com o fuso que ela não manda.
 *
 * Os endpoints de pré-autorizações e de títulos devolvem `2026-09-28T14:17:00` —
 * hora de Brasília, sem fuso. Gravado cru, o Postgres assume UTC, e até 28/09/2026
 * foi o que aconteceu: toda oferta aparecia criada três horas antes, e o
 * `expiresAt` de fim de dia (23:59:59) virava 20:59 — o relógio da oferta vencia
 * três horas antes do que a plataforma diz.
 *
 * `-03:00` fixo porque o Brasil não tem horário de verão desde 2019. É a mesma regra
 * do payload de antecipações (`antecipacao-payload.ts`, `instante`). O que já vier
 * com fuso passa intacto.
 */
export function instanteDeBrasilia(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  if (!s) return null
  if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(s)) return s
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) ? `${s}-03:00` : s
}
