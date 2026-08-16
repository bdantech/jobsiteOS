import type { Metadata } from 'next'
import { contextoComercial } from '@/lib/comercial'
import { FunilCertificados } from '@/components/certificados/funil-certificados'

export const metadata: Metadata = { title: 'Funil de Certificados' }

// O funil reflete a tabela de certificados, que o sync diário reescreve; render
// estático congelaria a coluna de ontem.
export const dynamic = 'force-dynamic'

export default async function Pagina() {
  // `ehGestor` resolvido no servidor, como nos outros funis: ele decide se o seletor
  // de originador existe, e resolvê-lo no cliente faria o filtro piscar na entrada.
  const { ehGestor } = await contextoComercial()
  return <FunilCertificados ehGestor={ehGestor} />
}
