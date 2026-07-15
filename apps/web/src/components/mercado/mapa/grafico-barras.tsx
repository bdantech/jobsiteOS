'use client'

import * as React from 'react'
import { Table2 } from 'lucide-react'
import { CAMADAS, CAMADA_LABELS, type Camada } from '@jobsiteos/core'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { FatiaDistribuicao } from '../queries'
import { CAMADA_FUNDO, ChipCamada, FUNDO_SERIE_UNICA } from './camadas'
import { formatCompacto, formatNumero, formatPct } from './format'

interface GraficoBarrasProps {
  titulo: string
  descricao: string
  fatias: FatiaDistribuicao[]
  /**
   * Stacked by camada (UF, porte) or one flat bar per row (tipo). A flat bar is a
   * SINGLE series, so it takes the anchor of the ramp and needs no legend — the title
   * names it. Colouring the flat bars by their own value would spend the identity
   * channel re-encoding what the bar length already shows.
   */
  empilhar: boolean
  /** A slice was clicked: `camada` is null when the reader clicked the row, not a segment. */
  aoSelecionar: (fatia: FatiaDistribuicao, camada: Camada | null) => void
}

interface Tooltip {
  x: number
  y: number
  titulo: string
  detalhe: string
  valor: string
  /** The token class of the segment hovered — never a hex: the ramp inverts in dark mode. */
  fundo: string
}

export function GraficoBarras({
  titulo,
  descricao,
  fatias,
  empilhar,
  aoSelecionar,
}: GraficoBarrasProps) {
  const [tabela, setTabela] = React.useState(false)
  const [tooltip, setTooltip] = React.useState<Tooltip | null>(null)

  // Bars share one scale — the biggest row fills the track — so the rows are
  // comparable to each other and not each to itself.
  const maximo = fatias.reduce((maior, f) => Math.max(maior, f.total), 0)
  const totalGeral = fatias.reduce((soma, f) => soma + f.total, 0)

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="text-base">{titulo}</CardTitle>
          <CardDescription>{descricao}</CardDescription>
        </div>
        {/* The table view is not a nicety: the first step of the ramp sits below 3:1
            against the surface on purpose, and this is the relief that makes that legal. */}
        <button
          type="button"
          onClick={() => setTabela((v) => !v)}
          aria-pressed={tabela}
          className="flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Table2 className="h-3.5 w-3.5" aria-hidden />
          {tabela ? 'Ver gráfico' : 'Ver tabela'}
        </button>
      </CardHeader>

      <CardContent>
        {fatias.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Sem dados para este recorte.
          </p>
        ) : tabela ? (
          <TabelaDistribuicao fatias={fatias} empilhar={empilhar} />
        ) : (
          <>
            {/* Four series: the legend is always there. Identity is never colour alone. */}
            {empilhar && <Legenda />}

            <div className="space-y-2.5">
              {fatias.map((fatia) => {
                const largura = maximo > 0 ? (fatia.total / maximo) * 100 : 0

                return (
                  <div key={fatia.label} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 truncate text-xs text-muted-foreground sm:w-36">
                      {fatia.label}
                    </span>

                    <div className="min-w-0 flex-1">
                      {/* gap-[2px]: the surface gap. Two adjacent steps of a one-hue ramp
                          only stay legible if the fills never touch — and it is a GAP, not
                          a stroke, so no ink is added that is not data. */}
                      <div
                        className="flex h-4 gap-[2px]"
                        style={{ width: `${Math.max(largura, fatia.total > 0 ? 1 : 0)}%` }}
                      >
                        {empilhar ? (
                          CAMADAS.filter((camada) => fatia.porCamada[camada] > 0).map(
                            (camada, indice, visiveis) => (
                              <Segmento
                                key={camada}
                                // Segment widths are shares OF THE ROW; the row itself
                                // already carries the row's share of the scale.
                                largura={(fatia.porCamada[camada] / fatia.total) * 100}
                                fundo={CAMADA_FUNDO[camada]}
                                ultimo={indice === visiveis.length - 1}
                                rotulo={`${fatia.label} · ${CAMADA_LABELS[camada]}: ${formatNumero(
                                  fatia.porCamada[camada],
                                )} empresas. Abrir no Explorador.`}
                                aoEntrar={(x, y) =>
                                  setTooltip({
                                    x,
                                    y,
                                    titulo: fatia.label,
                                    detalhe: CAMADA_LABELS[camada],
                                    valor: `${formatNumero(fatia.porCamada[camada])} (${formatPct(
                                      fatia.total > 0 ? fatia.porCamada[camada] / fatia.total : 0,
                                    )} da linha)`,
                                    fundo: CAMADA_FUNDO[camada],
                                  })
                                }
                                aoSair={() => setTooltip(null)}
                                aoClicar={() => aoSelecionar(fatia, camada)}
                              />
                            ),
                          )
                        ) : (
                          <Segmento
                            largura={100}
                            fundo={FUNDO_SERIE_UNICA}
                            ultimo
                            rotulo={`${fatia.label}: ${formatNumero(fatia.total)} empresas. Abrir no Explorador.`}
                            aoEntrar={(x, y) =>
                              setTooltip({
                                x,
                                y,
                                titulo: fatia.label,
                                detalhe: 'Empresas',
                                valor: `${formatNumero(fatia.total)} (${formatPct(
                                  totalGeral > 0 ? fatia.total / totalGeral : 0,
                                )} do total)`,
                                fundo: FUNDO_SERIE_UNICA,
                              })
                            }
                            aoSair={() => setTooltip(null)}
                            aoClicar={() => aoSelecionar(fatia, null)}
                          />
                        )}
                      </div>
                    </div>

                    {/* Direct label on every row: the numbers never depend on the colour. */}
                    <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                      {formatCompacto(fatia.total)}
                    </span>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </CardContent>

      {tooltip && (
        <div
          role="presentation"
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-md border bg-popover px-3 py-2 text-xs shadow-md"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <p className="font-medium text-popover-foreground">{tooltip.titulo}</p>
          <p className="mt-1 flex items-center gap-1.5 text-muted-foreground">
            <span
              aria-hidden
              className={cn('inline-block h-2.5 w-2.5 rounded-sm', tooltip.fundo)}
            />
            {tooltip.detalhe}
          </p>
          <p className="mt-0.5 tabular-nums text-popover-foreground">{tooltip.valor}</p>
        </div>
      )}
    </Card>
  )
}

interface SegmentoProps {
  largura: number
  /** A `bg-chart-*` token class. Never an inline colour — dark mode flips the ramp. */
  fundo: string
  ultimo: boolean
  rotulo: string
  aoEntrar: (x: number, y: number) => void
  aoSair: () => void
  aoClicar: () => void
}

/**
 * One stacked segment. A real <button>: the whole point of the chart is that every
 * slice is a drill-down, and a drill-down that only a mouse can reach is half a
 * feature.
 *
 * Square at the baseline (the left edge, where the bar grows from), 4px round at the
 * data end — the bar has to LOOK anchored to zero, and a rounded left edge would fake
 * a value the row does not have.
 */
function Segmento({
  largura,
  fundo,
  ultimo,
  rotulo,
  aoEntrar,
  aoSair,
  aoClicar,
}: SegmentoProps) {
  return (
    <button
      type="button"
      aria-label={rotulo}
      onClick={aoClicar}
      onMouseMove={(event) => aoEntrar(event.clientX, event.clientY)}
      onMouseLeave={aoSair}
      onBlur={aoSair}
      className={cn(
        'h-full min-w-[3px] cursor-pointer transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        fundo,
        ultimo && 'rounded-r-[4px]',
      )}
      style={{ width: `${largura}%` }}
    />
  )
}

function Legenda() {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {CAMADAS.map((camada) => (
        <span key={camada} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ChipCamada camada={camada} />
          {CAMADA_LABELS[camada]}
        </span>
      ))}
    </div>
  )
}

/** The table view. Present on every chart — it is what makes the numbers readable
 *  without any colour at all. */
function TabelaDistribuicao({
  fatias,
  empilhar,
}: {
  fatias: FatiaDistribuicao[]
  empilhar: boolean
}) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Faixa</TableHead>
            {empilhar &&
              CAMADAS.map((camada) => (
                <TableHead key={camada} className="text-right">
                  {CAMADA_LABELS[camada]}
                </TableHead>
              ))}
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {fatias.map((fatia) => (
            <TableRow key={fatia.label}>
              <TableCell className="font-medium">{fatia.label}</TableCell>
              {empilhar &&
                CAMADAS.map((camada) => (
                  <TableCell key={camada} className="text-right tabular-nums">
                    {formatNumero(fatia.porCamada[camada])}
                  </TableCell>
                ))}
              <TableCell className="text-right tabular-nums">{formatNumero(fatia.total)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
