import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * O esqueleto desenha a MESMA forma da ficha — voltar, topo, banda de status, abas,
 * identidade estreita à esquerda.
 *
 * Mesma razão do esqueleto da Company 360: um esqueleto que mostra um layout e entrega
 * outro faz a tela saltar na cara de quem estava esperando. A banda de status é a peça
 * que mais importa aqui — ela é alta e colorida, e se aparecesse do nada empurraria as
 * abas para baixo bem no momento em que a pessoa fosse clicar numa delas.
 */
export function DetalheCarregandoFicha() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-24" />

      <div className="space-y-2">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-4 w-40" />
      </div>

      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <Skeleton className="h-7 w-56" />
              <Skeleton className="h-4 w-80" />
            </div>
            <Skeleton className="h-12 w-40" />
          </div>
          <Skeleton className="h-4 w-96" />
          <div className="space-y-2 border-t pt-3">
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-4 w-96" />
          </div>
        </CardContent>
      </Card>

      <Skeleton className="h-10 w-full max-w-xl" />

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <Card>
          <CardContent className="flex flex-col items-center gap-4 p-6">
            <Skeleton className="size-20 rounded-full" />
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-[70px] w-full rounded-lg" />
            <Skeleton className="h-40 w-full" />
          </CardContent>
        </Card>

        <div className="lg:col-span-2">
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    </div>
  )
}
