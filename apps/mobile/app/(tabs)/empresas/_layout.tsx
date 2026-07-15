import { Stack } from 'expo-router'

import { ModuleStack } from '@/components/shell/module-stack'

/** Stack per module, as the spec requires: list → Company 360 pushes on top.
 *  <ModuleStack> supplies the themed header + the notifications bell. */
export default function EmpresasLayout() {
  return (
    <ModuleStack>
      <Stack.Screen name="index" options={{ title: 'Empresas' }} />
      <Stack.Screen name="[id]" options={{ title: 'Empresa' }} />
    </ModuleStack>
  )
}
