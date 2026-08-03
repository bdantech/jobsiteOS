import { Stack } from 'expo-router'

import { ModuleStack } from '@/components/shell/module-stack'

/**
 * The Mercado stack. This file is load-bearing for the whole app: `mercado` is
 * NOT a webOnly module, and app/(tabs)/_layout.tsx projects the registry onto
 * <Tabs.Screen> by route segment — a registered module with no folder here is a
 * screen React Navigation cannot resolve.
 *
 * Mapa → Explorador → ficha do universo / grupo econômico, each pushing on top of
 * the last, mais o Perfil dos Clientes (04f), que é LEITURA aqui. A Pirâmide
 * (rule builder), o Importador de listas, as Ingestões e — dentro do Perfil — as
 * sugestões e o recálculo são webOnly: não têm tela mobile porque editar uma
 * árvore de regra num telefone é a pior versão dessa tarefa.
 */
export default function MercadoLayout() {
  return (
    <ModuleStack>
      <Stack.Screen name="index" options={{ title: 'Mapa do Mercado' }} />
      <Stack.Screen name="explorador" options={{ title: 'Explorador' }} />
      <Stack.Screen name="perfil" options={{ title: 'Perfil dos Clientes' }} />
      <Stack.Screen name="universo/[cnpj]" options={{ title: 'Empresa no universo' }} />
      <Stack.Screen name="grupos/[id]" options={{ title: 'Grupo econômico' }} />
    </ModuleStack>
  )
}
