'use client'

import { useQuery } from '@tanstack/react-query'
import { ArrowDownRight, ArrowUpRight, Coins, FileText, Radio } from 'lucide-react'
import { PAPEIS_COMISSAO, PAPEL_COMISSAO_LABELS, type PapelComissao } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { buscarPainelComissao, comissaoKeys } from '../queries-comissao'
import { brl, brlCurto, mesDaCompetencia, numero, variacao } from './format'

/**
 * O mês corrente, ao vivo.
 *
 * O badge "provisionado" fica ao lado do número grande de propósito: este é o único
 * lugar do sistema onde uma pessoa vê o próprio dinheiro antes de ele existir de fato, e
 * um total sem essa ressalva vira promessa. Provisionado ainda não é fechado, fechado
 * ainda não é aprovado, e aprovado ainda não é pago.
 */
export function MesCorrente({
  vendedorId,
  aoVivo,
}: {
  vendedorId: string | null
  aoVivo: boolean
}) {
  const { data, isPending } = useQuery({
    queryKey: comissaoKeys.painel(vendedorId),
    queryFn: () => buscarPainelComissao(vendedorId),
  })

  if (isPending) return <Skeleton className="h-48 w-full" />
  if (!data?.tem_acesso) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Sem acesso a esta comissão.
        </CardContent>
      </Card>
    )
  }

  const v = variacao(data.mes_corrente.total, data.mes_anterior.total)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Coins className="h-4 w-4" aria-hidden />
              {mesDaCompetencia(data.competencia)}
              {data.consolidado ? (
                <Badge variant="secondary" className="text-[10px]">consolidado</Badge>
              ) : null}
            </CardTitle>
            <span className="flex items-center gap-2">
              {aoVivo ? (
                <Badge variant="outline" className="gap-1 text-[10px]">
                  <Radio className="h-3 w-3 animate-pulse text-emerald-600" aria-hidden />
                  ao vivo
                </Badge>
              ) : null}
              <Badge className="bg-amber-100 text-[10px] text-amber-900 dark:bg-amber-500/20 dark:text-amber-200">
                provisionado
              </Badge>
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="text-3xl font-semibold tabular-nums">{brl(data.mes_corrente.total)}</span>
            {v ? (
              <span
                className={`flex items-center gap-1 text-xs ${
                  v.positiva ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'
                }`}
              >
                {v.positiva ? (
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <ArrowDownRight className="h-3.5 w-3.5" aria-hidden />
                )}
                {v.texto}
              </span>
            ) : null}
          </div>

          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div className="rounded-md border p-3">
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <FileText className="h-3.5 w-3.5" aria-hidden /> Cessões convertidas
              </dt>
              <dd className="text-lg font-medium tabular-nums">{numero(data.mes_corrente.cessoes)}</dd>
              <dd className="text-xs text-muted-foreground">
                {mesDaCompetencia(data.mes_anterior.competencia)}: {numero(data.mes_anterior.cessoes)}
              </dd>
            </div>
            <div className="rounded-md border p-3">
              <dt className="text-xs text-muted-foreground">Volume cedido (originação)</dt>
              <dd className="text-lg font-medium tabular-nums">{brlCurto(data.mes_corrente.volume_cedido)}</dd>
              <dd className="text-xs text-muted-foreground">
                soma do valor cedido das cessões deste extrato
              </dd>
            </div>
            <div className="rounded-md border p-3">
              <dt className="text-xs text-muted-foreground">Lançamentos</dt>
              <dd className="text-lg font-medium tabular-nums">{numero(data.mes_corrente.lancamentos)}</dd>
              <dd className="text-xs text-muted-foreground">
                cada cessão pode gerar mais de um papel
              </dd>
            </div>
          </dl>

          <div>
            <p className="mb-1.5 text-xs text-muted-foreground">Por papel</p>
            <ul className="flex flex-wrap gap-2">
              {PAPEIS_COMISSAO.map((p: PapelComissao) => {
                const total = data.mes_corrente.por_papel[p] ?? 0
                return (
                  <li
                    key={p}
                    className="flex items-baseline gap-2 rounded-md border px-3 py-1.5 text-sm"
                  >
                    <span className="text-muted-foreground">{PAPEL_COMISSAO_LABELS[p]}</span>
                    <span className="font-medium tabular-nums">{brl(total)}</span>
                  </li>
                )
              })}
            </ul>
          </div>

          <p className="text-xs text-muted-foreground">
            O lançamento nasce na CONVERSÃO da NF, não na liquidação — vendedor e originador
            não correm risco de crédito. O que reverte um lançamento é a cessão deixar de
            existir: status que regride ou NF cancelada.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
