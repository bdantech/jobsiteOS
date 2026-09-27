import { Stack } from 'expo-router'

import { ModuleStack } from '@/components/shell/module-stack'

/**
 * A pilha da Cobrança. Load-bearing como as demais: `cobranca` NÃO é webOnly, e
 * app/(tabs)/_layout.tsx projeta o registry em <Tabs.Screen> por segmento de rota — um
 * módulo registrado sem pasta aqui é uma tela que o React Navigation não resolve.
 *
 * Consulta e acompanhamento (lista, detalhe, prazos da apólice) + registrar contato
 * (07 §12). Criar cobrança, notificar, protestar e sinistrar ficam na web: são atos com
 * consequência jurídica e de apólice, e não se fazem entre uma reunião e outra.
 */
export default function CobrancaLayout() {
  return (
    <ModuleStack>
      {/* A lista filtra e desenha o cabeçalho retrátil. */}
      <Stack.Screen name="index" options={{ title: 'Cobranças', headerShown: false }} />
      <Stack.Screen name="prazos" options={{ title: 'Prazos da apólice' }} />
      <Stack.Screen name="[id]" options={{ title: 'Cobrança' }} />
      {/* A rota da web (/cobranca/cobrancas/:id), que as tools da AI bar devolvem. */}
      <Stack.Screen name="cobrancas/[id]" options={{ title: 'Cobrança' }} />
    </ModuleStack>
  )
}
