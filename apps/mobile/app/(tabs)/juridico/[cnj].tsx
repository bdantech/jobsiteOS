import { useLocalSearchParams } from 'expo-router'

import { ProcessoDetalheMobile } from '@/features/juridico'

export default function ProcessoScreen() {
  const { cnj } = useLocalSearchParams<{ cnj: string }>()
  return <ProcessoDetalheMobile numeroCnj={decodeURIComponent(cnj ?? '')} />
}
