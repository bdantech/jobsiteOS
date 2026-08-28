'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Gavel } from 'lucide-react'
import { SITUACAO_INTERNA_LABELS, situacaoEhAtiva, type SituacaoInterna } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { buscarProcessosDaEmpresa, juridicoKeys } from './queries'
import { brl, data, faseLabel } from './format'

/**
 * A seção Jurídico da Company 360 (08 §8).
 *
 * ── ELA SÓ APARECE QUANDO HÁ PROCESSO ──────────────────────────────────────
 * Um card que abre para dizer "esta empresa não tem processos" ocupa espaço na ficha
 * de 99% das empresas para informar o que já é o esperado. A ausência do card É a
 * ausência de processo.
 *
 * ── O LINK PARA O PROCESSO SÓ SAI COM O MÓDULO ─────────────────────────────
 * A RLS deixa `processos` ser lida por quem tem `empresas` — é assim que o vendedor
 * vê que existe ação contra o sacado. Mas movimentação e parecer são só do Jurídico.
 * Oferecer um link que leva a /sem-acesso é pior que não oferecer link nenhum.
 */

export function SecaoJuridico({
  empresaId,
  podeAbrirProcesso,
}: {
  empresaId: string
  podeAbrirProcesso: boolean
}) {
  const processos = useQuery({
    queryKey: juridicoKeys.daEmpresa(empresaId),
    queryFn: () => buscarProcessosDaEmpresa(empresaId),
  })

  if (processos.isLoading) return <Skeleton className="h-32 w-full" />
  const linhas = processos.data ?? []
  if (linhas.length === 0) return null

  const ativos = linhas.filter((l) => situacaoEhAtiva(l.situacao_interna))
  const emDisputa = ativos.reduce((s, l) => s + Number(l.valor_atualizado ?? l.valor_causa ?? 0), 0)
  const recuperado = linhas.reduce((s, l) => s + Number(l.recuperado ?? 0), 0)

  return (
    <Card className={ativos.length > 0 ? 'border-destructive/40' : undefined}>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Gavel className="h-4 w-4" aria-hidden />
          Jurídico
        </CardTitle>
        {ativos.length > 0 ? (
          <Badge variant="destructive">
            {ativos.length} ação(ões) nossa(s) em curso
          </Badge>
        ) : (
          <Badge variant="outline">apenas ações encerradas</Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className="text-xs text-muted-foreground">Em disputa</div>
            <div className="text-lg font-semibold tabular-nums">{brl(emDisputa)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Recuperado</div>
            <div className="text-lg font-semibold tabular-nums">{brl(recuperado)}</div>
          </div>
        </div>

        {ativos.length > 0 ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">
            Enquanto houver ação nossa em curso, esta empresa é <strong>knockout de crédito</strong>: o
            scorecard não estima chance de concessão para quem estamos executando.
          </p>
        ) : null}

        <div className="space-y-2">
          {linhas.map((l) => {
            const conteudo = (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs">{l.numero_cnj}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {SITUACAO_INTERNA_LABELS[l.situacao_interna as SituacaoInterna] ?? l.situacao_interna}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  {[l.classe, faseLabel(l.fase_atual), data(l.data_distribuicao)].filter(Boolean).join(' · ')}
                </div>
              </>
            )
            return (
              <div key={l.numero_cnj} className="flex items-center justify-between gap-3 border-t border-border pt-2 first:border-t-0 first:pt-0">
                <div className="min-w-0">
                  {podeAbrirProcesso ? (
                    <Link href={`/juridico/${l.numero_cnj}`} className="block hover:underline">
                      {conteudo}
                    </Link>
                  ) : (
                    <div>{conteudo}</div>
                  )}
                </div>
                <span className="whitespace-nowrap text-sm tabular-nums">
                  {brl(l.valor_atualizado ?? l.valor_causa)}
                </span>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
