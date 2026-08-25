import type { Metadata } from 'next'
import { contextoComercial } from '@/lib/comercial'
import { CadastroDeFornecedores } from '@/components/comercial/fornecedores'

export const metadata: Metadata = { title: 'Cadastro de Fornecedores' }

// A lista é recortada por originador pela RLS; renderizar estático serviria a
// carteira de quem abriu a página primeiro para todo mundo.
export const dynamic = 'force-dynamic'

export default async function Pagina() {
  const { context, ehGestor, vendedor } = await contextoComercial()

  return (
    <CadastroDeFornecedores
      ehGestor={ehGestor}
      vendedorId={vendedor?.id ?? null}
      nomeUsuario={context.usuario.nome ?? null}
    />
  )
}
