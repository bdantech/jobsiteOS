'use client'

import * as React from 'react'
import { Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * "Este card é aquele pedido" (0247).
 *
 * ── POR QUE ISTO EXISTE, SE O SISTEMA JÁ PROCURA SOZINHO ────────────────────
 * O casamento automático é por CNPJ e só acontece quando ele é ÚNICO: uma análise aberta,
 * uma cobertura sem dono. Ele recusa escolher entre duas coberturas do mesmo CNPJ porque
 * a escolha errada grava um limite aprovado que ninguém aprovou para este pedido — e um
 * limite errado só aparece quando alguém já operou em cima dele.
 *
 * Sobram três casos para uma pessoa: duas coberturas livres, dois cards abertos do mesmo
 * CNPJ, e o buyer que a Atradius cadastrou sob outra inscrição (a matriz, uma filial),
 * em que CNPJ nenhum casa. Nos três, quem tem o número do cover na mão sabe a resposta em
 * um segundo.
 *
 * ── SEM CERIMÔNIA, DE PROPÓSITO ─────────────────────────────────────────────
 * Diferente do envio à mão, aqui não há afirmação nova sobre o mundo lá fora — o pedido
 * já foi afirmado, com nome e hora. Isto só diz QUAL é, e se sai errado se corrige
 * informando outro número. O aviso que importa é o de consequência: a partir daqui o
 * número manda, e é dele que virão limite e desfecho.
 */
export function DialogoVincularPedido({
  aberto,
  onOpenChange,
  /**
   * O número que a análise já tem, quando tem.
   *
   * Trocar é o caso do cover que a apólice não reconhece — o poll pergunta por ele, ouve
   * "não tenho", e o card fica parado com cara de espera. Mostrar o atual é o que permite
   * conferir que se está trocando o que se pensa estar.
   */
  atual,
  salvando,
  onConfirmar,
}: {
  aberto: boolean
  onOpenChange: (v: boolean) => void
  atual?: string | null
  salvando: boolean
  onConfirmar: (caseId: string) => void
}) {
  const [caseId, setCaseId] = React.useState('')

  // Renasce a cada abertura, como nos outros diálogos da esteira: um número abandonado na
  // vez anterior é exatamente o tipo de campo que alguém confirma sem reler. Vazio, e não
  // preenchido com o atual: um campo que já vem com o número velho convida a confirmar
  // sem trocar nada.
  React.useEffect(() => {
    if (aberto) setCaseId('')
  }, [aberto])

  const valido = caseId.trim().length > 0 && caseId.trim() !== atual

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{atual ? 'Trocar o pedido da Atradius' : 'Vincular o pedido da Atradius'}</DialogTitle>
          <DialogDescription>
            {atual
              ? 'Use quando o número que está aqui não é o do pedido que a Atradius tem — cobertura reaberta no portal com outro número, ou número anotado errado. Enquanto ele não bater, a consulta automática pergunta por um cover que a apólice não conhece.'
              : 'O número do cover que o representante devolveu. Com ele, o acompanhamento automático passa a cuidar desta análise sozinho — limite, rating e desfecho chegam pela rodada seguinte, sem ninguém digitar nada.'}
          </DialogDescription>
        </DialogHeader>

        {atual && (
          <p className="rounded-md border px-3 py-2 text-sm">
            Vinculada hoje ao cover{' '}
            <code className="font-mono text-[0.8rem]">{atual}</code>
          </p>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="vincular-case">Número do cover</Label>
          <Input
            id="vincular-case"
            value={caseId}
            onChange={(e) => setCaseId(e.target.value)}
            placeholder="Ex.: 143912539"
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            É o número do pedido no portal da Atradius. A partir daqui é ele que manda:
            confira que é o desta empresa antes de confirmar.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={salvando || !valido} onClick={() => onConfirmar(caseId.trim())}>
            <Link2 className="mr-1.5 size-3.5" aria-hidden />
            {salvando ? 'Vinculando…' : atual ? 'Trocar' : 'Vincular'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
