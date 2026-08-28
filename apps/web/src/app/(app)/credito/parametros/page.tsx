import type { Metadata } from 'next'
import { ParametrosEditor } from '@/components/credito/parametros-editor'

export const metadata: Metadata = { title: 'Parâmetros da Análise — Crédito' }

/**
 * webOnly (04j §10), pelo mesmo motivo do editor de scorecard: são cinco tetos, onze
 * indicadores e uma prévia lado a lado. A versão de 6" seria pior que não ter.
 *
 * A tela não recebe props: os parâmetros vivem em `analise_parametros`, que só o módulo
 * Crédito lê, e a rota já está atrás do gate do módulo.
 */
export default function ParametrosPage() {
  return <ParametrosEditor />
}
