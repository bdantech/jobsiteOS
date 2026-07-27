'use client'

import { mercadoEngine, type Grupo } from '@jobsiteos/core'
import { ConstrutorRegra as ConstrutorGenerico } from '@/components/filtros/construtor-regra'

/**
 * O construtor da pirâmide: o construtor genérico com o engine do Mercado já
 * amarrado. O componente em si é compartilhado com as regras de faixa da
 * Antecipação — duas cópias divergiriam, e a divergência apareceria como "o
 * editor da faixa aceita um operador que o do Mercado não aceita".
 */
export function ConstrutorRegra(props: {
  arvore: Grupo
  onChange: (arvore: Grupo) => void
  disabled?: boolean
}) {
  return <ConstrutorGenerico engine={mercadoEngine} {...props} />
}
