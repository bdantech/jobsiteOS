'use client'

import * as React from 'react'
import { Loader2, PlayCircle, ShieldCheck, TriangleAlert } from 'lucide-react'
import type { Tables } from '@jobsiteos/core'
import { Badge, STATUS_SUPERFICIE } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/**
 * O PAINEL DA SIMULAÇÃO (§3).
 *
 * A cascata é a informação: total → elegíveis → excluídos POR MOTIVO. Mostrar só
 * "340 de 1.200" manda a pessoa mexer no filtro quando o problema era
 * enriquecimento — e são 860 empresas de diferença entre as duas conclusões.
 */

export interface Simulacao {
  total_empresas: number
  elegiveis: number
  exclusoes: Record<string, number>
  duracao: string
  avisos: string[]
  descricao_publico: string
  previas: {
    variante_id: string
    template_nome: string | null
    assunto: string | null
    corpo: string
    destinatario: string
    termos_estranhos: { tipo: string; trecho: string }[]
  }[]
}

export function PainelSimulacao({
  campanha,
  carregando,
  onSimular,
  onAprovar,
}: {
  campanha: Tables<'campanhas'> | null
  carregando: boolean
  onSimular: () => void
  onAprovar: () => void
}) {
  const sim = (campanha?.simulacao ?? null) as Simulacao | null

  if (!campanha || carregando) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          {carregando ? (
            <>
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground">
                Montando o público e aplicando as exclusões…
              </p>
            </>
          ) : (
            <>
              <PlayCircle className="h-6 w-6 text-muted-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground">
                Rode a simulação para ver quem receberia, quem não receberia e por quê.
              </p>
              <Button onClick={onSimular}>Salvar e simular</Button>
            </>
          )}
        </CardContent>
      </Card>
    )
  }

  if (!sim) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Sem simulação ainda.
        </CardContent>
      </Card>
    )
  }

  const excluidos = sim.total_empresas - sim.elegiveis
  const podeAprovar = campanha.status === 'aguardando_aprovacao' && sim.elegiveis > 0

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">O que sairia</CardTitle>
          <CardDescription>{sim.descricao_publico}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Numero rotulo="Empresas no público" valor={sim.total_empresas} />
            <Numero rotulo="Destinatários elegíveis" valor={sim.elegiveis} destaque />
            <Numero rotulo="Excluídos" valor={excluidos} />
          </div>

          <p className="rounded-md border bg-muted/40 p-3 text-sm">{sim.duracao}</p>

          {Object.keys(sim.exclusoes).length > 0 && (
            <div>
              <p className="mb-1.5 text-xs text-muted-foreground">Por que os outros ficaram de fora</p>
              <ul className="space-y-1">
                {Object.entries(sim.exclusoes)
                  .sort((a, b) => b[1] - a[1])
                  .map(([motivo, n]) => (
                    <li key={motivo} className="flex items-baseline justify-between gap-3 text-sm">
                      <span>{motivo}</span>
                      <span className="tabular-nums text-muted-foreground">{n}</span>
                    </li>
                  ))}
              </ul>
            </div>
          )}

          {sim.avisos.length > 0 && (
            <div
              className={cn(
                'flex items-start gap-2 rounded-lg border p-3 text-sm',
                STATUS_SUPERFICIE.warning,
              )}
            >
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <ul className="space-y-1">
                {sim.avisos.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {sim.previas.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Prévia de cada variante</CardTitle>
            <CardDescription>
              Renderizada com dados de destinatários reais — não com um nome de exemplo, que é
              como um template quebrado passa despercebido.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {sim.previas.map((p) => (
              <div key={p.variante_id} className="rounded-lg border p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{p.variante_id}</Badge>
                  <span className="text-sm font-medium">{p.template_nome}</span>
                  <span className="text-xs text-muted-foreground">para {p.destinatario}</span>
                </div>
                {p.assunto && <p className="mb-1 text-sm font-medium">{p.assunto}</p>}
                <pre className="whitespace-pre-wrap font-sans text-sm text-muted-foreground">
                  {p.corpo}
                </pre>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            Aprovar agenda a campanha. Cada mensagem ainda passa pelo portão no instante do
            envio — quem virar suprimido no meio do caminho não recebe.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onSimular}>
              Simular de novo
            </Button>
            <Button onClick={onAprovar} disabled={!podeAprovar}>
              Aprovar e agendar
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function Numero({
  rotulo,
  valor,
  destaque,
}: {
  rotulo: string
  valor: number
  destaque?: boolean
}) {
  return (
    <div className={cn('rounded-lg border p-3', destaque && 'border-primary')}>
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="text-2xl font-semibold tabular-nums">{valor.toLocaleString('pt-BR')}</p>
    </div>
  )
}
