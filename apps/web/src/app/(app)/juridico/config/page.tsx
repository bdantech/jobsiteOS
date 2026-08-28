import type { Metadata } from 'next'
import { JuridicoConfig } from '@/components/juridico/juridico-config'

export const metadata: Metadata = { title: 'Configurações — Jurídico' }

export default function ConfigPage() {
  return <JuridicoConfig />
}
