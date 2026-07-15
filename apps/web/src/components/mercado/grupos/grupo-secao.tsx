'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, Network } from 'lucide-react'
import { formatCnpj } from '@jobsiteos/core'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatInteiro } from './format'
import { buscarResumoGrupo, gruposKeys } from './queries'

/**
 * A seção "Grupo" do Company 360 (§5.4).
 *
 * Só aparece quando a empresa TEM grupo — uma construtora independente não deve
 * ver um card vazio dizendo que ela não pertence a nada. E quando aparece, ela
 * responde a única pergunta que importa antes de abrir a conta: esta empresa é
 * um CNPJ ou é a ponta de uma holding com 80 SPEs?
 *
 * Falha em silêncio (renderiza nada) se a leitura quebrar ou se o usuário não
 * tiver o módulo Mercado: o Company 360 é do módulo Empresas e não pode ficar
 * quebrado por causa de uma seção auxiliar de outro módulo.
 */
export function GrupoSecao({ grupoId }: { grupoId: string | null }) {
  const { data, isPending, isError } = useQuery({
    queryKey: gruposKeys.resumo(grupoId ?? ''),
    queryFn: () => buscarResumoGrupo(grupoId!),
    enabled: grupoId !== null,
  })

  if (!grupoId) return null

  if (isPending) {
    return <Skeleton className="h-36 w-full" />
  }

  if (isError || !data) return null

  return (
    <Card>
      <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Network className="h-4 w-4" aria-hidden />
            <span className="text-xs font-medium uppercase tracking-wide">Grupo econômico</span>
          </div>
          <CardTitle className="text-base">{data.nome ?? 'Grupo sem nome'}</CardTitle>
          {data.cnpj_cabeca && (
            <CardDescription>
              Cabeça:{' '}
              <span className="font-mono tabular-nums">{formatCnpj(data.cnpj_cabeca)}</span>
            </CardDescription>
          )}
        </div>

        <Button variant="outline" size="sm" asChild>
          <Link href={`/mercado/grupos/${data.id}`}>
            Ver grupo
            <ArrowUpRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </CardHeader>

      <CardContent>
        <dl className="flex flex-wrap gap-8">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Empresas no grupo
            </dt>
            <dd className="text-2xl font-semibold tabular-nums">
              {formatInteiro(data.empresas_total)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              SPEs
            </dt>
            <dd className="text-2xl font-semibold tabular-nums">
              {formatInteiro(data.spes_total)}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  )
}
