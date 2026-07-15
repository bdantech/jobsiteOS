'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, Bookmark, ExternalLink, Loader2, RefreshCw } from 'lucide-react'
import { descrever } from '@jobsiteos/core'
import { recontarSegmentoAction } from '@/actions/mercado'
import { Button } from '@/components/ui/button'
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
import { urlDoExplorador } from './filtro-url'
import { VAZIO, formatDataHora, formatNumero } from './format'
import { buscarSegmentos, mercadoKeys, type SegmentoLinha } from './queries'

// `segmentos.definicao` é jsonb: para o compilador, pode ser qualquer coisa. Uma
// definição gravada antes de uma variável sair do catálogo não pode derrubar a
// lista inteira — vira "regra inválida" naquela linha e o resto continua. É a
// mesma leitura defensiva que o histórico de regras da Pirâmide faz, e por isso
// é o mesmo `arvoreDeJson`.

const COLUNAS = 6

function BotaoRecontar({ segmento }: { segmento: SegmentoLinha }) {
  const queryClient = useQueryClient()
  const [recontando, setRecontando] = React.useState(false)

  async function recontar() {
    setRecontando(true)
    const resultado = await recontarSegmentoAction(segmento.id)
    setRecontando(false)

    if (!resultado.ok) {
      toast.error(resultado.message)
      return
    }

    await queryClient.invalidateQueries({ queryKey: mercadoKeys.segmentos() })
    await queryClient.invalidateQueries({ queryKey: mercadoKeys.segmento(segmento.id) })

    const total = resultado.data.contagem
    toast.success(`${formatNumero(total)} ${total === 1 ? 'empresa' : 'empresas'}.`, {
      description: segmento.nome,
    })
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={(evento) => {
        evento.stopPropagation()
        void recontar()
      }}
      disabled={recontando}
    >
      {recontando ? (
        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
      ) : (
        <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
      )}
      Recontar
    </Button>
  )
}

export function SegmentosLista() {
  const router = useRouter()

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: mercadoKeys.segmentos(),
    queryFn: buscarSegmentos,
  })

  const segmentos = data ?? []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Segmentos</h1>
          <p className="text-sm text-muted-foreground">
            Filtros nomeados sobre o universo. São vivos: a contagem abaixo é um cache — o segmento
            é reavaliado toda vez que alguém (ou uma Cadência) o consulta.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/mercado/explorador">Ir para o Explorador</Link>
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Regra</TableHead>
              <TableHead className="text-right">Empresas</TableHead>
              <TableHead>Contagem de</TableHead>
              <TableHead>Criado por</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: COLUNAS }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={COLUNAS} className="h-64">
                  <div className="flex flex-col items-center justify-center gap-3 text-center">
                    <div className="rounded-full bg-destructive/10 p-3">
                      <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
                    </div>
                    <div className="space-y-1">
                      <p className="font-medium">Não foi possível carregar os segmentos</p>
                      <p className="max-w-md text-sm text-muted-foreground">
                        {error instanceof Error ? error.message : 'Erro desconhecido.'}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => void refetch()}>
                      Tentar novamente
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : segmentos.length === 0 ? (
              <TableRow>
                <TableCell colSpan={COLUNAS} className="h-64">
                  <div className="flex flex-col items-center justify-center gap-3 text-center">
                    <div className="rounded-full bg-muted p-3">
                      <Bookmark className="h-6 w-6 text-muted-foreground" aria-hidden />
                    </div>
                    <div className="space-y-1">
                      <p className="font-medium">Nenhum segmento ainda</p>
                      <p className="max-w-md text-sm text-muted-foreground">
                        Monte um filtro no Explorador e clique em &ldquo;Salvar como
                        segmento&rdquo;.
                      </p>
                    </div>
                    <Button variant="outline" size="sm" asChild>
                      <Link href="/mercado/explorador">Abrir o Explorador</Link>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              segmentos.map((segmento) => {
                const arvore = arvoreDeJson(segmento.definicao)

                return (
                  <TableRow
                    key={segmento.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/mercado/segmentos/${segmento.id}`)}
                  >
                    <TableCell className="font-medium">
                      <Link
                        href={`/mercado/segmentos/${segmento.id}`}
                        className="hover:underline"
                        onClick={(evento) => evento.stopPropagation()}
                      >
                        {segmento.nome}
                      </Link>
                      {segmento.descricao && (
                        <p className="max-w-md truncate text-xs text-muted-foreground">
                          {segmento.descricao}
                        </p>
                      )}
                    </TableCell>

                    <TableCell className="max-w-md">
                      {arvore ? (
                        <p className="truncate text-sm text-muted-foreground">
                          {descrever(arvore)}
                        </p>
                      ) : (
                        <span className="text-sm text-destructive">Regra inválida</span>
                      )}
                    </TableCell>

                    <TableCell className="text-right tabular-nums">
                      {segmento.contagem_cache === null ? (
                        <span className="text-muted-foreground">nunca contado</span>
                      ) : (
                        formatNumero(segmento.contagem_cache)
                      )}
                    </TableCell>

                    <TableCell className="text-sm text-muted-foreground">
                      {segmento.contagem_atualizada_em
                        ? formatDataHora(segmento.contagem_atualizada_em)
                        : VAZIO}
                    </TableCell>

                    <TableCell className="text-sm text-muted-foreground">
                      {segmento.criador_nome ?? VAZIO}
                    </TableCell>

                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {arvore && (
                          <Button
                            variant="ghost"
                            size="sm"
                            asChild
                            onClick={(evento) => evento.stopPropagation()}
                          >
                            <Link href={urlDoExplorador(arvore)}>
                              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                              Explorar
                            </Link>
                          </Button>
                        )}
                        <BotaoRecontar segmento={segmento} />
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
