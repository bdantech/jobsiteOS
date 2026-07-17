'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, ArrowDown, ArrowUp, Loader2, Minus } from 'lucide-react'
import { CAMADA_LABELS, descrever, type Camada, type CamadaComRegra, type Grupo } from '@jobsiteos/core'
import { ativarCamadaRegraAction, salvarCamadaRegraAction } from '@/actions/mercado-regras'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { STATUS_TEXTO } from '@/components/ui/badge'
import { formatInteiro, plural } from './constants'
import { piramideKeys, type Previsao } from './queries'

/**
 * The dry-run runs on the worker (POST /api/mercado/previa): a count over the
 * whole universe under RLS times out at 8s in the browser, so the worker — with a
 * direct pg connection and compileToSql, the same compiler the apply runs — scans
 * it and returns the impact. A non-2xx carries a pt-BR `error`, which becomes the
 * message under "Não foi possível calcular a prévia".
 */
async function buscarPrevia(camada: CamadaComRegra, arvore: Grupo): Promise<Previsao> {
  const resposta = await fetch('/api/mercado/previa', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ camada, definicao: arvore }),
  })
  if (!resposta.ok) {
    const corpo = (await resposta.json().catch(() => null)) as { error?: string } | null
    throw new Error(corpo?.error ?? 'Não foi possível calcular a prévia.')
  }
  return (await resposta.json()) as Previsao
}

/**
 * PREVIEW BEFORE SAVE — the load-bearing feature of §5.1.
 *
 * A camada rule is applied to ~2M rows by a background worker. By the time
 * anyone notices that "capital_social ≥ 5.000.000" emptied the SAM, the pyramid
 * every commercial plan is built on has already been rewritten. So the numbers
 * are shown BEFORE the write, and they are DERIVED — head-counts against
 * `mercado_explorador` compiled by the same engine the worker will run — never
 * estimated.
 */

type Modo =
  | { tipo: 'salvar'; arvore: Grupo }
  | { tipo: 'ativar'; arvore: Grupo; regraId: string; versao: number }

interface PreviewDialogProps {
  aberto: boolean
  onOpenChange: (aberto: boolean) => void
  camada: CamadaComRegra
  modo: Modo
  /** Called after a successful save/activation, so the panel can leave edit mode. */
  onConcluido: () => void
}

// ─── A frase ────────────────────────────────────────────────────────────────

function fraseDeDestinos(destinos: readonly { camada: Camada; total: number }[]): string {
  if (destinos.length === 0) return ''
  const partes = destinos.map((d) => `${formatInteiro(d.total)} para ${CAMADA_LABELS[d.camada]}`)
  return ` (${partes.join(', ')})`
}

function montarResumo(previsao: Previsao): string {
  const label = CAMADA_LABELS[previsao.camada]

  if (previsao.totalMovidas === 0) {
    return (
      `Esta regra não move nenhuma empresa: ${plural(previsao.permanecem, 'empresa', 'empresas')} ` +
      `${previsao.permanecem === 1 ? 'continua' : 'continuam'} em ${label}.`
    )
  }

  const partes: string[] = []
  if (previsao.subindo > 0) {
    partes.push(`${formatInteiro(previsao.subindo)} sobem para ${label}`)
  }
  if (previsao.descendo > 0) {
    partes.push(
      `${formatInteiro(previsao.descendo)} descem${fraseDeDestinos(previsao.destinos)}`,
    )
  }

  return `Esta regra move ${plural(previsao.totalMovidas, 'empresa', 'empresas')}: ${partes.join(', ')}.`
}

// ─── Números ────────────────────────────────────────────────────────────────

function Numero({
  icone,
  rotulo,
  valor,
  classe,
}: {
  icone: React.ReactNode
  rotulo: string
  valor: number
  classe: string
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className={`flex items-center gap-1.5 text-xs font-medium ${classe}`}>
        {icone}
        {rotulo}
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{formatInteiro(valor)}</p>
    </div>
  )
}

// ─── O diálogo ──────────────────────────────────────────────────────────────

export function PreviewDialog({
  aberto,
  onOpenChange,
  camada,
  modo,
  onConcluido,
}: PreviewDialogProps) {
  const [salvando, setSalvando] = React.useState(false)
  const queryClient = useQueryClient()

  const {
    data: previsao,
    isPending: calculando,
    isError,
    error,
    refetch,
  } = useQuery({
    // The tree is part of the key: edit a condition, get a different dry-run.
    queryKey: ['mercado', 'piramide', 'previsao', camada, modo.arvore],
    queryFn: () => buscarPrevia(camada, modo.arvore),
    enabled: aberto,
    // A count over the whole universe is expensive and the tree hasn't changed.
    staleTime: 60_000,
    retry: false,
  })

  const carregando = calculando

  async function confirmar(ativar: boolean) {
    setSalvando(true)

    const resultado =
      modo.tipo === 'ativar'
        ? await ativarCamadaRegraAction({ id: modo.regraId })
        : await salvarCamadaRegraAction({ camada, definicao: modo.arvore, ativar })

    setSalvando(false)

    if (!resultado.ok) {
      toast.error(resultado.message)
      return
    }

    await queryClient.invalidateQueries({ queryKey: piramideKeys.all })

    const regra = resultado.data
    const titulo =
      modo.tipo === 'ativar'
        ? `Versão ${regra.versao} ativada.`
        : ativar
          ? `Versão ${regra.versao} salva e ativada.`
          : `Versão ${regra.versao} salva (não ativada).`

    if (resultado.aviso) {
      toast.warning(titulo, { description: resultado.aviso, duration: 10_000 })
    } else {
      toast.success(titulo, {
        description:
          modo.tipo === 'ativar' || ativar
            ? 'A reclassificação do universo foi disparada no worker e pode levar alguns minutos.'
            : 'A regra ficou registrada no histórico. Ative quando quiser aplicá-la.',
      })
    }

    onOpenChange(false)
    onConcluido()
  }

  return (
    <Dialog open={aberto} onOpenChange={(proximo) => !salvando && onOpenChange(proximo)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {modo.tipo === 'ativar'
              ? `Ativar a versão ${modo.versao} da regra de ${CAMADA_LABELS[camada]}`
              : `Nova versão da regra de ${CAMADA_LABELS[camada]}`}
          </DialogTitle>
          <DialogDescription>
            Antes de gravar, veja o que esta regra faz com o universo hoje.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/40 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              A regra
            </p>
            <p className="mt-1 text-sm leading-relaxed">{descrever(modo.arvore)}</p>
          </div>

          {carregando ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Calculando o impacto sobre o universo…
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
              <Skeleton className="h-12 w-full" />
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center">
              <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
              <div className="space-y-1">
                <p className="font-medium">Não foi possível calcular a prévia</p>
                <p className="text-sm text-muted-foreground">
                  {error instanceof Error ? error.message : 'Erro desconhecido.'}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                Tentar novamente
              </Button>
            </div>
          ) : previsao ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Numero
                  icone={<ArrowUp className="h-3.5 w-3.5" aria-hidden />}
                  rotulo={`Sobem para ${CAMADA_LABELS[camada]}`}
                  valor={previsao.subindo}
                  // Canal de STATUS, não a marca: emparelhado com "Saem" em âmbar, este
                  // número quer dizer "movimento bom". `text-brand` fazia o navy da marca
                  // significar "positivo" — a identidade não classifica um delta.
                  classe={STATUS_TEXTO.success}
                />
                <Numero
                  icone={<ArrowDown className="h-3.5 w-3.5" aria-hidden />}
                  rotulo={`Saem de ${CAMADA_LABELS[camada]}`}
                  valor={previsao.descendo}
                  classe={STATUS_TEXTO.warning}
                />
                <Numero
                  icone={<Minus className="h-3.5 w-3.5" aria-hidden />}
                  rotulo="Permanecem"
                  valor={previsao.permanecem}
                  classe="text-muted-foreground"
                />
              </div>

              <div className="rounded-lg border bg-background p-4">
                <p className="text-sm font-medium leading-relaxed">{montarResumo(previsao)}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Números contados agora, sobre o universo atual. A reclassificação roda no worker
                  e leva alguns minutos — a pirâmide só reflete a nova regra quando ela terminar.
                </p>
              </div>
            </>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={salvando}
          >
            Cancelar
          </Button>

          {modo.tipo === 'salvar' && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => void confirmar(false)}
              disabled={salvando || carregando || isError}
            >
              {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              Salvar sem ativar
            </Button>
          )}

          <Button
            type="button"
            onClick={() => void confirmar(true)}
            disabled={salvando || carregando || isError}
          >
            {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            Confirmar e ativar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
