'use client'

import * as React from 'react'
import { Check, Lock } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * As etapas de um funil, como trilha clicável.
 *
 * ─── POR QUE ISTO SUBSTITUI OS BOTÕES DE AVANÇAR/RECUAR ─────────────────────
 * Um par de botões "← →" responde "para onde eu ando", mas nunca "onde eu estou" nem
 * "quanto falta". Para saber isso era preciso ler o rótulo do estágio, contar de cabeça
 * quantas etapas o funil tem e lembrar a ordem delas — três operações que a tela pode
 * fazer sozinha.
 *
 * A trilha responde as três de uma vez, e de quebra torna possível o movimento que os
 * botões não permitiam: pular duas etapas quando a reunião já resolveu o que três etapas
 * resolveriam. Isso acontece o tempo todo, e antes exigia clicar avançar três vezes,
 * gravando duas passagens que nunca existiram no histórico.
 *
 * ─── POR QUE O NOME VIVE NO TOOLTIP ─────────────────────────────────────────
 * Oito etapas com rótulo escrito ("Aguardando documentação", "Preparação do MOU") ocupam
 * mais largura do que qualquer modal tem. Escrever só a atual e deixar as outras no
 * tooltip mantém a régua inteira visível — e é a régua inteira que dá a noção de avanço.
 *
 * ─── O QUE ELE NÃO FAZ ──────────────────────────────────────────────────────
 * Não decide ganho nem perda. Situação não é etapa: um negócio perdido continua tendo
 * chegado até onde chegou, e é exatamente essa informação que se perderia se "perdido"
 * virasse mais um segmento no fim da trilha.
 */

export interface EtapaFunil {
  id: string
  label: string
  /** Impede o clique e explica no tooltip. Ex.: crédito negado trava o avanço. */
  bloqueada?: string
}

export function EtapasDoFunil({
  etapas,
  atual,
  onIr,
  ocupado,
  somenteLeitura,
  className,
}: {
  etapas: readonly EtapaFunil[]
  atual: string
  onIr?: (id: string) => void
  ocupado?: boolean
  /** Mostra a trilha sem permitir mover — usada para exibir o funil de outro processo. */
  somenteLeitura?: boolean
  className?: string
}) {
  const indiceAtual = etapas.findIndex((e) => e.id === atual)
  const rotuloAtual = etapas[indiceAtual]?.label ?? atual

  return (
    <div className={cn('space-y-1.5', className)}>
      <TooltipProvider delayDuration={200}>
        <div className="flex items-center gap-1">
          {etapas.map((etapa, i) => {
            const passada = indiceAtual >= 0 && i < indiceAtual
            const ehAtual = i === indiceAtual
            const podeClicar = !somenteLeitura && !ocupado && !etapa.bloqueada && !ehAtual && !!onIr

            return (
              <Tooltip key={etapa.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    // `aria-current` e o rótulo completo no nome acessível: para quem usa
                    // leitor de tela a trilha inteira é lida como uma lista de etapas, e
                    // não como uma fileira de botões sem nome.
                    aria-current={ehAtual ? 'step' : undefined}
                    aria-label={
                      etapa.bloqueada
                        ? `${etapa.label} — indisponível: ${etapa.bloqueada}`
                        : ehAtual
                          ? `${etapa.label} — etapa atual`
                          : `Mover para ${etapa.label}`
                    }
                    disabled={!podeClicar}
                    onClick={podeClicar ? () => onIr?.(etapa.id) : undefined}
                    className={cn(
                      'group relative h-1.5 flex-1 rounded-full transition-all',
                      // A etapa atual é mais alta, não só de outra cor: quem enxerga mal
                      // cor distingue altura, e a posição na régua continua legível.
                      ehAtual && 'h-2.5 bg-primary',
                      passada && 'bg-primary/45',
                      !ehAtual && !passada && 'bg-muted',
                      etapa.bloqueada && 'bg-muted opacity-50',
                      podeClicar && 'cursor-pointer hover:bg-primary/70',
                      !podeClicar && 'cursor-default',
                      // A área de clique cresce para 24px de altura sem mexer no desenho:
                      // uma barra de 6px é alvo pequeno demais para mouse e impossível
                      // para dedo.
                      'after:absolute after:inset-x-0 after:-inset-y-2.5 after:content-[""]',
                    )}
                  />
                </TooltipTrigger>
                <TooltipContent side="top" className="flex items-center gap-1.5">
                  {etapa.bloqueada ? (
                    <Lock className="h-3 w-3" aria-hidden />
                  ) : passada ? (
                    <Check className="h-3 w-3" aria-hidden />
                  ) : null}
                  <span>{etapa.label}</span>
                  {etapa.bloqueada ? (
                    <span className="text-muted-foreground">— {etapa.bloqueada}</span>
                  ) : null}
                </TooltipContent>
              </Tooltip>
            )
          })}
        </div>
      </TooltipProvider>

      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate text-xs font-medium">{rotuloAtual}</p>
        {indiceAtual >= 0 && (
          <p className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {indiceAtual + 1}/{etapas.length}
          </p>
        )}
      </div>
    </div>
  )
}
