import { View } from 'react-native'

import { ReportButton } from '@/components/shell/report-button'
import { NotificationsBell } from '@/features/notificacoes/bell'

/**
 * As ações do header: reportar e notificações, nessa ordem.
 *
 * Os dois lados do mesmo canal — de fora para dentro (o que a pessoa nos conta) e
 * de dentro para fora (o que contamos a ela) —, e por isso ficam juntos e sempre
 * no mesmo lugar. Todo stack de módulo os recebe pelo <ModuleStack> (headerRight)
 * e as telas sem header nativo pelo <ScreenHeader>, então nenhuma feature precisa
 * lembrar de montá-los.
 *
 * Substituiu <HeaderBell>: o nome passou a mentir quando o slot deixou de ter só
 * o sino, e um componente chamado "bell" que renderiza dois botões é o começo de
 * alguém montar o terceiro em outro lugar.
 */
export function HeaderActions() {
  return (
    <View className="flex-row items-center pr-1">
      <ReportButton />
      <NotificationsBell />
    </View>
  )
}
