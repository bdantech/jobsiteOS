import { Stack } from 'expo-router'

import { ModuleStack } from '@/components/shell/module-stack'

/**
 * A pilha do Comercial. Este arquivo é load-bearing: `comercial` NÃO é webOnly, e
 * app/(tabs)/_layout.tsx projeta o registry em <Tabs.Screen> por segmento de rota —
 * um módulo registrado sem pasta aqui é uma tela que o React Navigation não resolve,
 * e o app quebra na inicialização, não no clique.
 *
 * Só o que se usa em pé: painel, funil de reuniões, funil de vendas. Comissões,
 * calendário, fila sem dono e configurações ficam na web — são leitura longa ou
 * decisão de gestor, e nenhuma das duas acontece entre uma reunião e outra.
 */
export default function ComercialLayout() {
  return (
    <ModuleStack>
      <Stack.Screen name="index" options={{ title: 'Meu Painel' }} />
      <Stack.Screen name="sdr" options={{ title: 'Reuniões' }} />
      <Stack.Screen name="vendas" options={{ title: 'Vendas' }} />
    </ModuleStack>
  )
}
