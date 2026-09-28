'use client'

import { Activity } from 'lucide-react'
import type { CorSaude } from '@jobsiteos/core'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

/**
 * Se as rotinas RODARAM (0272) — o botão, a lista e a linha colorida embaixo dele.
 *
 * Tudo chega formatado do servidor (ver `crons-lista.tsx`): este componente é cliente
 * só porque o diálogo abre e fecha.
 */

export interface LinhaSaude {
  path: string
  nome: string
  cor: CorSaude
  rotulo: string
  /** Data e hora da última execução, em Brasília. Nulo = nenhuma registrada. */
  quando: string | null
  relativo: string | null
  erro: string | null
}

const COR_LINHA: Record<CorSaude, string> = {
  verde: 'bg-emerald-500',
  amarela: 'bg-amber-500',
  vermelha: 'bg-red-500',
}

const COR_TEXTO: Record<CorSaude, string> = {
  verde: 'text-emerald-700 dark:text-emerald-400',
  amarela: 'text-amber-700 dark:text-amber-400',
  vermelha: 'text-red-700 dark:text-red-400',
}

export function CronsSaude({
  rotinas,
  geral,
  resumo,
}: {
  rotinas: LinhaSaude[]
  geral: CorSaude
  resumo: string
}) {
  return (
    <div className="flex flex-col gap-2">
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline" className="w-full sm:w-auto sm:self-start">
            <Activity className="h-4 w-4" aria-hidden />
            Status das execuções
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Status das execuções</DialogTitle>
            <DialogDescription>
              A última execução de cada rotina. “Disparada” quer dizer que o worker aceitou o
              pedido; “Rodou”, que ele avisou que o job terminou bem.
            </DialogDescription>
          </DialogHeader>
          <ul className="-mx-2 max-h-[65vh] divide-y overflow-y-auto">
            {rotinas.map((r) => (
              <li key={r.path} className="flex items-start justify-between gap-4 px-2 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{r.nome}</p>
                  {r.erro && (
                    <p className="mt-0.5 break-words text-xs text-red-700 dark:text-red-400">{r.erro}</p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <p className={cn('flex items-center justify-end gap-1.5 text-sm font-medium', COR_TEXTO[r.cor])}>
                    <span className={cn('h-2 w-2 rounded-full', COR_LINHA[r.cor])} aria-hidden />
                    {r.rotulo}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {r.quando ? `${r.quando} · ${r.relativo}` : 'nenhuma execução registrada'}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>

      <div
        className={cn('h-1.5 w-full rounded-full', COR_LINHA[geral])}
        role="img"
        aria-label={`Status geral das rotinas: ${geral}`}
      />
      <p className="text-xs text-muted-foreground">{resumo}</p>
    </div>
  )
}
