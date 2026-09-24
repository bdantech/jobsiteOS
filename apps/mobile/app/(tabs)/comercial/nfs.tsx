import { Stack } from 'expo-router'
import { View } from 'react-native'

import { AbaixoDoCabecalho } from '@/components/shell/cabecalho-de-vidro'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { FunilNotas, FunilSkeleton } from '@/features/antecipacao'
import { useContextoComercial } from '@/features/comercial/menu'
import { useSession } from '@/lib/auth'

/**
 * O Funil de NFs do Comercial: o mesmo funil da Antecipação, recortado na carteira.
 *
 * ── QUEM VÊ O QUÊ ───────────────────────────────────────────────────────────
 * O ORIGINADOR abre travado na própria carteira (`vendedor_id`), como na web.
 * O CLOSER não tem recorte: nota não é dele, é do time abaixo dele e das contas
 * passivas que ele carrega, e travá-lo no próprio id abriria um funil vazio. Quem
 * recorta é a RLS (0188). O GESTOR vê o funil inteiro.
 *
 * ── SEM O MÓDULO ANTECIPAÇÃO, UM AVISO — NÃO UM FUNIL VAZIO ─────────────────
 * A nota vive sob a RLS de `antecipacao`, não de `comercial`. Quem tem só o
 * Comercial veria uma lista vazia e concluiria que a carteira dele está vazia, que
 * é uma conclusão errada sobre o próprio trabalho.
 */
export default function FunilNfsScreen() {
  const { grantedModuleIds } = useSession()
  const contexto = useContextoComercial()

  if (!grantedModuleIds.includes('antecipacao')) {
    return (
      <AbaixoDoCabecalho>
        <EmptyState
          title="Sem acesso às notas"
          description="As notas fiscais vivem no módulo Antecipação, e seu perfil não tem acesso a ele. Peça a um Admin o módulo Antecipação — sem ele esta tela mostraria um funil vazio, que não é o mesmo que uma carteira vazia."
        />
      </AbaixoDoCabecalho>
    )
  }

  /*
    Espera o contexto ANTES de montar o funil: montado sem ele, o originador veria
    por um instante a lista sem a trava da carteira — e o primeiro card que ele
    tocasse poderia ser de outra pessoa.
  */
  if (contexto.isPending) {
    return (
      <AbaixoDoCabecalho>
        <View className="pt-4">
          <FunilSkeleton />
        </View>
      </AbaixoDoCabecalho>
    )
  }

  if (contexto.isError) {
    return (
      <AbaixoDoCabecalho>
        <ErrorState onRetry={() => void contexto.refetch()} />
      </AbaixoDoCabecalho>
    )
  }

  const { vendedor } = contexto.data
  const recorte = vendedor?.tipo === 'originador' ? vendedor.id : undefined

  return (
    <>
      {/*
        O cabeçalho da pilha só sai AQUI, quando o funil entra com o retrátil dele.
        Nos estados acima ele fica — sem ele, o aviso de acesso e o erro
        apareceriam sem título e sem a seta de voltar.
      */}
      <Stack.Screen options={{ headerShown: false }} />
      <FunilNotas titulo="Funil de NFs" vendedorId={recorte} />
    </>
  )
}
