import { Stack } from 'expo-router'

import { ModuleStack } from '@/components/shell/module-stack'

/**
 * A pilha do Comercial. Este arquivo é load-bearing: `comercial` NÃO é webOnly, e
 * app/(tabs)/_layout.tsx projeta o registry em <Tabs.Screen> por segmento de rota —
 * um módulo registrado sem pasta aqui é uma tela que o React Navigation não resolve,
 * e o app quebra na inicialização, não no clique.
 *
 * Só o que se usa em pé: painel, funis, e a COMISSÃO — que entrou porque o motor v2
 * (04k) a tornou live: o número muda enquanto a pessoa trabalha, e é justamente esse
 * número que ela quer conferir entre uma reunião e outra. Junto com ele vêm as duas
 * decisões com prazo: aceitar a reunião e aprovar a competência.
 *
 * O que continua na web: settings, simulador e reclassificação. As três exigem comparar
 * tabela de taxas ou decidir sobre a comissão de outra pessoa, e nenhuma dessas coisas se
 * faz com uma mão, em pé.
 */
export default function ComercialLayout() {
  return (
    <ModuleStack>
      <Stack.Screen name="index" options={{ title: 'Meu Painel' }} />
      <Stack.Screen name="sdr" options={{ title: 'Reuniões' }} />
      <Stack.Screen name="vendas" options={{ title: 'Vendas' }} />
      <Stack.Screen name="comissoes" options={{ title: 'Comissão' }} />
    </ModuleStack>
  )
}
