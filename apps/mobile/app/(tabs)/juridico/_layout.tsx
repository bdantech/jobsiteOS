import { Stack } from 'expo-router'

import { ModuleStack } from '@/components/shell/module-stack'

/**
 * A pilha do Jurídico. Load-bearing como as demais: `juridico` NÃO é webOnly, e
 * app/(tabs)/_layout.tsx projeta o registry em <Tabs.Screen> por segmento de rota — um
 * módulo registrado sem pasta aqui é uma tela que o React Navigation não resolve.
 *
 * Processos → detalhe, mais a agenda de prazos. As configurações (nossos CNPJs, agenda
 * de monitoramento, benchmarks, índices, regras do classificador) são webOnly: são
 * telas de calibragem com tabela, e espremê-las em 6" produziria uma versão pior delas
 * e do celular.
 */
export default function JuridicoLayout() {
  return (
    <ModuleStack>
      <Stack.Screen name="index" options={{ title: 'Processos' }} />
      <Stack.Screen name="prazos" options={{ title: 'Prazos' }} />
      <Stack.Screen name="[cnj]" options={{ title: 'Processo' }} />
    </ModuleStack>
  )
}
