import type { Metadata } from 'next'
import { FunilCertificados } from '@/components/certificados/funil-certificados'

export const metadata: Metadata = { title: 'Funil de Certificados' }

// O funil reflete a tabela de certificados, que o sync diário reescreve; render
// estático congelaria a coluna de ontem.
export const dynamic = 'force-dynamic'

export default function Pagina() {
  return <FunilCertificados />
}
