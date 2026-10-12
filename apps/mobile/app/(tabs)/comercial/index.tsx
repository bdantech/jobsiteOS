import { useRouter } from 'expo-router'
import { RefreshControl, ScrollView, View } from 'react-native'

import { AbaixoDoCabecalho, useRecuoDoCabecalho } from '@/components/shell/cabecalho-de-vidro'
import { CartaoDeMenu } from '@/components/shell/module-grid'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/states'
import { Text } from '@/components/ui/text'
import { useJanelaNovidades, useResumoNovidades } from '@/features/antecipacao'
import { itensDoMenu, useContextoComercial } from '@/features/comercial/menu'
import { useSession } from '@/lib/auth'

/**
 * A porta do Comercial: a grade das telas do módulo, no desenho da aba "Mais".
 *
 * Na web o módulo é uma barra de abas; no celular uma barra com seis abas não cabe,
 * e esconder quatro atrás de um "mais" as tornaria telas que ninguém encontra. A
 * grade mostra tudo o que a pessoa pode abrir, de uma vez, e nada além disso — a
 * régua de quem vê o quê está em `features/comercial/menu.ts`.
 */
export default function ComercialScreen() {
  const router = useRouter()
  const recuo = useRecuoDoCabecalho()
  const { data, isPending, isError, refetch, isRefetching } = useContextoComercial()

  /*
   * O contador do Funil de NFs (04t): o que entrou desde o último expediente, no MESMO
   * recorte da tela que o cartão abre — o originador travado na própria carteira, os
   * outros pelo que a RLS lhes dá. Sem o módulo Antecipação não há nota para contar.
   */
  const { grantedModuleIds } = useSession()
  const { janela } = useJanelaNovidades('expediente')
  const novidades = useResumoNovidades(
    janela,
    data?.vendedor?.tipo === 'originador' ? data.vendedor.id : null,
    Boolean(data) && grantedModuleIds.includes('antecipacao'),
  )
  const novas = novidades.data?.total ?? 0

  if (isError) {
    return (
      <AbaixoDoCabecalho>
        <ErrorState onRetry={() => void refetch()} />
      </AbaixoDoCabecalho>
    )
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 p-4 pb-28"
      contentContainerStyle={{ paddingTop: recuo + 16 }}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
    >
      {isPending ? (
        <View className="flex-row flex-wrap gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 min-w-[45%] flex-1 rounded-lg" />
          ))}
        </View>
      ) : (
        <View className="flex-row flex-wrap gap-3">
          {itensDoMenu(data).map((item) => (
            <CartaoDeMenu
              key={item.titulo}
              icone={item.icone}
              titulo={item.titulo}
              onPress={() => router.push(item.href)}
              rodape={
                item.href === '/comercial/nfs' && novas > 0 ? (
                  <Text numberOfLines={1} className="text-xs font-medium text-amber-700 dark:text-amber-300">
                    {novas > 99 ? '99+' : novas} {novas === 1 ? 'novidade' : 'novidades'} desde o expediente
                  </Text>
                ) : (
                  <Text numberOfLines={1} className="text-xs text-muted-foreground">
                    {item.descricao}
                  </Text>
                )
              }
            />
          ))}
        </View>
      )}
    </ScrollView>
  )
}
