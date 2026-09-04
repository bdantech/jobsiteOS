import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { contextoComercial } from '@/lib/comercial'
import { ContasFase } from '@/components/comercial/comissao/contas-fase'

export const metadata: Metadata = { title: 'Relógio das contas' }

// Lê comissão provisionada do mês corrente; estático congelaria o número que a tela existe
// para mostrar mudando.
export const dynamic = 'force-dynamic'

export default async function Pagina() {
  const { ehGestor } = await contextoComercial()
  /*
   * `notFound` e não uma mensagem de acesso negado: esta tela reprecifica o trabalho de
   * outra pessoa, e uma tela que se anuncia para quem não pode usá-la é um convite a
   * pedir a senha de quem pode.
   */
  if (!ehGestor) notFound()

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/comercial/admin"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Configurações
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Relógio das contas</h1>
        <p className="text-sm text-muted-foreground">
          Quando a conta começou e em que fase ela está. É o que decide se uma cessão paga a
          taxa de crescimento ou a de manutenção.
        </p>
      </div>
      <ContasFase />
    </div>
  )
}
