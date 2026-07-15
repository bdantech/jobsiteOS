import { Stack } from 'expo-router'

import { ModuleStack } from '@/components/shell/module-stack'

/**
 * The Mercado stack. This file is load-bearing for the whole app: `mercado` is
 * NOT a webOnly module, and app/(tabs)/_layout.tsx projects the registry onto
 * <Tabs.Screen> by route segment — a registered module with no folder here is a
 * screen React Navigation cannot resolve.
 *
 * Mapa → Explorador → ficha do universo / grupo econômico, each pushing on top of
 * the last. The Pirâmide (rule builder), o Importador de listas e as Ingestões
 * são webOnly: they are not declared here because they have no mobile screen.
 */
export default function MercadoLayout() {
  return (
    <ModuleStack>
      <Stack.Screen name="index" options={{ title: 'Mapa do Mercado' }} />
      <Stack.Screen name="explorador" options={{ title: 'Explorador' }} />
      <Stack.Screen name="universo/[cnpj]" options={{ title: 'Empresa no universo' }} />
      <Stack.Screen name="grupos/[id]" options={{ title: 'Grupo econômico' }} />
    </ModuleStack>
  )
}
