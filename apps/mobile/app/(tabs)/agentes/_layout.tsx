import { Stack } from 'expo-router'

import { ModuleStack } from '@/components/shell/module-stack'

/**
 * A pilha dos Agentes. Load-bearing como as demais: `agentes` NÃO é webOnly, e
 * app/(tabs)/_layout.tsx projeta o registry em <Tabs.Screen> por segmento de rota — um
 * módulo registrado sem pasta aqui é uma tela que o React Navigation não resolve.
 *
 * Ao vivo e Mandatos, só leitura (09 §11 Mobile). Personas, materiais, regras,
 * desempenho e configurações são WEB: é calibragem de quem responde pelo que o agente
 * fala em nome da casa, e nenhuma delas se faz entre uma reunião e outra. O que o
 * celular precisa é o que o push traz — um disjuntor aberto, um mandato escalado.
 */
export default function AgentesLayout() {
  return (
    <ModuleStack>
      <Stack.Screen name="index" options={{ title: 'Ao vivo' }} />
      {/* A lista filtra e desenha o cabeçalho retrátil. Também recebe `?m=<id>`, a rota da web. */}
      <Stack.Screen name="mandatos" options={{ title: 'Mandatos', headerShown: false }} />
      <Stack.Screen name="[id]" options={{ title: 'Mandato' }} />
    </ModuleStack>
  )
}
