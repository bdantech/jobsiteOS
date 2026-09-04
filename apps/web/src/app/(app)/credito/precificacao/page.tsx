import type { Metadata } from 'next'
import { PrecificacaoEditor } from '@/components/credito/precificacao-editor'

export const metadata: Metadata = { title: 'Precificação — Crédito' }

/**
 * webOnly (04o §6), pelo mesmo motivo do editor de parâmetros: são vinte e cinco
 * células, doze faixas globais, cinco ajustes e uma prévia sobre a carteira. Decisão
 * de preço merece tela grande, e a versão de 6" seria pior que não ter.
 *
 * A tela não recebe props: a matriz vive em `precificacao_matriz`, que só o módulo
 * Crédito lê, e a rota já está atrás do gate do módulo.
 */
export default function PrecificacaoPage() {
  return <PrecificacaoEditor />
}
