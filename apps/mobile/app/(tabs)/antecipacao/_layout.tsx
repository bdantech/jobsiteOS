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
      {/*
        SEM header nativo: o funil desenha o próprio, que RECOLHE ao rolar e
        carrega busca e estágio dentro do navy. Com os dois ligados a tela
        mostrava "Funil" duas vezes, os mesmos dois botões duas vezes, e somava
        dois recuos de status bar — o cabeçalho ocupava um terço da tela antes
        do primeiro card.
      */}
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="fornecedores/[cnpj]" options={{ title: 'Fornecedor' }} />
      <Stack.Screen name="sacados" options={{ headerShown: false }} />
      {/*
        Sacados por NF (04r) ABSORVEU a antiga "Sacados a Prospectar": aquela era uma
        lista ordenada por valor recebido, sem dono, sem estágio e sem ação.
      */}
      <Stack.Screen name="sacados-por-nf" options={{ title: 'Sacados por NF' }} />
    </ModuleStack>
  )
}
