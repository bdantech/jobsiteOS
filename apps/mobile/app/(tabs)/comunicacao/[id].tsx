import { useLocalSearchParams } from 'expo-router'

import { Conversa } from '@/features/comunicacao'

export default function ConversaScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <Conversa conversaId={id} />
}
