'use client'

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Ban } from 'lucide-react'
import {
  MOTIVOS_SEM_INTERESSE,
  MOTIVO_SEM_INTERESSE_DESCRICOES,
  MOTIVO_SEM_INTERESSE_LABELS,
  formatCnpj,
  type MotivoSemInteresse,
} from '@jobsiteos/core'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { marcarFornecedorSemInteresseAction } from '@/actions/antecipacao'
import { antecipacaoKeys } from './queries'

/**
 * "Sem interesse em se cadastrar" — o descarte de um lead da prospecção.
 *
 * Não confundir com o `SemInteresseDialog` de `acoes-nota.tsx`, que é a supressão de
 * CANAL (não tocar este CNPJ, com validade e peso de LGPD). Este aqui é o resultado
 * da ligação: o fornecedor foi trabalhado e não vai se cadastrar. Ele sai da lista a
 * prospectar, as notas dele saem dos dois funis, e um clique desfaz tudo.
 *
 * O MOTIVO VEM DE UMA LISTA FECHADA porque a resposta é contável: "quantos leads
 * perdemos para outra financeira?" só tem resposta se ninguém puder digitar a mesma
 * razão de sete formas diferentes. A observação existe para o que a lista não cobre,
 * e vira obrigatória quando o motivo é "outro" — um descarte sem explicação é
 * indistinguível de um clique errado.
 */
export function FornecedorSemInteresseDialog({
  cnpj,
  nome,
  aberto,
  onOpenChange,
  aoMarcar,
}: {
  cnpj: string
  nome: string | null
  aberto: boolean
  onOpenChange: (v: boolean) => void
  /** Chamado depois do sucesso — para quem quiser navegar ou fechar algo em volta. */
  aoMarcar?: () => void
}) {
  const qc = useQueryClient()
  const [motivo, setMotivo] = React.useState<MotivoSemInteresse | ''>('')
  const [observacao, setObservacao] = React.useState('')
  const [salvando, setSalvando] = React.useState(false)

  // Reabrir o diálogo para OUTRO fornecedor não pode herdar o motivo do anterior:
  // é o caminho mais curto para descartar meia lista com a razão errada.
  React.useEffect(() => {
    if (aberto) {
      setMotivo('')
      setObservacao('')
    }
  }, [aberto, cnpj])

  const precisaObservacao = motivo === 'outro'
  const podeSalvar = motivo !== '' && (!precisaObservacao || observacao.trim() !== '')

  async function confirmar() {
    if (!podeSalvar) return
    setSalvando(true)
    const r = await marcarFornecedorSemInteresseAction({
      cnpj,
      motivo,
      observacao: observacao.trim() || null,
      fornecedor_nome: nome,
    })
    setSalvando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Fornecedor marcado como sem interesse — saiu da lista e dos funis.')
    onOpenChange(false)
    // A marcação mexe na lista a prospectar, na lista de descartados e nos dois
    // funis. Invalidar o módulo inteiro é mais barato que enumerar as quatro chaves
    // e esquecer uma na próxima tela que ler a mesma coisa.
    void qc.invalidateQueries({ queryKey: antecipacaoKeys.all })
    aoMarcar?.()
  }

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Sem interesse em se cadastrar</DialogTitle>
          <DialogDescription>
            <strong>{nome ?? formatCnpj(cnpj)}</strong>
            {nome ? ` · ${formatCnpj(cnpj)}` : ''}. Ele sai da lista a prospectar e as notas dele
            saem dos funis. Não é supressão de contato — é o registro de que este lead já foi
            trabalhado, e dá para reverter a qualquer momento.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="motivo-sem-interesse">Motivo</Label>
            {/* `undefined` e não '': string vazia é um valor selecionado para o Radix,
                e o placeholder nunca apareceria. */}
            <Select
              value={motivo || undefined}
              onValueChange={(v) => setMotivo(v as MotivoSemInteresse)}
            >
              <SelectTrigger id="motivo-sem-interesse" aria-label="Motivo">
                <SelectValue placeholder="Escolha o motivo" />
              </SelectTrigger>
              <SelectContent>
                {MOTIVOS_SEM_INTERESSE.map((m) => (
                  <SelectItem key={m} value={m}>
                    {MOTIVO_SEM_INTERESSE_LABELS[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {motivo !== '' && (
              <p className="text-xs text-muted-foreground">
                {MOTIVO_SEM_INTERESSE_DESCRICOES[motivo]}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="observacao-sem-interesse">
              Observação {precisaObservacao ? '' : '(opcional)'}
            </Label>
            <Textarea
              id="observacao-sem-interesse"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder={
                precisaObservacao
                  ? 'Descreva o motivo — obrigatório em "Outro".'
                  : 'Com quem falou, o que disseram, quando revisitar.'
              }
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={() => void confirmar()} disabled={salvando || !podeSalvar}>
            <Ban className="mr-1 h-3.5 w-3.5" aria-hidden />
            {salvando ? 'Marcando…' : 'Marcar sem interesse'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
