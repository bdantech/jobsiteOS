'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { CAMADAS, CAMADA_DESCRICOES, type Camada, type PromocaoCamada } from '@jobsiteos/core'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { CirculosCamadas, type DadosCamada } from '../camadas/circulos-camadas'
import { formatInteiro } from './constants'
import { PromocaoCard } from './promocao-card'
import { RegraCamada } from './regra-camada'
import { contarCamadas, piramideKeys } from './queries'

/**
 * Camadas do Mercado — the settings screen for the layer rules (§5.1), webOnly.
 *
 * The route is still /mercado/piramide, and stays: it is linked from the Mapa's empty
 * state and from saved tabs, and renaming a URL to match a heading buys nothing.
 *
 * ONE COLUMN, top to bottom: the diagram, then the rule of whatever layer is selected,
 * at full width. The old layout put the rule builder in a 28rem side column, where a
 * condition row (variável + operador + valor + remover) simply does not fit.
 *
 * The whole page is admin territory: the route guard already bounced anyone else
 * (a rule reclassifies ~2M rows and rewrites every number the commercial team
 * plans against), and each server action re-checks on its own. This component
 * therefore assumes an admin and offers the builder without further gating.
 */

interface PiramidePaginaProps {
  camadaPromocao: PromocaoCamada
}

export function PiramidePagina({ camadaPromocao }: PiramidePaginaProps) {
  /**
   * Nothing is selected at first — and here selecting is EDITING, not navigating. The
   * Mapa's rings open the Explorador; these open a rule editor, so opening one by
   * default would put an editor on screen for a layer nobody asked about.
   */
  const [selecionada, setSelecionada] = React.useState<Camada | null>(null)

  const { data, isPending, isError, error, refetch, isFetching } = useQuery({
    queryKey: piramideKeys.contagens(),
    queryFn: contarCamadas,
    // Counting 2M rows four times over is not free. The pyramid does not change
    // between renders — only a worker run moves it.
    staleTime: 60_000,
  })

  const camadas = React.useMemo<DadosCamada[]>(() => {
    if (!data) return []

    return CAMADAS.map((camada) => {
      const total = data.porCamada[camada] ?? 0

      return {
        camada,
        total,
        // Printed by the panel as "{n}% do universo", so it is already a percentage.
        participacao: data.total > 0 ? Math.round((total / data.total) * 1000) / 10 : 0,
        // No indicators on this screen: it is the rules editor, not the dashboard.
        // The numbers that matter here — count and share — the panel already prints.
        metricas: [],
        descricao: CAMADA_DESCRICOES[camada],
      }
    })
  }, [data])

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Camadas do Mercado</h1>
        <p className="text-sm text-muted-foreground">
          Universo → TAM → SAM → SOM. Cada camada é definida por uma regra versionada sobre os dados
          — nenhuma empresa muda de camada por decisão manual.
        </p>
      </header>

      {isPending ? (
        <CamadasCarregando />
      ) : isError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
            <div className="space-y-1">
              <p className="font-medium">Não foi possível carregar as camadas</p>
              <p className="max-w-md text-sm text-muted-foreground">
                {error instanceof Error ? error.message : 'Erro desconhecido.'}
              </p>
              <p className="max-w-md text-sm text-muted-foreground">
                A regra só pode ser editada quando as contagens carregam — a prévia depende delas.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">As quatro camadas</CardTitle>
              <CardDescription>
                {formatInteiro(data.total)} empresas no universo. Clique em uma camada para ver e
                editar a regra dela.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-3">
              <CirculosCamadas
                dados={camadas}
                selecionada={selecionada}
                onSelecionar={setSelecionada}
                dicaVazia="Clique em uma camada para ver e editar a regra dela."
                painel={false}
              />

              <div className="flex h-5 items-center justify-between text-xs text-muted-foreground">
                <span>
                  {data.semCamada > 0
                    ? `${formatInteiro(data.semCamada)} empresas ainda sem camada — importadas de lista e aguardando a próxima reclassificação.`
                    : 'Todas as empresas estão classificadas.'}
                </span>
                {isFetching && <span>Atualizando…</span>}
              </div>
            </CardContent>
          </Card>

          {/* Nada selecionado ⇒ nada aqui. O diagrama já traz a sua própria dica logo abaixo
              dos círculos; um card gigante de "Nenhuma camada selecionada" repetiria a mesma
              frase 200px mais para baixo e empurraria a promoção para fora da tela. */}
          {selecionada ? <RegraCamada camada={selecionada} contagens={data} /> : null}
        </>
      )}

      <PromocaoCard valorAtual={camadaPromocao} />
    </div>
  )
}

function CamadasCarregando() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-5 p-6">
        <Skeleton className="aspect-square w-full max-w-[260px] rounded-full" />
        <Skeleton className="h-4 w-64" />
      </CardContent>
    </Card>
  )
}
