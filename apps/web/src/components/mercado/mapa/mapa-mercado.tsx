'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, DatabaseZap, Info, Map, X } from 'lucide-react'
import {
  CAMADA_DESCRICOES,
  CAMADA_LABELS,
  type Camada,
  type Condicao,
} from '@jobsiteos/core'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { TODOS, UFS } from '@/components/empresas/constants'
import { CirculosCamadas, type DadosCamada } from '../camadas/circulos-camadas'
import {
  buscarMapa,
  FILTROS_MAPA_VAZIOS,
  LIMITE_AMOSTRA,
  mercadoKeys,
  temFiltroMapa,
  type FatiaDistribuicao,
  type FiltrosMapa,
  type IndicadoresCamada,
} from '../queries'
import {
  formatAnos,
  formatCompacto,
  formatDecimal,
  formatM2,
  formatMoeda,
  formatNumero,
  formatPct,
} from './format'
import { GraficoBarras } from './grafico-barras'
import { useAbrirExplorador } from './use-abrir-explorador'

/**
 * The nine indicators that used to be a list inside each layer card. They now live in
 * the diagram's side panel — same numbers, same formatters, same estimate mark: a value
 * computed over the sample carries "~", an exact one does not, and a missing one ("—")
 * is never marked, because there is nothing to have estimated.
 */
function metricasDe(indicadores: IndicadoresCamada): DadosCamada['metricas'] {
  const marcar = (valor: string): string =>
    indicadores.estimado && valor !== '—' ? `${valor} ~` : valor

  return [
    { label: 'Idade média', valor: marcar(formatAnos(indicadores.idadeMedia)) },
    { label: 'Capital social médio', valor: marcar(formatMoeda(indicadores.capitalMedio)) },
    { label: 'Capital social mediano', valor: marcar(formatMoeda(indicadores.capitalMediano)) },
    { label: 'ERP identificado', valor: marcar(formatPct(indicadores.pctErp)) },
    { label: 'Contato conhecido', valor: marcar(formatPct(indicadores.pctContato)) },
    { label: 'No grafo SEFAZ', valor: marcar(formatPct(indicadores.pctSefaz)) },
    { label: 'SPEs por grupo', valor: marcar(formatDecimal(indicadores.spesPorGrupo)) },
    { label: 'Obras ativas', valor: marcar(formatNumero(indicadores.obrasAtivas)) },
    { label: 'm² em execução', valor: marcar(formatM2(indicadores.m2EmExecucao)) },
  ]
}

/**
 * The layer's description, plus the per-layer sample footnote the card used to carry.
 * The page-level banner says WHAT is estimated; only this says over how many rows of
 * THIS layer — and dropping it would leave the "~" marks unexplained.
 */
function descricaoDe(indicadores: IndicadoresCamada): string {
  const base = CAMADA_DESCRICOES[indicadores.camada]
  if (!indicadores.estimado) return base

  return `${base} ~ Estimado sobre uma amostra de ${formatCompacto(
    indicadores.amostra,
  )} de ${formatNumero(indicadores.total)} empresas. A contagem é exata.`
}

export function MapaMercado() {
  const [filtros, setFiltros] = React.useState<FiltrosMapa>(FILTROS_MAPA_VAZIOS)
  const [selecionada, setSelecionada] = React.useState<Camada | null>(null)
  const abrirExplorador = useAbrirExplorador()

  const { data, isPending, isError, error, isFetching, refetch } = useQuery({
    queryKey: mercadoKeys.mapa(filtros),
    queryFn: () => buscarMapa(filtros),
    placeholderData: (anterior) => anterior,
  })

  const filtrado = temFiltroMapa(filtros)

  const camadas = React.useMemo<DadosCamada[]>(() => {
    if (!data) return []

    return data.camadas.map((indicadores) => ({
      camada: indicadores.camada,
      total: indicadores.total,
      // The panel prints this number followed by "%", so it must already BE a
      // percentage — one decimal, which is the precision formatPct showed on the card.
      participacao:
        data.totalGeral > 0
          ? Math.round((indicadores.total / data.totalGeral) * 1000) / 10
          : 0,
      metricas: metricasDe(indicadores),
      descricao: descricaoDe(indicadores),
    }))
  }, [data])

  /**
   * The drill-down: the Explorador, in a new tab, pre-filtered by the layer AND by
   * whatever the Mapa is filtered by — the reader must land on the same rows the figure
   * just counted.
   *
   * It is no longer wired to the click on the ring. Clicking now SELECTS the layer and
   * opens its panel, and this runs from a button inside that panel: navigating away in
   * a new tab is too consequential to be the accidental outcome of poking at a diagram.
   */
  const abrirCamada = React.useCallback(
    (camada: Camada) => {
      const condicoes: Condicao[] = [{ variavel: 'camada', operador: 'igual', valor: camada }]
      if (filtros.uf) condicoes.push({ variavel: 'uf', operador: 'igual', valor: filtros.uf })
      if (filtros.tipo) condicoes.push({ variavel: 'tipo', operador: 'igual', valor: filtros.tipo })
      abrirExplorador(condicoes, `Explorador · ${CAMADA_LABELS[camada]}`)
    },
    [abrirExplorador, filtros.tipo, filtros.uf],
  )

  const acaoExplorador = React.useMemo(
    () => ({ label: 'Abrir no Explorador', onClick: abrirCamada }),
    [abrirCamada],
  )

  /**
   * The click-through contract, in one place. Every slice compiles to a filter tree
   * over the SAME catalog the Explorador validates against, so a link that opens here
   * cannot produce a filter the Explorador refuses.
   *
   * `dimensao` is the column the chart is cut by; the Mapa's own filter on that same
   * column is dropped, because the slice already says it (clicking "SP" while filtering
   * on SP must not emit `uf = SP AND uf = SP`).
   */
  const selecionar = React.useCallback(
    (dimensao: 'uf' | 'porte_rfb' | 'tipo', fatia: FatiaDistribuicao, camada: Camada | null) => {
      const condicoes: Condicao[] = []

      if (fatia.agrupa && fatia.agrupa.length > 0) {
        condicoes.push({ variavel: dimensao, operador: 'em', valor: fatia.agrupa })
      } else if (fatia.chave === null) {
        condicoes.push({ variavel: dimensao, operador: 'nao_definido' })
      } else {
        condicoes.push({ variavel: dimensao, operador: 'igual', valor: fatia.chave })
      }

      if (camada) condicoes.push({ variavel: 'camada', operador: 'igual', valor: camada })
      if (filtros.uf && dimensao !== 'uf') {
        condicoes.push({ variavel: 'uf', operador: 'igual', valor: filtros.uf })
      }
      if (filtros.tipo && dimensao !== 'tipo') {
        condicoes.push({ variavel: 'tipo', operador: 'igual', valor: filtros.tipo })
      }

      const sufixo = camada ? ` · ${CAMADA_LABELS[camada]}` : ''
      abrirExplorador(condicoes, `Explorador · ${fatia.label}${sufixo}`)
    },
    [abrirExplorador, filtros.tipo, filtros.uf],
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Mapa do Mercado</h1>
          <p className="text-sm text-muted-foreground">
            Universo → TAM → SAM → SOM: quem existe, quem se encaixa e quem dá para ganhar.
            Clique em uma camada para ver os indicadores dela, ou em uma fatia para abrir o
            Explorador já filtrado.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Select
            value={filtros.uf ?? TODOS}
            onValueChange={(valor) =>
              setFiltros((f) => ({ ...f, uf: valor === TODOS ? null : valor }))
            }
          >
            <SelectTrigger className="w-28" aria-label="Filtrar o mapa por UF">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              <SelectItem value={TODOS}>UF</SelectItem>
              {UFS.map((uf) => (
                <SelectItem key={uf} value={uf}>
                  {uf}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filtros.tipo ?? TODOS}
            onValueChange={(valor) =>
              setFiltros((f) => ({
                ...f,
                tipo: valor === TODOS ? null : (valor as 'construtora' | 'fornecedor'),
              }))
            }
          >
            <SelectTrigger className="w-44" aria-label="Filtrar o mapa por tipo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos os tipos</SelectItem>
              <SelectItem value="construtora">Construtora</SelectItem>
              <SelectItem value="fornecedor">Fornecedor</SelectItem>
            </SelectContent>
          </Select>

          {filtrado && (
            <Button variant="ghost" size="sm" onClick={() => setFiltros(FILTROS_MAPA_VAZIOS)}>
              <X className="mr-2 h-4 w-4" />
              Limpar
            </Button>
          )}
        </div>
      </div>

      {isPending ? (
        <MapaEsqueleto />
      ) : isError ? (
        <Erro
          mensagem={error instanceof Error ? error.message : 'Erro desconhecido.'}
          onTentar={() => void refetch()}
        />
      ) : data.totalGeral === 0 ? (
        <Vazio filtrado={filtrado} onLimpar={() => setFiltros(FILTROS_MAPA_VAZIOS)} />
      ) : (
        <div className="space-y-6">
          {data.estimado && <AvisoEstimativa />}

          <Card className="shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">As quatro camadas</CardTitle>
              <CardDescription>
                SOM ⊂ SAM ⊂ TAM ⊂ Universo. Clique em uma camada para ver os indicadores dela e
                abrir o Explorador já filtrado.
              </CardDescription>
            </CardHeader>

            <CardContent>
              <CirculosCamadas
                dados={camadas}
                selecionada={selecionada}
                onSelecionar={setSelecionada}
                acao={acaoExplorador}
              />
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <GraficoBarras
              titulo="UF × camada"
              descricao={`Onde o mercado está, e quanto de cada estado sobe na pirâmide. ${formatNumero(
                data.totalGeral,
              )} empresas.`}
              fatias={data.porUf}
              empilhar
              aoSelecionar={(fatia, camada) => selecionar('uf', fatia, camada)}
            />

            <GraficoBarras
              titulo="Porte × camada"
              descricao="Porte declarado à Receita. Empresa de porte não é o mesmo que empresa qualificada — o cruzamento com a camada mostra a diferença."
              fatias={data.porPorte}
              empilhar
              aoSelecionar={(fatia, camada) => selecionar('porte_rfb', fatia, camada)}
            />
          </div>

          <GraficoBarras
            titulo="Tipo"
            descricao="Só as empresas promovidas têm tipo — quem ainda está no staging da Receita aparece como não classificada."
            fatias={data.porTipo}
            empilhar={false}
            aoSelecionar={(fatia) => selecionar('tipo', fatia, null)}
          />

          <p className="flex h-5 items-center text-xs text-muted-foreground">
            {isFetching ? 'Atualizando…' : `Total no recorte: ${formatNumero(data.totalGeral)}`}
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * The honest disclaimer. PostgREST aggregate functions are disabled on this project,
 * so the API can only give us exact COUNTS — everything distributional (médias,
 * mediana, somas de obras e m²) is computed over a bounded sample of each layer.
 * A dashboard that quietly rounded that off would be lying to the person reading it.
 */
function AvisoEstimativa() {
  return (
    <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <p className="text-muted-foreground">
        As <strong className="font-medium text-foreground">contagens são exatas</strong>. As médias,
        a mediana e as somas de obras e m² são estimadas sobre uma amostra de até{' '}
        {formatCompacto(LIMITE_AMOSTRA)} empresas por camada, e as distribuições são projetadas a
        partir dela.
      </p>
    </div>
  )
}

function MapaEsqueleto() {
  return (
    <div className="space-y-6">
      <Card className="shadow-none">
        <CardContent className="flex flex-col items-center gap-5 p-6">
          {/* The figure is a circle, so its placeholder is one: a square block here would
              snap into a disc on load. */}
          <Skeleton className="aspect-square w-full max-w-[260px] rounded-full" />
          <Skeleton className="h-4 w-64" />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="space-y-3 p-6">
              <Skeleton className="h-5 w-40" />
              {Array.from({ length: 8 }).map((__, j) => (
                <Skeleton key={j} className="h-4 w-full" />
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

/**
 * The state a reviewer actually sees today: the worker has never run, so the universe
 * is empty. It has to say WHY there is nothing here and WHERE to go — an empty chart
 * grid would read as a bug.
 */
function Vazio({ filtrado, onLimpar }: { filtrado: boolean; onLimpar: () => void }) {
  if (filtrado) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-4 py-20 text-center">
          <div className="rounded-full bg-muted p-3">
            <Map className="h-6 w-6 text-muted-foreground" aria-hidden />
          </div>
          <div className="space-y-1">
            <p className="text-lg font-medium">Nenhuma empresa neste recorte</p>
            <p className="max-w-md text-sm text-muted-foreground">
              O universo tem empresas, mas nenhuma delas passa pelos filtros aplicados.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={onLimpar}>
            Limpar filtros
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-5 py-20 text-center">
        <div className="rounded-full bg-muted p-4">
          <DatabaseZap className="h-7 w-7 text-muted-foreground" aria-hidden />
        </div>

        <div className="space-y-2">
          <p className="text-lg font-medium">
            O universo ainda não foi ingerido — rode a ingestão da Receita
          </p>
          <p className="mx-auto max-w-lg text-sm leading-relaxed text-muted-foreground">
            O Mapa lê o universo de CNPJs da Receita Federal (construção: CNAEs 41, 42 e 43),
            cruzado com sócios, grupos econômicos e obras do CNO. Enquanto a primeira ingestão não
            roda, não há nada para classificar em TAM, SAM ou SOM.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button asChild>
            <Link href="/mercado/ingestoes">Ir para Ingestões</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/mercado/piramide">Revisar as regras das camadas</Link>
          </Button>
        </div>

        <p className="max-w-lg text-xs leading-relaxed text-muted-foreground">
          A ingestão é mensal e roda no worker (Receita → staging → grupos → camadas). Depois dela,
          esta página passa a mostrar contagem, idade média, capital social, cobertura de ERP e
          obras por camada.
        </p>
      </CardContent>
    </Card>
  )
}

function Erro({ mensagem, onTentar }: { mensagem: string; onTentar: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-4 py-20 text-center">
        <div className="rounded-full bg-destructive/10 p-3">
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
        </div>
        <div className="space-y-1">
          <p className="text-lg font-medium">Não foi possível carregar o Mapa</p>
          <p className="max-w-md text-sm text-muted-foreground">{mensagem}</p>
        </div>
        <Button variant="outline" size="sm" onClick={onTentar}>
          Tentar novamente
        </Button>
      </CardContent>
    </Card>
  )
}
