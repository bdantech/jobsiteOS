'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { arredondarLimiteSugerido } from '@jobsiteos/core'
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
import { solicitarAnaliseAction } from '@/actions/credito'

/**
 * Pedir uma análise de crédito. Serve os dois pontos de entrada.
 *
 * ── POR QUE ELE SAIU DO `credito-card` ──────────────────────────────────────
 * Nasceu lá dentro, quando só a Company 360 pedia análise. Agora a análise DECIDIDA
 * também pede — é de "negada" que nasce a próxima tentativa, e quem está olhando a
 * negativa é quem sabe o que mudou desde ela. Duas cópias do mesmo formulário
 * divergiriam no primeiro ajuste, e a divergência aqui seria num número que vai à
 * seguradora.
 *
 * ── O LIMITE SUGERIDO VEM ARREDONDADO ───────────────────────────────────────
 * `limitePotencial` é saída crua do estimador, com centavos. Em 17/09/2026 duas
 * análises entraram na esteira pedindo R$ 18.156,87 e R$ 435.764,96 — ninguém digitou
 * nenhum dos dois: o campo já vinha preenchido assim e a pessoa confirmou, que é o que
 * um campo pré-preenchido pede que se faça.
 *
 * O número não fica aqui dentro: é ele que vai no pedido de cobertura. `passo="1000"`
 * junto, porque um campo que sobe de centavo em centavo diz que centavo importa aqui.
 */
export function SolicitarAnaliseDialog({
  aberto,
  onOpenChange,
  empresaId,
  limitePotencial,
  /** Texto do botão e do título. A segunda tentativa não é "a" análise, é outra. */
  ehNova = false,
  /** Rótulo do estágio da análise que ainda está EM CURSO, se houver. */
  emCurso = null,
  onSalvo,
}: {
  aberto: boolean
  onOpenChange: (v: boolean) => void
  empresaId: string
  limitePotencial: number | null
  ehNova?: boolean
  emCurso?: string | null
  onSalvo: (analiseId: string) => void
}) {
  const [salvando, setSalvando] = React.useState(false)
  const [erro, setErro] = React.useState<string | null>(null)

  const sugerido = arredondarLimiteSugerido(limitePotencial)

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setSalvando(true)
    setErro(null)
    const r = await solicitarAnaliseAction({
      empresa_id: empresaId,
      limite_solicitado: String(fd.get('limite') ?? '') || undefined,
      observacoes: String(fd.get('observacoes') ?? '') || undefined,
    })
    setSalvando(false)
    if (!r.ok) {
      setErro(r.message)
      return
    }
    toast.success('Análise criada na esteira. O envio à seguradora é uma ação separada.')
    onOpenChange(false)
    onSalvo(r.data.id)
  }

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={enviar}>
          <DialogHeader>
            <DialogTitle>
              {ehNova ? 'Solicitar nova análise' : 'Solicitar análise de crédito'}
            </DialogTitle>
            <DialogDescription>
              {emCurso ? (
                <>
                  Já existe uma análise <strong>em curso</strong> ({emCurso}). Esta abre uma
                  segunda, em paralelo — a outra segue como está, e o time de Crédito vê as
                  duas na esteira.
                </>
              ) : ehNova ? (
                <>
                  Abre uma análise <strong>nova</strong> na esteira. A anterior fica no
                  histórico como está — o desfecho dela continua sendo o que foi, e é por isso
                  que ela não é reaberta.
                </>
              ) : (
                <>
                  Cria a solicitação na esteira. <strong>Não envia à seguradora</strong> — o
                  envio é um passo separado, feito pelo time de Crédito, porque resolver o
                  cadastro na Atradius pode ser cobrado.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="limite">Limite solicitado (R$)</Label>
              <Input
                id="limite"
                name="limite"
                type="number"
                min={0}
                step="1000"
                defaultValue={sugerido ?? undefined}
                placeholder="Usa o limite potencial se ficar em branco"
              />
              <p className="text-[0.8rem] text-muted-foreground">
                {sugerido === null
                  ? 'Sem limite potencial calculado. Em branco, a análise nasce sem valor pedido.'
                  : 'Sugestão arredondada do potencial estimado — é este número que vai à seguradora. Ajuste à vontade.'}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="observacoes">Observações</Label>
              <Textarea
                id="observacoes"
                name="observacoes"
                rows={3}
                placeholder={
                  ehNova
                    ? 'O que mudou desde a análise anterior — é o que o time de Crédito vai procurar.'
                    : 'Contexto para quem vai analisar.'
                }
              />
            </div>
          </div>

          {erro ? <p className="pb-2 text-sm text-destructive">{erro}</p> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={salvando}>
              {salvando ? 'Criando…' : ehNova ? 'Solicitar nova' : 'Solicitar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
