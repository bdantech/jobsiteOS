/**
 * O canal de STATUS do funil de Sacados por NF, no celular.
 *
 * Existe pelo mesmo motivo que `STATUS_TEXTO` existe na web (components/ui/badge.tsx):
 * cor crua espalhada por componente de feature é como dois cards irmãos acabam com dois
 * verdes diferentes. Aqui ele é um arquivo em vez de um variant porque o `Badge` do
 * mobile tem outra paleta (`success` é `primary/15`, não verde), e forçar o verde por
 * lá mudaria todo badge de sucesso do app.
 *
 * O passo escuro é o do mobile (`-300`/`-200`), o mesmo de `FAIXA_CHIP_TEXTO` e
 * `URGENCIA_TEXTO` — não o da web (`-400`). Duas telas diferentes, cada uma coerente
 * consigo: o que não pode é o mesmo app ter dois verdes na mesma tela.
 */
export const STATUS_TEXTO = {
  success: 'text-emerald-700 dark:text-emerald-300',
  warning: 'text-amber-700 dark:text-amber-300',
  critical: 'text-destructive',
} as const
