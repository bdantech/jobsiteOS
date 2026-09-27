'use client'

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ListChecks, Paperclip, RotateCcw, Upload } from 'lucide-react'
import type { Tables } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { documentoSinistroAction } from '@/actions/cobranca-gestao'
import { gestaoKeys, subirArquivoCobranca, type SinistroDetalhe } from './gestao-queries'
import { abrirArquivo } from './sinistro-arquivos'
import { dataHora } from './format'

/**
 * O checklist da cl. 22208.00, a–p, literal da apólice (§7.2).
 *
 * `origem = sistema` é o que o JobsiteOS monta sozinho na geração do dossiê (faturas,
 * correspondência, registro e lista de dívida, extrato, notificações). `upload` é o que
 * só existe fora daqui (contrato, procuração, cessão registrada). Qualquer item aceita
 * upload manual — um item automático que o sistema não conseguiu montar não pode travar
 * o sinistro.
 *
 * Obrigatório só sai do checklist com justificativa, e ela vai no corpo do envio.
 */
export function ChecklistDossie({ d }: { d: SinistroDetalhe }) {
  const obrigPendentes = d.documentos.filter((x) => x.obrigatorio && x.status === 'pendente').length
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ListChecks className="h-4 w-4" aria-hidden />
            Checklist do dossiê (cl. 22208.00)
          </CardTitle>
          {obrigPendentes > 0 ? (
            <Badge variant="critical">{obrigPendentes} obrigatório(s) pendente(s)</Badge>
          ) : (
            <Badge variant="success">obrigatórios resolvidos</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y divide-border">
          {d.documentos.map((doc) => (
            <ItemChecklist key={doc.id} doc={doc} sinistroId={d.sinistro.id} />
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function ItemChecklist({ doc, sinistroId }: { doc: Tables<'sinistro_documentos'>; sinistroId: string }) {
  const qc = useQueryClient()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [enviando, setEnviando] = React.useState(false)
  const [naoAplicavel, setNaoAplicavel] = React.useState(false)
  const [justificativa, setJustificativa] = React.useState('')

  async function executar(input: Parameters<typeof documentoSinistroAction>[0], sucesso: string) {
    setEnviando(true)
    const r = await documentoSinistroAction(input)
    setEnviando(false)
    if (!r.ok) {
      toast.error(r.message)
      return false
    }
    toast.success(sucesso)
    void qc.invalidateQueries({ queryKey: gestaoKeys.sinistro(sinistroId) })
    return true
  }

  async function anexar(arquivo: File) {
    setEnviando(true)
    try {
      const { caminho, hash } = await subirArquivoCobranca(`sinistros/${sinistroId}/itens/${doc.item}`, arquivo)
      await executar(
        { sinistro_id: sinistroId, item: doc.item, acao: 'anexar', arquivo_path: caminho, arquivo_hash: hash },
        `Item ${doc.item}) anexado.`,
      )
    } catch (e) {
      setEnviando(false)
      toast.error(e instanceof Error ? `Falha no upload: ${e.message}` : 'Falha no upload.')
    }
  }

  const minimo = doc.obrigatorio ? 5 : 0

  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm">
            <span className="font-mono font-semibold">{doc.item})</span> {doc.descricao}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            {doc.obrigatorio ? <Badge variant="outline">obrigatório</Badge> : <Badge variant="neutral">condicional</Badge>}
            <Badge variant="neutral">
              {doc.origem === 'sistema' ? 'auto (sistema)' : doc.origem === 'upload' ? 'upload' : 'não aplicável'}
            </Badge>
            {doc.status === 'ok' ? (
              <Badge variant="success">ok</Badge>
            ) : doc.status === 'nao_aplicavel' ? (
              <Badge variant="warning">não aplicável</Badge>
            ) : doc.obrigatorio ? (
              <Badge variant="critical">pendente</Badge>
            ) : (
              <Badge variant="neutral">pendente</Badge>
            )}
            {doc.anexado_em ? <span className="text-muted-foreground">{dataHora(doc.anexado_em)}</span> : null}
          </div>
          {doc.arquivo_path ? (
            <button
              type="button"
              className="mt-1 flex items-center gap-1 text-xs text-primary hover:underline"
              onClick={() => void abrirArquivo(doc.arquivo_path!)}
            >
              <Paperclip className="h-3 w-3" aria-hidden />
              {doc.arquivo_path.split('/').pop()}
            </button>
          ) : null}
          {doc.justificativa_ausencia ? (
            <p className="mt-1 text-xs text-muted-foreground">Justificativa: {doc.justificativa_ausencia}</p>
          ) : null}
          {doc.origem === 'sistema' && doc.status === 'pendente' ? (
            <p className="mt-1 text-xs text-muted-foreground">Montado automaticamente ao gerar o dossiê.</p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void anexar(f)
            }}
          />
          <Button size="sm" variant="outline" disabled={enviando} onClick={() => inputRef.current?.click()}>
            <Upload className="mr-1 h-3.5 w-3.5" />
            {doc.status === 'ok' ? 'Substituir' : 'Anexar'}
          </Button>
          {doc.status !== 'nao_aplicavel' ? (
            <Button size="sm" variant="ghost" disabled={enviando} onClick={() => setNaoAplicavel((v) => !v)}>
              Não aplicável
            </Button>
          ) : null}
          {doc.status !== 'pendente' ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={enviando}
              aria-label="Reabrir item"
              onClick={() => void executar({ sinistro_id: sinistroId, item: doc.item, acao: 'reabrir' }, `Item ${doc.item}) reaberto.`)}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      </div>

      {naoAplicavel ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="min-w-[16rem] flex-1"
            placeholder={doc.obrigatorio ? 'Justificativa (obrigatória — entra no corpo do envio)' : 'Justificativa (opcional)'}
            value={justificativa}
            onChange={(e) => setJustificativa(e.target.value)}
          />
          <Button
            size="sm"
            disabled={enviando || justificativa.trim().length < minimo}
            onClick={async () => {
              const ok = await executar(
                { sinistro_id: sinistroId, item: doc.item, acao: 'nao_aplicavel', justificativa: justificativa.trim() || undefined },
                `Item ${doc.item}) marcado como não aplicável.`,
              )
              if (ok) {
                setNaoAplicavel(false)
                setJustificativa('')
              }
            }}
          >
            Confirmar
          </Button>
        </div>
      ) : null}
    </li>
  )
}
