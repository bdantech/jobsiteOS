import { Stack } from 'expo-router'

import { ModuleStack } from '@/components/shell/module-stack'

/**
 * A pilha da Antecipação. Este arquivo é load-bearing: `antecipacao` NÃO é webOnly,
 * e app/(tabs)/_layout.tsx projeta o registry em <Tabs.Screen> por segmento de rota
 * — um módulo registrado sem pasta aqui é uma tela que o React Navigation não
 * resolve.
 *
 * Funil → detalhe do fornecedor, mais as duas leituras laterais (por sacado e
 * sacados a prospectar). O editor de regras de faixa, a Outbox, a régua de disparo,
 * as contas de WhatsApp e os settings são `webOnly` — não estão declarados aqui
 * porque não têm tela mobile.
 */
export default function AntecipacaoLayout() {
  return (
    <ModuleStack>
      <Stack.Screen name="index" options={{ title: 'Funil' }} />
      <Stack.Screen name="fornecedores/[cnpj]" options={{ title: 'Fornecedor' }} />
      <Stack.Screen name="sacados" options={{ headerShown: false }} />
      <Stack.Screen name="prospectar" options={{ title: 'Sacados a Prospectar' }} />
    </ModuleStack>
  )
}
