'use client'

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Bot, Check, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { aceitarSugestaoAction, descartarSugestaoAction } from '@/actions/comunicacao'
import { acaoLabel } from './format'

/**
 * O "próximo passo sugerido" (§7.1): o copiloto.
 *
 * ── TRÊS BOTÕES, E O DO MEIO É O IMPORTANTE ────────────────────────────────
 * Enviar, EDITAR e descartar. Editar antes de enviar é o caso normal e não a
 * exceção — uma sugestão que só pode ser aceita ou rejeitada vira uma escolha
 * entre "mandar o que a máquina escreveu" e "escrever tudo de novo", e ninguém
 * escolhe a segunda com pressa.
 *
 * ── A JUSTIFICATIVA FICA VISÍVEL ───────────────────────────────────────────
 * Não é enfeite: é o que permite discordar com fundamento. Um card que diz "mande
 * isto" sem dizer por quê é uma ordem, e ordens de máquina são obedecidas ou
 * ignoradas — nunca corrigidas.
 */
export function ProximoPasso({
  sugestaoId,
  acao,
  conteudo,
  justificativa,
  confianca,
}: {
  sugestaoId: string
  acao: string | null
  conteudo: string | null
  justificativa: string | null
  confianca: number | null
}) {
  const qc = useQueryClient()
  const [editando, setEditando] = React.useState(false)
  const [texto, setTexto] = React.useState(conteudo ?? '')
  const [ocupado, setOcupado] = React.useState(false)

  async function aceitar() {
    setOcupado(true)
    try {
      const r = await aceitarSugestaoAction({ id: sugestaoId, corpo: texto || null })
      if (!r.ok) {
        toast.error(r.message)
        return
      }
      toast.success('Na fila. Sai na próxima janela de envio.')
      await qc.invalidateQueries({ queryKey: ['comunicacao'] })
    } finally {
      setOcupado(false)
    }
  }

  async function descartar() {
    setOcupado(true)
    try {
      const r = await descartarSugestaoAction({ id: sugestaoId })
      if (!r.ok) {
        toast.error(r.message)
        return
      }
      await qc.invalidateQueries({ queryKey: ['comunicacao'] })
    } finally {
      setOcupado(false)
    }
  }

  const temMensagem = Boolean(conteudo?.trim())

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Bot className="h-4 w-4 text-primary" aria-hidden />
        <span className="text-sm font-medium">Próximo passo sugerido</span>
        <Badge variant="outline" className="h-5 text-[10px]">
          {acaoLabel(acao)}
        </Badge>
        {typeof confianca === 'number' ? (
          <span className="text-xs text-muted-foreground">
            confiança {Math.round(confianca * 100)}%
          </span>
        ) : null}
      </div>

      {justificativa ? (
        <p className="mb-2 text-xs text-muted-foreground">{justificativa}</p>
      ) : null}

      {temMensagem ? (
        editando ? (
          <Textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={5} className="mb-2" />
        ) : (
          <p className="mb-2 whitespace-pre-wrap rounded border bg-background p-2 text-sm">{texto}</p>
        )
      ) : null}

      <div className="flex flex-wrap gap-2">
        {temMensagem ? (
          <>
            <Button size="sm" onClick={aceitar} disabled={ocupado}>
              <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Enviar
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditando((v) => !v)} disabled={ocupado}>
              {editando ? 'Ver' : 'Editar'}
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={aceitar} disabled={ocupado}>
            <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Marcar como feito
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={descartar} disabled={ocupado}>
          <X className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          Descartar
        </Button>
      </div>
    </div>
  )
}
