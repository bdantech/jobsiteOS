'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, ArrowLeft, ExternalLink, Loader2, RefreshCw, SearchX } from 'lucide-react'
import { descrever, formatCnpj } from '@jobsiteos/core'
import { recontarSegmentoAction } from '@/actions/mercado'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { arvoreDeJson } from '../piramide/arvore'
import { CamadaBadge } from './camada-badge'
import { ESTADO_INICIAL, urlDoExplorador } from './filtro-url'
import { VAZIO, formatDataHora, formatMoeda, formatNumero } from './format'
import { buscarPagina, buscarSegmento, mercadoKeys } from './queries'

/** Prévia: a primeira página do segmento, paginada no servidor como qualquer outra. */
function Previa({ segmentoId }: { segmentoId: string }) {
  const segmento = useQuery({
    queryKey: mercadoKeys.segmento(segmentoId),
    queryFn: () => buscarSegmento(segmentoId),
  })

  const arvore = segmento.data ? arvoreDeJson(segmento.data.definicao) : null

  const previa = useQuery({
    queryKey: mercadoKeys.explorador({ ...ESTADO_INICIAL, arvore, tamanho: 25 }),
    queryFn: () => buscarPagina({ ...ESTADO_INICIAL, arvore, tamanho: 25 }),
    enabled: arvore !== null,
  })

  if (!arvore) return null

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Prévia</CardTitle>
        <Button variant="ghost" size="sm" asChild>
          <Link href={urlDoExplorador(arvore)}>
            Abrir no Explorador
            <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Razão social</TableHead>
              <TableHead>CNPJ</TableHead>
              <TableHead>Camada</TableHead>
              <TableHead>UF</TableHead>
              <TableHead className="text-right">Capital social</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {previa.isPending ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 5 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : previa.isError ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-sm text-muted-foreground">
                  Não foi possível carregar a prévia.
                </TableCell>
              </TableRow>
            ) : previa.data.linhas.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32">
                  <div className="flex flex-col items-center justify-center gap-2 text-center">
                    <SearchX className="h-5 w-5 text-muted-foreground" aria-hidden />
                    <p className="text-sm text-muted-foreground">
                      Nenhuma empresa satisfaz este segmento hoje.
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              previa.data.linhas.map((linha) => (
                <TableRow key={linha.cnpj ?? linha.empresa_id}>
                  <TableCell className="max-w-72 truncate font-medium">
                    <Link
                      href={
                        linha.empresa_id
                          ? `/empresas/${linha.empresa_id}`
                          : `/mercado/universo/${linha.cnpj}`
                      }
                      className="hover:underline"
                    >
                      {linha.razao_social ?? formatCnpj(linha.cnpj ?? '')}
                    </Link>
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {formatCnpj(linha.cnpj ?? '')}
                  </TableCell>
                  <TableCell>
                    <CamadaBadge camada={linha.camada} />
                  </TableCell>
                  <TableCell>{linha.uf ?? VAZIO}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoeda(linha.capital_social)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

export function SegmentoDetalheCarregando() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-28" />
      <Skeleton className="h-9 w-96" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-72 w-full" />
    </div>
  )
}

export function SegmentoDetalhe({ segmentoId }: { segmentoId: string }) {
  const queryClient = useQueryClient()
  const [recontando, setRecontando] = React.useState(false)

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: mercadoKeys.segmento(segmentoId),
    queryFn: () => buscarSegmento(segmentoId),
  })

  async function recontar() {
    setRecontando(true)
    const resultado = await recontarSegmentoAction(segmentoId)
    setRecontando(false)

    if (!resultado.ok) {
      toast.error(resultado.message)
      return
    }

    await queryClient.invalidateQueries({ queryKey: mercadoKeys.segmento(segmentoId) })
    await queryClient.invalidateQueries({ queryKey: mercadoKeys.segmentos() })
    toast.success('Contagem atualizada.')
  }

  if (isPending) return <SegmentoDetalheCarregando />

  if (isError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-4 py-20 text-center">
          <div className="rounded-full bg-destructive/10 p-3">
            <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
          </div>
          <div className="space-y-1">
            <p className="text-lg font-medium">Não foi possível carregar o segmento</p>
            <p className="max-w-md text-sm text-muted-foreground">
              {error instanceof Error ? error.message : 'Erro desconhecido.'}
            </p>
          </div>
          <Button variant="outline" onClick={() => void refetch()}>
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-4 py-20 text-center">
          <div className="rounded-full bg-muted p-3">
            <SearchX className="h-6 w-6 text-muted-foreground" aria-hidden />
          </div>
          <div className="space-y-1">
            <p className="text-lg font-medium">Segmento não encontrado</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Ele pode ter sido excluído por quem o criou.
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/mercado/segmentos">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Voltar para segmentos
            </Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  const arvore = arvoreDeJson(data.definicao)

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/mercado/segmentos">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Segmentos
        </Link>
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{data.nome}</h1>
          {data.descricao && <p className="text-sm text-muted-foreground">{data.descricao}</p>}
        </div>
        <div className="flex gap-2">
          {arvore && (
            <Button variant="outline" asChild>
              <Link href={urlDoExplorador(arvore)}>
                <ExternalLink className="mr-2 h-4 w-4" />
                Abrir no Explorador
              </Link>
            </Button>
          )}
          <Button onClick={recontar} disabled={recontando}>
            {recontando ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Recontar
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Regra</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {arvore ? (
            <p className="text-sm leading-relaxed">{descrever(arvore)}</p>
          ) : (
            <p className="text-sm text-destructive">
              A definição salva não é válida no catálogo atual de variáveis. Recrie o segmento a
              partir do Explorador.
            </p>
          )}

          <div className="flex flex-wrap gap-8 border-t pt-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Empresas (cache)
              </p>
              <p className="text-2xl font-semibold tabular-nums">
                {data.contagem_cache === null ? VAZIO : formatNumero(data.contagem_cache)}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Contado em
              </p>
              <p className="pt-1 text-sm">
                {data.contagem_atualizada_em
                  ? formatDataHora(data.contagem_atualizada_em)
                  : 'Nunca — clique em Recontar.'}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Criado em
              </p>
              <p className="pt-1 text-sm">{formatDataHora(data.criado_em)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Previa segmentoId={segmentoId} />
    </div>
  )
}
