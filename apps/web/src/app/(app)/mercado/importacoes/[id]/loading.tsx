import { Skeleton } from '@/components/ui/skeleton'

/**
 * A leitura da planilha acontece no servidor a cada render da tela de mapeamento
 * — este é o skeleton que fica no lugar enquanto o arquivo é baixado do Storage e
 * parseado.
 */
export default function CarregandoImportacao() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <Skeleton className="h-6 w-48" />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  )
}
