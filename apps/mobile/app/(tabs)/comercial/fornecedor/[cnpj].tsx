import { TelaDeOutroModulo } from '@/components/shell/tela-de-outro-modulo'

import FornecedorScreen from '../../antecipacao/fornecedores/[cnpj]'

/**
 * A ficha do fornecedor dentro da pilha do Comercial: o Funil de NFs abre o mesmo
 * card da Antecipação, e tocar no fornecedor dali trocava de aba. Ver
 * `lib/navegacao.ts`.
 */
export default function FornecedorNaPilha() {
  return (
    <TelaDeOutroModulo rotaDeOrigem="/antecipacao">
      <FornecedorScreen />
    </TelaDeOutroModulo>
  )
}
