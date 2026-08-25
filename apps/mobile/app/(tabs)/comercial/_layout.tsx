import { Stack } from 'expo-router'

import { ModuleStack } from '@/components/shell/module-stack'

/**
 * A pilha do Comercial. Este arquivo é load-bearing: `comercial` NÃO é webOnly, e
 * app/(tabs)/_layout.tsx projeta o registry em <Tabs.Screen> por segmento de rota —
 * um módulo registrado sem pasta aqui é uma tela que o React Navigation não resolve,
 * e o app quebra na inicialização, não no clique.
 *
 * Só o que se usa em pé: painel, funis, a COMISSÃO — que entrou porque o motor v2
 * (04k) a tornou live: o número muda enquanto a pessoa trabalha, e é justamente esse
 * número que ela quer conferir entre uma reunião e outra — e o CADASTRO DE FORNECEDORES
 * (04l), que é a tela que mais pertence ao celular de todas: o uso real dela é na obra
 * ou no carro, com a ficha de abordagem na mão e o botão de ligar a um toque.
 *
 * O que continua na web: settings, simulador, reclassificação, o painel de eficácia por
 * fonte e o clique pago de busca de contatos. As cinco exigem comparar tabela ou decidir
 * sobre dinheiro de outra pessoa, e nenhuma dessas coisas se faz com uma mão, em pé —
 * a busca paga ainda por cima roda uma cascata de até um minuto e meio, e uma rede de
 * obra é o pior lugar para descobrir que a chamada caiu no meio de uma cobrança.
 */
export default function ComercialLayout() {
  return (
    <ModuleStack>
      <Stack.Screen name="index" options={{ title: 'Meu Painel' }} />
      <Stack.Screen name="sdr" options={{ title: 'Reuniões' }} />
      <Stack.Screen name="vendas" options={{ title: 'Vendas' }} />
      <Stack.Screen name="comissoes" options={{ title: 'Comissão' }} />
      <Stack.Screen name="fornecedores" options={{ title: 'Fornecedores' }} />
    </ModuleStack>
  )
}
