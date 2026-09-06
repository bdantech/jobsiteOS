import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { contextoComercial } from '@/lib/comercial'
import { FornecedoresSemInteresse } from '@/components/comercial/fornecedores/sem-interesse'

export const metadata: Metadata = { title: 'Sem Interesse em se Cadastrar — Comercial' }

// A lista é recortada por originador pela RLS, como o funil.
export const dynamic = 'force-dynamic'

export default async function Pagina() {
  const { ehGestor, vendedor } = await contextoComercial()
  if (!ehGestor && vendedor?.tipo !== 'originador') redirect('/comercial')

  return <FornecedoresSemInteresse />
}
