'use client'

import * as React from 'react'
import { MessageSquareWarning } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ReportDialog } from './report-dialog'

/**
 * O botão de reportar, ao lado do sino (04m §2).
 *
 * Ao lado do sino e não numa página de suporte: o report só é útil escrito NO
 * MOMENTO em que a pessoa viu o problema, com a rota e a tela que ela estava
 * usando. Um link no menu obrigaria a sair da tela quebrada para descrevê-la —
 * e é assim que se perde o contexto que o §2 quer capturar sozinho.
 */
export function ReportTrigger({ usuarioId }: { usuarioId: string }) {
  const [aberto, setAberto] = React.useState(false)

  return (
    <>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Reportar bug ou melhoria"
              aria-haspopup="dialog"
              onClick={() => setAberto(true)}
            >
              <MessageSquareWarning className="h-5 w-5" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Reportar bug ou melhoria</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/*
        Montado SEMPRE, e não só quando abre: o rascunho do formulário sobrevive a
        um clique fora do modal — perder três parágrafos assim é como alguém
        desiste de reportar. Nada é consultado enquanto fechado: o Radix não
        renderiza o conteúdo do Dialog, e "Meus reports" vive numa aba que só
        monta quando é escolhida.
      */}
      <ReportDialog open={aberto} onOpenChange={setAberto} usuarioId={usuarioId} />
    </>
  )
}
