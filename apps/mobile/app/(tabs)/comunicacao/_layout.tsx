import { Stack } from 'expo-router'

import { ModuleStack } from '@/components/shell/module-stack'

/**
 * A pilha da Comunicação. Load-bearing como as demais: `comunicacao` NÃO é
 * webOnly, e app/(tabs)/_layout.tsx projeta o registry em <Tabs.Screen> por
 * segmento de rota — um módulo registrado sem pasta aqui é uma tela que o React
 * Navigation não resolve.
 *
 * Inbox → conversa, mais a fila de identificação. Templates, playbooks, painel de
 * atividade e configurações são WEB: são telas de calibragem e de tabela, e
 * espremê-las em 6" produziria uma versão pior delas e do celular. O que o
 * celular precisa é o que se faz entre uma coisa e outra — ler, responder,
 * identificar.
 */
export default function ComunicacaoLayout() {
  return (
    <ModuleStack>
      <Stack.Screen name="index" options={{ title: 'Inbox' }} />
      <Stack.Screen name="nao-vinculadas" options={{ title: 'Aguardando identificação' }} />
      <Stack.Screen name="[id]" options={{ title: 'Conversa' }} />
    </ModuleStack>
  )
}
