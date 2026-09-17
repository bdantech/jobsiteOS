'use client'

import * as React from 'react'
import { AlertTriangle, Hand } from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'

/**
 * "Eu mandei isto à seguradora por fora do sistema" (0216).
 *
 * ── POR QUE ISTO NÃO É UM ITEM DO "MOVER PARA…" ─────────────────────────────
 * Os estágios daquele seletor são escrituração do nosso lado da mesa — rascunho, docs
 * pendentes, cancelada — e todos se desfazem movendo de volta. Este não: ele afirma que
 * existe um pedido aberto na Atradius, destrava a conclusão da esteira e não se desfaz,
 * porque o pedido continua lá fora depois de qualquer clique aqui.
 *
 * Cerimônia proporcional ao que não dá para desfazer, como no diálogo de envio e no de
 * protestos. A diferença é que aqui o que se confirma não é um gasto: é uma AFIRMAÇÃO.
 * Ninguém além de quem clica sabe se ela é verdadeira, e por isso ela fica gravada com
 * nome e hora.
 *
 * ── O QUE A PESSOA PRECISA SABER ANTES ──────────────────────────────────────
 * Que ninguém vai avisá-la do desfecho. Sem número de cover, o poll não tem o que
 * consultar — ele filtra por `atradius_case_id` — e a decisão terá de ser registrada à
 * mão. Descobrir isso três semanas depois, esperando um e-mail automático que nunca vem,
 * é o modo mais caro de aprender.
 */
export function DialogoEnvioManual({
  aberto,
  onOpenChange,
  nome,
  cnpj,
  enviando,
  onConfirmar,
}: {
  aberto: boolean
  onOpenChange: (v: boolean) => void
  nome: string
  cnpj: string
  enviando: boolean
  onConfirmar: (v: { observacao?: string; atradius_case_id?: string }) => void
}) {
  /*
   * Renascem a cada abertura, como nos outros diálogos da esteira: um campo que guarda o
   * que foi digitado e abandonado na vez anterior grava uma observação que ninguém releu.
   */
  const [observacao, setObservacao] = React.useState('')
  const [caseId, setCaseId] = React.useState('')
  React.useEffect(() => {
    if (!aberto) return
    setObservacao('')
    setCaseId('')
  }, [aberto])

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Marcar como enviada à mão</DialogTitle>
          <DialogDescription>
            Para quando o pedido foi aberto <strong>fora do sistema</strong> — o caso do CNPJ
            que a Atradius não tem cadastrado como buyer, que não se resolve por API. Nada sai
            daqui: isto registra o que você já fez.
          </DialogDescription>
        </DialogHeader>

        <p className="rounded-md border p-3 text-sm">
          {nome}
          <span className="block text-xs text-muted-foreground">{cnpj}</span>
        </p>

        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2.5 text-[0.8rem]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
          <span>
            <strong>Ninguém vai avisar do desfecho.</strong> Sem o número do cover, o
            acompanhamento automático não tem o que consultar — quando a Atradius responder, a
            decisão precisa ser registrada aqui à mão, pela tela de confronto.
          </span>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="envio-manual-obs">O que foi feito</Label>
          <Textarea
            id="envio-manual-obs"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            rows={3}
            placeholder="Ex.: buyer não cadastrado. Enviado por e-mail à Fabiana em 17/09, com balanço e DRE."
          />
          <p className="text-xs text-muted-foreground">
            Entra na timeline da empresa e na observação da análise. É o que responde
            &ldquo;mandaram mesmo?&rdquo; daqui a três semanas — e a resposta útil tem canal,
            pessoa e data.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="envio-manual-case">Número do cover (opcional)</Label>
          <Input
            id="envio-manual-case"
            value={caseId}
            onChange={(e) => setCaseId(e.target.value)}
            placeholder="—"
          />
          <p className="text-xs text-muted-foreground">
            Se o representante já devolveu o número, preencha:{' '}
            <strong>o acompanhamento automático passa a cuidar desta análise sozinho</strong> e a
            decisão volta a chegar por ele. Em branco, a esteira fica no manual.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={enviando}
            onClick={() =>
              onConfirmar({
                observacao: observacao.trim() || undefined,
                atradius_case_id: caseId.trim() || undefined,
              })
            }
          >
            <Hand className="mr-1.5 size-3.5" aria-hidden />
            {enviando ? 'Marcando…' : 'Marcar como enviada'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
