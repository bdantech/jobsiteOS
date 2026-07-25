'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { buscarLotesRecentes, radarKeys } from './queries'

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const STATUS: Record<string, string> = {
  rascunho: 'Rascunho',
  aguardando_aprovacao: 'Aguardando aprovação',
  aprovado: 'Aprovado',
  executando: 'Executando',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
  falhou: 'Falhou',
}

export function LotesLista() {
  const lotes = useQuery({
    queryKey: radarKeys.lotes(),
    queryFn: () => buscarLotesRecentes(100),
    refetchInterval: (q) => (q.state.data?.some((l) => l.status === 'executando') ? 5_000 : false),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Lotes de enriquecimento</h1>
          <p className="text-muted-foreground">Seleção, estimativa, aprovação e reconciliação.</p>
        </div>
        <Button asChild>
          <Link href="/radar/lotes/nova">Novo lote</Link>
        </Button>
      </div>

      {lotes.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : (lotes.data ?? []).length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nenhum lote ainda. Crie o primeiro em “Novo lote”.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="divide-y divide-border p-0">
            {(lotes.data ?? []).map((l) => (
              <Link
                key={l.id}
                href={`/radar/lotes/${l.id}`}
                className="flex items-center justify-between px-4 py-3 text-sm hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{l.nome ?? `Lote de ${l.tipo}`}</p>
                  <p className="text-xs text-muted-foreground capitalize">
                    {l.tipo} · {l.total_itens ?? 0} itens
                  </p>
                </div>
                <div className="flex items-center gap-4 text-muted-foreground">
                  <span>{STATUS[l.status] ?? l.status}</span>
                  <span className="tabular-nums">{brl(Number(l.custo_real) || 0)}</span>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
