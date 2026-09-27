import { Redirect, useLocalSearchParams } from 'expo-router'

import { MandatosLista } from '@/features/agentes'

/**
 * `/agentes/mandatos` é a lista; `/agentes/mandatos?m=<id>` é a rota da WEB para um
 * mandato (o drawer sobre o kanban), e é ela que o push de escalação e a barra de IA
 * carregam no `url`/`route`. O celular não tem drawer: o `m` vira a tela de detalhe.
 *
 * `Redirect` SUBSTITUI esta entrada da pilha em vez de empilhar sobre ela — voltar do
 * detalhe não passa por uma lista que a pessoa nunca viu.
 */
export default function MandatosScreen() {
  const { m } = useLocalSearchParams<{ m?: string }>()
  if (m) return <Redirect href={`/agentes/${m}`} />
  return <MandatosLista />
}
