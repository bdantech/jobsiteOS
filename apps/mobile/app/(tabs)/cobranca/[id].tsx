import { useLocalSearchParams } from 'expo-router'

import { CobrancaDetalheMobile } from '@/features/cobranca'

export default function CobrancaDetalheScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <CobrancaDetalheMobile cobrancaId={id ?? ''} />
}
