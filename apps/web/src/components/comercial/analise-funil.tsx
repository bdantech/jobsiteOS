'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowDown, Clock, TrendingDown } from 'lucide-react'
import {
  ESTAGIO_SDR_LABELS,
  ESTAGIO_VENDA_LABELS,
  type EstagioSdr,
  type EstagioVenda,
} from '@jobsiteos/core'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

/**
 * Conversão e lead time por etapa.
 *
 * ─── UMA SÉRIE, UM TOM ──────────────────────────────────────────────────────
 * O funil mostra UMA medida — quantos alcançaram cada etapa — então não há paleta
 * categórica para validar nem legenda a montar: o título já nomeia a série. Tom único do
 * `primary`, com a barra encolhendo etapa a etapa.
 *
 * ─── DUAS MEDIDAS, DOIS GRÁFICOS ────────────────────────────────────────────
 * Lead time não divide eixo com contagem. Sobrepor "quantos" e "quantos dias" no mesmo eixo
 * é o erro clássico de gráfico: as duas escalas não têm relação, e qualquer cruzamento
 * entre as linhas seria coincidência de escala lida como causalidade. São duas colunas
 * lado a lado, cada uma com sua régua.
 *
 * ─── A MEDIANA, E NÃO A MÉDIA ───────────────────────────────────────────────
 * Uma negociação esquecida há oito meses arrasta a média de toda a etapa e a faz parecer
 * lenta quando ela não é. A mediana ignora esse peso.
 *
 * ─── O QUE ESTA TELA NÃO SABE ───────────────────────────────────────────────
 * Lead time começou a ser medido em 23/08/2026 — antes disso não havia registro de
 * passagem por etapa, e não há como inferir. A tela DIZ isso quando a amostra é pequena,
 * em vez de mostrar um número que parece história e é véspera.
 */

export type FunilId = 'sdr' | 'vendedor'

interface EtapaAnalise {
  etapa: string
  ordem: number
  alcancaram: number
  aqui_agora: number
  morreram_aqui: number
  seguiram: number
  conversao: number | null
  dias_mediana: number | null
  amostras_tempo: number
}

async function buscarAnalise(funil: FunilId, vendedorId?: string | null): Promise<EtapaAnalise[]> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('app_funil_analise', {
    p: { funil, vendedor_id: vendedorId ?? null } as never,
  })
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as EtapaAnalise[]
}

function rotulo(funil: FunilId, etapa: string): string {
  return funil === 'sdr'
    ? (ESTAGIO_SDR_LABELS[etapa as EstagioSdr] ?? etapa)
    : (ESTAGIO_VENDA_LABELS[etapa as EstagioVenda] ?? etapa)
}

const PCT = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 0 })

/** Dias com uma casa só abaixo de 10: "0,5 dia" informa, "0,54 dia" só ocupa espaço. */
function dias(v: number): string {
  return v < 10 ? `${v.toFixed(1).replace('.', ',')}d` : `${Math.round(v)}d`
}

export function AnaliseFunil({
  funil,
  vendedorId,
  compacto,
}: {
  funil: FunilId
  vendedorId?: string | null
  /** No painel do vendedor a tela é uma seção, não uma página: sem cabeçalho próprio. */
  compacto?: boolean
}) {
  const analise = useQuery({
    queryKey: ['analise-funil', funil, vendedorId ?? 'todos'],
    queryFn: () => buscarAnalise(funil, vendedorId),
  })

  if (analise.isPending) return <Skeleton className="h-80 w-full rounded-lg" />
  if (analise.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Não foi possível carregar a análise</CardTitle>
          <CardDescription>{(analise.error as Error).message}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const etapas = analise.data ?? []
  const topo = etapas[0]?.alcancaram ?? 0
  const semTempo = etapas.every((e) => e.amostras_tempo === 0)
  const maiorTempo = Math.max(1, ...etapas.map((e) => e.dias_mediana ?? 0))

  // A pior passagem do funil, ignorando etapas sem gente: é a frase que a página existe
  // para dizer, e ela não deve exigir que alguém compare oito barras de cabeça.
  const gargalo = etapas
    .filter((e) => e.conversao !== null && e.alcancaram > 0)
    .sort((a, b) => (a.conversao ?? 1) - (b.conversao ?? 1))[0]

  const conteudo = (
    <div className="space-y-4">
      {topo === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nenhum card neste recorte ainda.
        </p>
      ) : (
        <>
          {gargalo && (gargalo.conversao ?? 1) < 1 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
              <TrendingDown className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
              <p className="text-sm">
                Maior perda em <strong>{rotulo(funil, gargalo.etapa)}</strong>: de{' '}
                {gargalo.alcancaram} que chegaram, {gargalo.seguiram} seguiram (
                {PCT.format(gargalo.conversao ?? 0)}).
              </p>
            </div>
          )}

          <TooltipProvider delayDuration={200}>
            <div className="space-y-1">
              {/* Cabeçalho das duas réguas. Elas são independentes de propósito — ver o
                  comentário de "duas medidas, dois gráficos" no topo do arquivo. */}
              <div className="flex items-end gap-3 pb-1 text-[11px] font-medium text-muted-foreground">
                <span className="w-44 shrink-0">Etapa</span>
                <span className="flex-1">Alcançaram</span>
                <span className="w-28 shrink-0 text-right">Tempo mediano</span>
              </div>

              {etapas.map((e, i) => {
                const largura = topo > 0 ? Math.max(2, (e.alcancaram / topo) * 100) : 0
                const larguraTempo =
                  e.dias_mediana !== null ? Math.max(2, (e.dias_mediana / maiorTempo) * 100) : 0
                return (
                  <div key={e.etapa} className="space-y-1">
                    <div className="flex items-center gap-3">
                      <span className="w-44 shrink-0 truncate text-xs" title={rotulo(funil, e.etapa)}>
                        {rotulo(funil, e.etapa)}
                      </span>

                      <div className="flex-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex h-6 items-center">
                              <div
                                className="h-5 rounded-sm bg-primary/80 transition-all hover:bg-primary"
                                style={{ width: `${largura}%` }}
                              />
                              {/* O número fica FORA da barra, em tinta de texto: dentro
                                  ele sumiria nas etapas curtas, e pintá-lo com a cor da
                                  série faria texto competir com marca. */}
                              <span className="ml-2 text-xs tabular-nums text-muted-foreground">
                                {e.alcancaram}
                                {e.morreram_aqui > 0 && (
                                  <span className="ml-1 text-destructive">
                                    ({e.morreram_aqui} perdidos aqui)
                                  </span>
                                )}
                              </span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            <p className="font-medium">{rotulo(funil, e.etapa)}</p>
                            <p>{e.alcancaram} alcançaram · {e.aqui_agora} estão aqui agora</p>
                            {e.conversao !== null && (
                              <p>{e.seguiram} seguiram ({PCT.format(e.conversao)})</p>
                            )}
                          </TooltipContent>
                        </Tooltip>
                      </div>

                      <div className="w-28 shrink-0">
                        {e.dias_mediana !== null ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex items-center justify-end gap-1.5">
                                <div className="h-2 max-w-14 flex-1 rounded-sm bg-muted">
                                  <div
                                    className="h-2 rounded-sm bg-foreground/40"
                                    style={{ width: `${larguraTempo}%` }}
                                  />
                                </div>
                                <span className="text-xs tabular-nums text-muted-foreground">
                                  {dias(e.dias_mediana)}
                                </span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              Mediana de {dias(e.dias_mediana)} nesta etapa, sobre{' '}
                              {e.amostras_tempo} passagem{e.amostras_tempo > 1 ? 's' : ''}.
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <p className="text-right text-xs text-muted-foreground">—</p>
                        )}
                      </div>
                    </div>

                    {/* A conversão vive ENTRE as barras porque é o que acontece entre uma
                        etapa e a próxima — não um atributo de nenhuma das duas. */}
                    {i < etapas.length - 1 && e.conversao !== null && (
                      <div className="flex items-center gap-3">
                        <span className="w-44 shrink-0" />
                        <span
                          className={cn(
                            'flex items-center gap-1 text-[11px] tabular-nums',
                            e.conversao < 0.5 ? 'text-amber-600' : 'text-muted-foreground',
                          )}
                        >
                          <ArrowDown className="h-3 w-3" aria-hidden />
                          {PCT.format(e.conversao)}
                        </span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </TooltipProvider>

          {semTempo && (
            <p className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-[0.8rem] text-muted-foreground">
              <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                O tempo por etapa começou a ser medido em <strong>23/08/2026</strong>. Antes
                disso não havia registro de passagem, e não dá para inferir — a coluna se
                preenche conforme os cards andarem.
              </span>
            </p>
          )}
        </>
      )}
    </div>
  )

  if (compacto) return conteudo

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Conversão e tempo por etapa</CardTitle>
        <CardDescription>
          Quantos chegaram a cada etapa e quanto tempo ficaram nela. &quot;Alcançaram&quot; sai
          da posição atual dos cards — perder não move o card, então o estágio de um negócio
          morto continua dizendo até onde ele chegou.
        </CardDescription>
      </CardHeader>
      <CardContent>{conteudo}</CardContent>
    </Card>
  )
}
