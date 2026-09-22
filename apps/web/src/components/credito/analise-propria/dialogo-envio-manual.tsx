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
 * Como a resposta vai chegar. Sem número de cover, o poll não tem o que consultar nesta
 * linha — ele filtra por `atradius_case_id`. O que a 0247 acrescentou é a busca pelo
 * CNPJ: a cada rodada do sync, uma cobertura sem dono na apólice é adotada pelo card.
 *
 * O aviso, então, não é mais "ninguém vai te avisar" — seria mentira. É o limite dela:
 * a busca não escolhe entre duas coberturas do mesmo CNPJ, e não casa um buyer que a
 * Atradius cadastrou sob outra inscrição. Nesses casos o número do cover resolve, e ele
 * pode ser informado aqui ou depois, pela tarja da análise.
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
            <strong>Sem o número do cover, a resposta é procurada pelo CNPJ.</strong> A cada
            rodada, uma cobertura desta empresa que ainda não tenha dono aqui é vinculada a
            esta análise. O que a busca não faz é escolher: havendo mais de uma cobertura
            para o mesmo CNPJ, o card espera alguém informar o número.
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
            <strong>o acompanhamento passa a seguir o pedido certo</strong>, sem depender da
            busca por CNPJ. Em branco não trava nada — o número pode ser informado depois, na
            própria análise.
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
