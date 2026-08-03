import { Stack } from 'expo-router'

import { ModuleStack } from '@/components/shell/module-stack'

/**
 * A lista de capacidade e o detalhe do sacado. Existe porque as duas telas de
 * sacado (capacidade e "a prospectar") levam ao MESMO detalhe — dar a ele um
 * lugar próprio é o que evita duas cópias da mesma tela.
 */
export default function SacadosLayout() {
  return (
    <ModuleStack>
      <Stack.Screen name="index" options={{ title: 'Por Sacado' }} />
      <Stack.Screen name="[cnpj]" options={{ title: 'Sacado' }} />
    </ModuleStack>
  )
}
