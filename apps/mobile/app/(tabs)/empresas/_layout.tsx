import { Stack } from 'expo-router'

import { ModuleStack } from '@/components/shell/module-stack'

/** Stack per module, as the spec requires: list → Company 360 pushes on top.
 *  <ModuleStack> supplies the glass header + the notifications bell — exceto na
 *  lista, que tem busca e estágio e por isso desenha o cabeçalho retrátil. */
export default function EmpresasLayout() {
  return (
    <ModuleStack>
      <Stack.Screen name="index" options={{ title: 'Empresas', headerShown: false }} />
      <Stack.Screen name="[id]" options={{ title: 'Empresa' }} />
      <Stack.Screen name="certificados" options={{ title: 'Certificados' }} />
    </ModuleStack>
  )
}
