import { useLocalSearchParams } from 'expo-router'

import { MandatoDetalheMobile } from '@/features/agentes'

export default function MandatoDetalheScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <MandatoDetalheMobile mandatoId={id ?? ''} />
}
