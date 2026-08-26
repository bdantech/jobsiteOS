'use client'

import * as React from 'react'
import { ChevronRight } from 'lucide-react'
import { linhasDoContexto, type ContextoReport } from '@jobsiteos/core'
import { cn } from '@/lib/utils'

/**
 * "Detalhes técnicos incluídos automaticamente" (§2), colapsado.
 *
 * Colapsado, e não escondido: o usuário tem direito de ver exatamente o que vai
 * junto com o texto dele. Um campo invisível que viaja com o report é a diferença
 * entre "capturamos o contexto" e "coletamos dados sem avisar" — e quem abre uma
 * vez e vê rota, navegador e tamanho de tela não abre de novo.
 */
export function ContextoTecnico({
  contexto,
  titulo = 'Detalhes técnicos incluídos automaticamente',
  className,
}: {
  contexto: Partial<ContextoReport> | null | undefined
  titulo?: string
  className?: string
}) {
  const [aberto, setAberto] = React.useState(false)
  const linhas = linhasDoContexto(contexto)
  if (linhas.length === 0) return null

  return (
    <div className={cn('rounded-md border border-dashed bg-muted/30', className)}>
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronRight
          className={cn('h-3.5 w-3.5 shrink-0 transition-transform', aberto && 'rotate-90')}
          aria-hidden
        />
        {titulo}
      </button>
      {aberto && (
        <dl className="space-y-1 border-t px-3 py-2 text-xs">
          {linhas.map((l) => (
            <div key={l.rotulo} className="flex gap-2">
              <dt className="w-20 shrink-0 text-muted-foreground">{l.rotulo}</dt>
              {/* break-all: URL e user agent são longos e sem espaços — sem isso
                  eles esticam o modal e criam rolagem horizontal. */}
              <dd className="min-w-0 break-all font-mono">{l.valor}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
