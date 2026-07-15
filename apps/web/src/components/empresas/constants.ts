import type { Estagio } from '@jobsiteos/core'
import type { BadgeProps } from '@/components/ui/badge'

type Variante = NonNullable<BadgeProps['variant']>

/** Todas as unidades federativas. Usadas nos filtros e nos formulários. */
export const UFS = [
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
] as const

/**
 * O estágio do funil é o ESTADO de um relacionamento, então ele fala pelo canal de
 * STATUS — as variantes de ui/badge.tsx, onde verde/âmbar/azul/vermelho moram. Este
 * arquivo não escreve cor: nomeia significado.
 *
 * `cliente` pintava de `bg-brand` (o navy da marca) "porque é o estado para onde o
 * funil aponta". Esse é o erro de canal: a marca identifica o produto, não classifica
 * uma linha de tabela. Com ela nesse papel, "é cliente" e "é da ONE OS" viram a mesma
 * cor, e o próximo rebrand repinta em silêncio o significado de um estágio. `cliente`
 * é `success` — o estado ganho.
 *
 * NÃO é o canal ORDINAL (`ordinal1..4`): aquela rampa é a pirâmide de mercado
 * (universo → TAM → SAM → SOM). Reusá-la aqui faria uma badge querer dizer duas
 * escalas diferentes na mesma tela.
 *
 * Também não é o `accent` do shadcn — aquilo é a superfície neutra de hover.
 */
export const ESTAGIO_VARIANTE: Record<Estagio, Variante> = {
  mercado: 'neutral',
  lead: 'info',
  prospect: 'warning',
  cliente: 'success',
  ex_cliente: 'critical',
}

/** Sentinel for "sem filtro": Radix Select forbids an empty-string item value. */
export const TODOS = '__todos__'
