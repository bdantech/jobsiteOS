import { Stack } from 'expo-router'

import { ModuleStack } from '@/components/shell/module-stack'

/**
 * A pilha do Comercial. Este arquivo é load-bearing: `comercial` NÃO é webOnly, e
 * app/(tabs)/_layout.tsx projeta o registry em <Tabs.Screen> por segmento de rota —
 * um módulo registrado sem pasta aqui é uma tela que o React Navigation não resolve,
 * e o app quebra na inicialização, não no clique.
 *
 * A home é o MENU do módulo — a grade de `index.tsx`, com os itens que o tipo de
 * vendedor da pessoa abre (régua em `features/comercial/menu.ts`). O MEU DIA (04p) é o
 * primeiro deles, e mora em /comercial/meu-dia, a mesma rota da web: um link de
 * notificação vindo de lá abre a mesma tela aqui. O painel do mês continua um toque
 * abaixo do Meu Dia: ele responde "como está o meu mês", que é consulta; o Meu Dia
 * responde "o que eu faço agora", que é trabalho.
 *
 * Só o que se usa em pé: Meu Dia, painel, funis, a COMISSÃO — que entrou porque o motor v2
 * (04k) a tornou live: o número muda enquanto a pessoa trabalha, e é justamente esse
 * número que ela quer conferir entre uma reunião e outra — e o CADASTRO DE FORNECEDORES
 * (04l), que é a tela que mais pertence ao celular de todas: o uso real dela é na obra
 * ou no carro, com a ficha de abordagem na mão e o botão de ligar a um toque. E as
 * CAMPANHAS (05B), das quais o celular ganha exatamente três botões — aprovar, pausar,
 * retomar: aprovar é a decisão que trava esperando alguém fora do escritório, e pausar
 * é o que se aperta quando algo parece errado, que quase nunca acontece na mesa.
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
      <Stack.Screen name="index" options={{ title: 'Comercial' }} />
      <Stack.Screen name="meu-dia" options={{ title: 'Meu Dia' }} />
      <Stack.Screen name="painel" options={{ title: 'Meu Painel' }} />
      {/* Relatórios (04q) é do GESTOR, e a própria RPC recusa quem não é: a tela cai no
          estado vazio em vez de esconder a rota. Esconder daria um item de menu que some
          e volta conforme o cadastro, e ninguém saberia se a tela sumiu ou se o acesso
          mudou. */}
      <Stack.Screen name="relatorios" options={{ title: 'Relatórios' }} />
      {/* Os funis filtram por estágio e desenham o cabeçalho retrátil. O de NFs
          desliga o da pilha por conta própria: antes do funil ele tem estados
          (sem acesso, carregando o contexto) que precisam do cabeçalho fixo. */}
      <Stack.Screen name="sdr" options={{ title: 'Funil de Reuniões', headerShown: false }} />
      <Stack.Screen name="vendas" options={{ title: 'Funil de Vendas', headerShown: false }} />
      <Stack.Screen name="nfs" options={{ title: 'Funil de NFs' }} />
      <Stack.Screen name="comissoes" options={{ title: 'Comissão' }} />
      {/* Fornecedores filtra por estágio e desenha o cabeçalho retrátil. */}
      <Stack.Screen name="fornecedores" options={{ title: 'Fornecedores', headerShown: false }} />
      <Stack.Screen name="campanhas" options={{ title: 'Campanhas' }} />
    </ModuleStack>
  )
}
