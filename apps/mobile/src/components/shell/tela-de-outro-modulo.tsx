import type { ReactNode } from 'react'

import { AbaixoDoCabecalho } from '@/components/shell/cabecalho-de-vidro'
import { EmptyState } from '@/components/ui/states'
import { useSession } from '@/lib/auth'
import { canOpenOnMobile } from '@/lib/linking'

/**
 * Uma tela de OUTRO módulo empilhada dentro desta pilha — a ficha da empresa no
 * funil, o fornecedor no Comercial (ver `lib/navegacao.ts`).
 *
 * O portão do app decide pelo primeiro segmento da rota, então `/comercial/empresa/x`
 * passa como Comercial. Esta checagem devolve a régua do módulo DE ORIGEM: quem não
 * tem Empresas não abre a ficha por aqui, do mesmo jeito que não abriria por lá.
 */
export function TelaDeOutroModulo({
  rotaDeOrigem,
  children,
}: {
  /** A rota do módulo a quem a tela pertence, ex.: '/empresas'. */
  rotaDeOrigem: string
  children: ReactNode
}) {
  const { grantedModuleIds } = useSession()

  if (!canOpenOnMobile(rotaDeOrigem, grantedModuleIds)) {
    return (
      <AbaixoDoCabecalho>
        <EmptyState
          title="Sem acesso"
          description="Esta tela pertence a um módulo que seu perfil não tem. Peça a um Admin, se precisar dela."
        />
      </AbaixoDoCabecalho>
    )
  }

  return <>{children}</>
}
