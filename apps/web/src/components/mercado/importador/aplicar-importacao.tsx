'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2, PlayCircle, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { aplicarLoteAction } from '@/actions/mercado-importacao'
import { STATUS_SUPERFICIE } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { formatNumero } from './format'
import { importadorKeys } from './queries'

/**
 * "Aplicar importação": as linhas resolvidas viram empresas.
 *
 * A aplicação acontece em LOTES, e o loop é aqui. Cada chamada de server action
 * processa um punhado de linhas e devolve um cursor; o cliente chama de novo com
 * ele até `concluido`. Um único request para milhares de linhas estouraria o
 * tempo da função — e, pior, não teria como mostrar progresso. Se a aba fechar no
 * meio, nada se perde: o que entrou está gravado, e o próximo clique retoma
 * (a aplicação é idempotente por CNPJ).
 */

interface AplicarImportacaoProps {
  importacaoId: string
  totalResolvidas: number
  aRevisar: number
  desabilitado: boolean
}

export function AplicarImportacao({
  importacaoId,
  totalResolvidas,
  aRevisar,
  desabilitado,
}: AplicarImportacaoProps) {
  const router = useRouter()
  const queryClient = useQueryClient()

  const [confirmando, setConfirmando] = React.useState(false)
  const [aplicando, setAplicando] = React.useState(false)
  const [processadas, setProcessadas] = React.useState(0)

  async function aplicar() {
    if (aplicando) return

    setAplicando(true)
    setProcessadas(0)

    let cursor: string | null = null
    let criadas = 0
    let atualizadas = 0
    let contatos = 0
    let acumulado = 0
    const erros: string[] = []

    try {
      for (;;) {
        const resultado = await aplicarLoteAction({ importacao_id: importacaoId, cursor })

        if (!resultado.ok) {
          toast.error(resultado.message)
          return
        }

        const lote = resultado.data
        criadas += lote.empresasCriadas
        atualizadas += lote.empresasAtualizadas
        contatos += lote.contatosCriados
        acumulado += lote.processadas
        erros.push(...lote.erros)

        setProcessadas(acumulado)
        cursor = lote.ultimoId

        if (lote.concluido) break
      }

      toast.success('Importação concluída.', {
        description: `${formatNumero(criadas)} empresas criadas, ${formatNumero(atualizadas)} atualizadas, ${formatNumero(contatos)} contatos.`,
      })

      if (erros.length > 0) {
        toast.warning(`${formatNumero(erros.length)} linhas falharam.`, {
          description: erros.slice(0, 3).join(' | '),
        })
      }

      await queryClient.invalidateQueries({ queryKey: importadorKeys.all })
      setConfirmando(false)
      router.refresh()
    } catch (erro) {
      console.error('[importador] falha ao aplicar a importação', erro)
      toast.error('A aplicação foi interrompida. Clique novamente para retomar de onde parou.')
    } finally {
      setAplicando(false)
    }
  }

  const progresso =
    totalResolvidas > 0 ? Math.min(100, Math.round((processadas / totalResolvidas) * 100)) : 0

  return (
    <>
      <Button
        disabled={desabilitado || totalResolvidas === 0}
        onClick={() => setConfirmando(true)}
      >
        <PlayCircle className="mr-2 h-4 w-4" aria-hidden />
        Aplicar importação
      </Button>

      <Dialog
        open={confirmando}
        onOpenChange={(proximo) => {
          if (aplicando) return
          setConfirmando(proximo)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Aplicar a importação?</DialogTitle>
            <DialogDescription>
              {formatNumero(totalResolvidas)} linhas resolvidas vão entrar direto em{' '}
              <strong>Empresas</strong> (origem: lista), com ERP atual, MRR do ERP, detalhes do
              contrato e contatos. Empresas que já existem são atualizadas, não duplicadas.
            </DialogDescription>
          </DialogHeader>

          {aRevisar > 0 && (
            <p
              className={cn(
                'flex items-start gap-2 rounded-md border p-3 text-sm',
                STATUS_SUPERFICIE.warning,
              )}
            >
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                Ainda há {formatNumero(aRevisar)} linhas na fila de resolução. Elas{' '}
                <strong>não</strong> serão importadas — aplicar agora deixa essas de fora.
              </span>
            </p>
          )}

          {aplicando && (
            <div className="space-y-2">
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${progresso}%` }}
                />
              </div>
              <p className="text-center text-xs text-muted-foreground">
                {formatNumero(processadas)} de {formatNumero(totalResolvidas)} linhas
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" disabled={aplicando} onClick={() => setConfirmando(false)}>
              Cancelar
            </Button>
            <Button disabled={aplicando} onClick={() => void aplicar()}>
              {aplicando && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              {aplicando ? 'Aplicando…' : 'Aplicar agora'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
