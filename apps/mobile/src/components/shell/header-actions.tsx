import { View } from 'react-native'

import { NotificationsBell } from '@/features/notificacoes/bell'

/**
 * As ações do header: hoje, só o sino.
 *
 * O botão de reportar morava aqui, ao lado do sino, em toda tela. Saiu para a aba
 * "Mais": num cabeçalho que já divide a linha com o título, a lupa e o sino, um
 * quarto botão espremia o título das telas empilhadas ("Empresa no universo") —
 * e reportar é coisa que se faz de vez em quando, não a cada tela.
 *
 * O componente continua existindo como o slot das ações: todo stack de módulo o
 * recebe pelo <ModuleStack> (headerRight) e as telas que desenham o próprio
 * cabeçalho pela <LinhaDoTitulo>, então nenhuma feature precisa lembrar de
 * montá-lo.
 */
export function HeaderActions() {
  return (
    <View className="flex-row items-center gap-2">
      <NotificationsBell />
    </View>
  )
}
