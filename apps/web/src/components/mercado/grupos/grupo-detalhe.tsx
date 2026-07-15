'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft, Network, SearchX } from 'lucide-react'
import { formatCnpj } from '@jobsiteos/core'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { GrupoMetricas } from './grupo-metricas'
import { MembrosTabela } from './membros-tabela'
import { SpesPorAno } from './spes-por-ano'
import { buscarGrupo, gruposKeys } from './queries'

export function GrupoCarregando() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-28" />
      <div className="space-y-3">
        <Skeleton className="h-8 w-96" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  )
}

function EstadoVazio({
  titulo,
  descricao,
  children,
}: {
  titulo: string
  descricao: string
  children: ReactNode
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-4 py-20 text-center">
        {children}
        <div className="space-y-1">
          <p className="text-lg font-medium">{titulo}</p>
          <p className="max-w-md text-sm text-muted-foreground">{descricao}</p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/mercado">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar para o Mercado
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}

/**
 * Grupo econômico (§5.4).
 *
 * Uma incorporadora grande não é uma empresa: é uma holding com dezenas ou
 * centenas de SPEs. Dimensionar a conta pelo CNPJ da cabeça subestima o cliente
 * em duas ordens de grandeza — esta tela existe para que ninguém faça isso.
 *
 * Como em Empresas, "não encontrado" e "sem acesso" dizem a MESMA coisa: RLS
 * devolve zero linhas nos dois casos, e distinguir os dois seria um oráculo de
 * existência sobre dados que o usuário não pode ver.
 */
export function GrupoDetalhe({ grupoId }: { grupoId: string }) {
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: gruposKeys.detalhe(grupoId),
    queryFn: () => buscarGrupo(grupoId),
  })

  if (isPending) return <GrupoCarregando />

  if (isError) {
    return (
      <EstadoVazio
        titulo="Não foi possível carregar o grupo"
        descricao={error instanceof Error ? error.message : 'Erro desconhecido.'}
      >
        <div className="rounded-full bg-destructive/10 p-3">
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
        </div>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          Tentar novamente
        </Button>
      </EstadoVazio>
    )
  }

  if (!data) {
    return (
      <EstadoVazio
        titulo="Grupo não encontrado"
        descricao="Ele pode ter sido recalculado pelo worker, ou você pode não ter acesso ao módulo Mercado."
      >
        <div className="rounded-full bg-muted p-3">
          <SearchX className="h-6 w-6 text-muted-foreground" aria-hidden />
        </div>
      </EstadoVazio>
    )
  }

  const cabeca = data.membros.find((m) => m.cnpj === data.cnpj_cabeca) ?? null

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-3 text-muted-foreground">
        <Link href="/mercado">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Mercado
        </Link>
      </Button>

      <header className="space-y-2">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Network className="h-4 w-4" aria-hidden />
          <span className="text-xs font-medium uppercase tracking-wide">Grupo econômico</span>
        </div>

        <h1 className="text-2xl font-semibold tracking-tight">
          {data.nome ?? cabeca?.razao_social ?? 'Grupo sem nome'}
        </h1>

        {data.cnpj_cabeca && (
          <p className="text-sm text-muted-foreground">
            Cabeça do grupo:{' '}
            <span className="font-mono tabular-nums">{formatCnpj(data.cnpj_cabeca)}</span>
            {cabeca?.razao_social ? ` · ${cabeca.razao_social}` : ''}
          </p>
        )}
      </header>

      <GrupoMetricas metricas={data.metricas} />

      <SpesPorAno membros={data.membros} />

      <MembrosTabela membros={data.membros} cnpjCabeca={data.cnpj_cabeca} />
    </div>
  )
}
