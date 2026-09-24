import { TelaDeOutroModulo } from '@/components/shell/tela-de-outro-modulo'

import EmpresaDetalheScreen from '../../empresas/[id]'

/**
 * A ficha da empresa DENTRO desta pilha, para que abri-la de um funil empilhe em vez
 * de trocar de aba — e o gesto de voltar devolva ao funil. Ver `lib/navegacao.ts`.
 */
export default function EmpresaNaPilha() {
  return (
    <TelaDeOutroModulo rotaDeOrigem="/empresas">
      <EmpresaDetalheScreen />
    </TelaDeOutroModulo>
  )
}
