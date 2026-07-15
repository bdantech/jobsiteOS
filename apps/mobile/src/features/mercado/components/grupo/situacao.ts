import type { BadgeVariant } from '@/components/ui/badge'

/**
 * `situacao_cadastral` (Receita) rendered for humans.
 *
 * It lives here rather than in the feature's format.ts because the group screen
 * is the only surface that leans on it: an SPE's situação is how you tell a live
 * project from the shell of a finished one.
 */
const SITUACAO_LABELS: Record<string, string> = {
  ativa: 'Ativa',
  suspensa: 'Suspensa',
  inapta: 'Inapta',
  baixada: 'Baixada',
  nula: 'Nula',
}

/**
 * null for a company that never passed through staging (a list import): the view
 * has no Receita row behind it, so its situação is UNKNOWN — which is not the
 * same as inactive, and must not be painted as one.
 */
export function situacaoLabel(situacao: string | null): string | null {
  if (!situacao) return null
  return SITUACAO_LABELS[situacao] ?? situacao
}

const SITUACAO_VARIANTS: Record<string, BadgeVariant> = {
  ativa: 'success',
  suspensa: 'secondary',
  inapta: 'secondary',
  baixada: 'destructive',
  nula: 'destructive',
}

export function situacaoVariant(situacao: string | null): BadgeVariant {
  if (!situacao) return 'outline'
  return SITUACAO_VARIANTS[situacao] ?? 'outline'
}
