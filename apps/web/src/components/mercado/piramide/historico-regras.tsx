'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, History, Pencil, Play } from 'lucide-react'
import { descrever, type CamadaComRegra, type Grupo } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDataHora } from './constants'
import { PreviewDialog } from './preview-dialog'
import { buscarRegras, piramideKeys, type RegraVersao } from './queries'

/**
 * Version history for a layer's rule (§5.1).
 *
 * Rules are append-only — `salvarCamadaRegra` creates the NEXT version and never
 * edits one — so this list is the audit trail for "what moved this company?".
 * `mercado_universo.camada_regra_versao` points at exactly one of these rows,
 * and it must keep meaning what it meant when it was written.
 *
 * Rolling back is therefore ACTIVATING an old version, never restoring it.
 */

interface HistoricoRegrasProps {
  camada: CamadaComRegra
  /** Loads a version into the builder as the starting point for the next one. */
  onUsarComoBase: (arvore: Grupo) => void
}

function ItemRegra({
  regra,
  onAtivar,
  onUsarComoBase,
}: {
  regra: RegraVersao
  onAtivar: (regra: RegraVersao) => void
  onUsarComoBase: (arvore: Grupo) => void
}) {
  return (
    <li className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium tabular-nums">v{regra.versao}</span>
          {regra.ativa && <Badge className="bg-brand text-brand-foreground">Ativa</Badge>}
        </div>

        <div className="flex items-center gap-1">
          {regra.definicao && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onUsarComoBase(regra.definicao as Grupo)}
              title="Carregar esta versão no editor"
            >
              <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden />
              Usar como base
            </Button>
          )}

          {!regra.ativa && regra.definicao && (
            <Button type="button" variant="outline" size="sm" onClick={() => onAtivar(regra)}>
              <Play className="mr-1 h-3.5 w-3.5" aria-hidden />
              Ativar
            </Button>
          )}
        </div>
      </div>

      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {regra.definicao ? (
          descrever(regra.definicao)
        ) : (
          <span className="text-destructive">
            Esta versão usa uma variável que não existe mais no catálogo e não pode ser lida nem
            reativada.
          </span>
        )}
      </p>

      <p className="mt-2 text-xs text-muted-foreground">
        {formatDataHora(regra.criada_em)}
        {regra.autor_nome ? ` — ${regra.autor_nome}` : ' — seed do sistema'}
      </p>
    </li>
  )
}

export function HistoricoRegras({ camada, onUsarComoBase }: HistoricoRegrasProps) {
  const [aAtivar, setAAtivar] = React.useState<RegraVersao | null>(null)

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: piramideKeys.regras(camada),
    queryFn: () => buscarRegras(camada),
  })

  if (isPending) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center">
        <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
        <div className="space-y-1">
          <p className="font-medium">Não foi possível carregar o histórico</p>
          <p className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'Erro desconhecido.'}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          Tentar novamente
        </Button>
      </div>
    )
  }

  const regras = data ?? []

  if (regras.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center">
        <div className="rounded-full bg-muted p-3">
          <History className="h-6 w-6 text-muted-foreground" aria-hidden />
        </div>
        <div className="space-y-1">
          <p className="font-medium">Nenhuma versão ainda</p>
          <p className="text-sm text-muted-foreground">
            Monte a regra no editor e salve a primeira versão desta camada.
          </p>
        </div>
      </div>
    )
  }

  return (
    <>
      <ul className="space-y-2">
        {regras.map((regra) => (
          <ItemRegra
            key={regra.id}
            regra={regra}
            onAtivar={setAAtivar}
            onUsarComoBase={onUsarComoBase}
          />
        ))}
      </ul>

      {aAtivar?.definicao && (
        <PreviewDialog
          aberto
          onOpenChange={(aberto) => !aberto && setAAtivar(null)}
          camada={camada}
          modo={{
            tipo: 'ativar',
            arvore: aAtivar.definicao,
            regraId: aAtivar.id,
            versao: aAtivar.versao,
          }}
          onConcluido={() => setAAtivar(null)}
        />
      )}
    </>
  )
}
