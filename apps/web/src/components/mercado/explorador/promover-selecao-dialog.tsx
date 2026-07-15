'use client'

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Loader2, Rocket } from 'lucide-react'
import { formatCnpj } from '@jobsiteos/core'
import { promoverEmpresaAction } from '@/actions/mercado'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { mercadoKeys } from './queries'

export interface AlvoPromocao {
  cnpj: string
  razao_social: string | null
}

interface FalhaPromocao {
  cnpj: string
  razao_social: string | null
  motivo: string
}

type Fase = 'confirmar' | 'executando' | 'concluido'

/**
 * Promoção em lote.
 *
 * Sequencial de propósito: cada promoção é uma transação que insere em
 * `empresas`, grava o evento `empresa.promovida` e o audit_log. Disparar 200
 * dessas em paralelo do navegador não acelera nada (o gargalo é o banco) e
 * transforma um erro em 200 erros simultâneos.
 *
 * E, principalmente: UMA LINHA RUIM NÃO DERRUBA O LOTE. Um CNPJ que sumiu do
 * universo entre a listagem e o clique falha sozinho, é reportado por nome, e as
 * outras 199 seguem. Como `app_promover_empresa` é idempotente, uma linha que
 * outra pessoa promoveu no meio do caminho simplesmente volta como sucesso.
 */
export function PromoverSelecaoDialog({
  alvos,
  aberto,
  onOpenChange,
  onConcluido,
}: {
  alvos: readonly AlvoPromocao[]
  aberto: boolean
  onOpenChange: (aberto: boolean) => void
  onConcluido: (promovidos: readonly string[]) => void
}) {
  const queryClient = useQueryClient()
  const [fase, setFase] = React.useState<Fase>('confirmar')
  const [processados, setProcessados] = React.useState(0)
  const [sucessos, setSucessos] = React.useState<string[]>([])
  const [falhas, setFalhas] = React.useState<FalhaPromocao[]>([])

  function reiniciar() {
    setFase('confirmar')
    setProcessados(0)
    setSucessos([])
    setFalhas([])
  }

  async function promover() {
    setFase('executando')
    setProcessados(0)

    const ok: string[] = []
    const erros: FalhaPromocao[] = []

    for (const alvo of alvos) {
      const resultado = await promoverEmpresaAction({ cnpj: alvo.cnpj })

      if (resultado.ok) ok.push(alvo.cnpj)
      else {
        erros.push({
          cnpj: alvo.cnpj,
          razao_social: alvo.razao_social,
          motivo: resultado.message,
        })
      }

      setProcessados((n) => n + 1)
    }

    setSucessos(ok)
    setFalhas(erros)
    setFase('concluido')

    await queryClient.invalidateQueries({ queryKey: mercadoKeys.all })
    onConcluido(ok)
  }

  function fechar(proximo: boolean) {
    // Fechar no meio do lote deixaria promoções acontecendo sem ninguém olhando.
    if (fase === 'executando') return
    if (!proximo) reiniciar()
    onOpenChange(proximo)
  }

  const total = alvos.length
  const progresso = total > 0 ? Math.round((processados / total) * 100) : 0

  return (
    <Dialog open={aberto} onOpenChange={fechar}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {fase === 'concluido' ? 'Promoção concluída' : 'Promover para Empresas'}
          </DialogTitle>
          <DialogDescription>
            {fase === 'concluido'
              ? 'O que deu certo já está na base de Empresas, com timeline e eventos.'
              : `${total} ${total === 1 ? 'empresa selecionada passa' : 'empresas selecionadas passam'} do universo para a base de Empresas, ganhando timeline, notas e eventos. A camada não muda — promoção não é relacionamento.`}
          </DialogDescription>
        </DialogHeader>

        {fase === 'confirmar' && (
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-3 text-sm">
            {alvos.slice(0, 50).map((alvo) => (
              <div key={alvo.cnpj} className="flex items-baseline justify-between gap-3">
                <span className="truncate">{alvo.razao_social ?? '(sem razão social)'}</span>
                <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                  {formatCnpj(alvo.cnpj)}
                </span>
              </div>
            ))}
            {total > 50 && (
              <p className="pt-2 text-xs text-muted-foreground">
                e mais {total - 50} {total - 50 === 1 ? 'empresa' : 'empresas'}.
              </p>
            )}
          </div>
        )}

        {fase === 'executando' && (
          <div className="space-y-3 py-4">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-brand transition-all"
                style={{ width: `${progresso}%` }}
                role="progressbar"
                aria-valuenow={processados}
                aria-valuemin={0}
                aria-valuemax={total}
              />
            </div>
            <p className="text-center text-sm text-muted-foreground">
              Promovendo {processados} de {total}…
            </p>
          </div>
        )}

        {fase === 'concluido' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-md border border-brand/30 bg-brand/5 p-3 text-sm">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-brand" aria-hidden />
              <span>
                {sucessos.length}{' '}
                {sucessos.length === 1 ? 'empresa promovida' : 'empresas promovidas'}.
              </span>
            </div>

            {falhas.length > 0 && (
              <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
                  <span>
                    {falhas.length} {falhas.length === 1 ? 'falhou' : 'falharam'}
                  </span>
                </div>
                <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                  {falhas.map((falha) => (
                    <li key={falha.cnpj}>
                      <span className="font-medium text-foreground">
                        {falha.razao_social ?? formatCnpj(falha.cnpj)}
                      </span>{' '}
                      — {falha.motivo}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {fase === 'concluido' ? (
            <Button onClick={() => fechar(false)}>Fechar</Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => fechar(false)}
                disabled={fase === 'executando'}
              >
                Cancelar
              </Button>
              <Button type="button" onClick={promover} disabled={fase === 'executando' || total === 0}>
                {fase === 'executando' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Rocket className="mr-2 h-4 w-4" />
                )}
                Promover {total}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
