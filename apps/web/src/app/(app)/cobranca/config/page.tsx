import type { Metadata } from 'next'
import { CobrancaConfig } from '@/components/cobranca/cobranca-config'

export const metadata: Metadata = { title: 'Configurações — Cobrança' }

export default function CobrancaConfigPage() {
  return <CobrancaConfig />
}
