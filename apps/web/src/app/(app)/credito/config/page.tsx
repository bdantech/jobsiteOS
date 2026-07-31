import type { Metadata } from 'next'
import { CreditoConfig } from '@/components/credito/credito-config'

export const metadata: Metadata = { title: 'Configurações — Crédito' }

export default function CreditoConfigPage() {
  return <CreditoConfig />
}
