import { Stack } from 'expo-router'

import { ModuleStack } from '@/components/shell/module-stack'

/**
 * A pilha do Crédito. Load-bearing como as demais: `credito` NÃO é webOnly, e
 * app/(tabs)/_layout.tsx projeta o registry em <Tabs.Screen> por segmento de rota — um
 * módulo registrado sem pasta aqui é uma tela que o React Navigation não resolve.
 *
 * Esteira → detalhe da análise. O editor de scorecard, o painel e as configurações são
 * webOnly: são telas de calibragem com tabela de pesos, e espremê-las numa tela de 6"
 * produziria uma versão pior das duas.
 */
export default function CreditoLayout() {
  return (
    <ModuleStack>
      {/*
        SEM header nativo: a esteira desenha o próprio, que recolhe ao rolar e
        leva busca e estágio dentro do navy. Com os dois ligados, "Esteira"
        apareceria duas vezes e os recuos de status bar se somariam — o mesmo
        defeito que o funil teve.
      */}
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="[id]" options={{ title: 'Análise' }} />
    </ModuleStack>
  )
}
