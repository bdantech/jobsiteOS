'use client'

import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { EyeOff, ImageIcon, Loader2 } from 'lucide-react'
import {
  PRIORIDADES_REPORT,
  PRIORIDADE_REPORT_LABELS,
  STATUS_REPORT_LABELS,
  TIPO_REPORT_LABELS,
  statusDoTipo,
  type PrioridadeReport,
  type StatusReport,
  type TipoReport,
} from '@jobsiteos/core'
import { atualizarReportAction, comentarReportAction, urlDoAnexoAction } from '@/actions/reports'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { Numero, PrioridadeBadge, StatusBadge, TipoIcone } from '@/components/reports/badges'
import { ContextoTecnico } from '@/components/reports/contexto-tecnico'
import {
  buscarComentarios,
  buscarHistorico,
  buscarReportPorNumero,
  reportsKeys,
  type Report,
} from '@/components/reports/queries'

const dataHora = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  year: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

/**
 * O detalhe do report na triagem (04m §3).
 *
 * Modal e não rota própria: a triagem é uma fila, e quem fecha um report volta
 * para a fila com os filtros como estavam. Uma rota levaria a um "voltar" que
 * remonta a lista e reposiciona a rolagem no topo a cada item lido.
 */
export function DetalheReport({
  report,
  onOpenChange,
}: {
  report: Report | null
  onOpenChange: (v: boolean) => void
}) {
  return (
    <Dialog open={report !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        {report && <Corpo report={report} />}
      </DialogContent>
    </Dialog>
  )
}

function Corpo({ report }: { report: Report }) {
  const qc = useQueryClient()
  const comentarios = useQuery({
    queryKey: reportsKeys.comentarios(report.id),
    queryFn: () => buscarComentarios(report.id),
  })
  const historico = useQuery({
    queryKey: reportsKeys.historico(report.id),
    queryFn: () => buscarHistorico(report.id),
  })

  const invalidar = () => {
    void qc.invalidateQueries({ queryKey: reportsKeys.todos })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
          <TipoIcone tipo={report.tipo} />
          <Numero numero={report.numero} />
          <span className="min-w-0">{report.titulo}</span>
        </DialogTitle>
        <DialogDescription>
          {TIPO_REPORT_LABELS[report.tipo]} de {report.autor_nome ?? 'usuário removido'} ·{' '}
          {dataHora.format(new Date(report.criado_em))}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <p className="whitespace-pre-wrap text-sm">{report.descricao}</p>

        <Anexo caminho={report.anexo_url} />

        <ContextoTecnico
          contexto={report.contexto as never}
          titulo="Contexto técnico capturado no envio"
        />

        <Separator />

        <Triagem report={report} onSalvo={invalidar} />

        <Separator />

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Histórico</h3>
          {historico.isPending ? (
            <Skeleton className="h-12 w-full" />
          ) : (
            <ol className="space-y-1 text-xs text-muted-foreground">
              {(historico.data ?? []).map((h) => (
                <li key={h.id} className="flex flex-wrap items-center gap-1.5">
                  <span className="tabular-nums">{dataHora.format(new Date(h.alterado_em))}</span>
                  <span>·</span>
                  <span>
                    {h.status_anterior
                      ? `${STATUS_REPORT_LABELS[h.status_anterior as StatusReport] ?? h.status_anterior} → `
                      : 'criado como '}
                    <strong className="text-foreground">
                      {STATUS_REPORT_LABELS[h.status_novo as StatusReport] ?? h.status_novo}
                    </strong>
                  </span>
                  <span>·</span>
                  <span>{h.autor_nome ?? '—'}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <Separator />

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Comentários</h3>
          {comentarios.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : (comentarios.data ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum comentário ainda.</p>
          ) : (
            <ul className="space-y-2">
              {(comentarios.data ?? []).map((c) => (
                <li
                  key={c.id}
                  className={cn(
                    'rounded-md border p-2 text-sm',
                    // O interno é visivelmente outro tipo de coisa. Sem a marca, um
                    // comentário escrito para a equipe é indistinguível de um escrito
                    // para o autor — e a diferença entre os dois é o tom.
                    c.interno ? 'border-dashed border-amber-500/50 bg-amber-500/5' : 'bg-muted/40',
                  )}
                >
                  <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span>{c.autor_nome ?? '—'}</span>
                    <span>·</span>
                    <span>{dataHora.format(new Date(c.criado_em))}</span>
                    {c.interno && (
                      <Badge variant="warning" className="gap-1 text-[10px]">
                        <EyeOff className="h-3 w-3" aria-hidden />
                        interno
                      </Badge>
                    )}
                  </p>
                  <p className="whitespace-pre-wrap">{c.texto}</p>
                </li>
              ))}
            </ul>
          )}

          <NovoComentario reportId={report.id} onEnviado={invalidar} />
        </section>
      </div>
    </>
  )
}

// ─── Ações ──────────────────────────────────────────────────────────────────

function Triagem({ report, onSalvo }: { report: Report; onSalvo: () => void }) {
  const [status, setStatus] = React.useState<StatusReport>(report.status)
  const [prioridade, setPrioridade] = React.useState<string>(report.prioridade ?? 'nenhuma')
  const [numeroOriginal, setNumeroOriginal] = React.useState('')

  // O estado local segue o report quando o admin fecha um e abre outro sem
  // desmontar o modal.
  React.useEffect(() => {
    setStatus(report.status)
    setPrioridade(report.prioridade ?? 'nenhuma')
    setNumeroOriginal('')
  }, [report.id, report.status, report.prioridade])

  const salvar = useMutation({
    mutationFn: async () => {
      let duplicadoDe: string | null = null
      if (status === 'duplicado') {
        const n = Number(numeroOriginal.replace(/^#/, '').trim())
        if (!Number.isInteger(n) || n <= 0) {
          throw new Error('Informe o número do report original, por exemplo 42.')
        }
        if (n === report.numero) throw new Error('Um report não duplica a si mesmo.')
        const original = await buscarReportPorNumero(n)
        if (!original) throw new Error(`Não existe report #${n}.`)
        duplicadoDe = original.id
      }
      const r = await atualizarReportAction({
        report_id: report.id,
        status,
        // A chave SEMPRE vai — é o que permite limpar. Ausente, a RPC manteria o
        // que estava, e não haveria como desfazer uma prioridade posta por engano.
        prioridade: prioridade === 'nenhuma' ? null : (prioridade as PrioridadeReport),
        duplicado_de: duplicadoDe,
      })
      if (!r.ok) throw new Error(r.message)
      return r.data
    },
    onSuccess: (d) => {
      toast.success(`Report #${d.numero} atualizado.`)
      onSalvo()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Não foi possível salvar.'),
  })

  const mudou =
    status !== report.status || (prioridade === 'nenhuma' ? null : prioridade) !== report.prioridade

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">Triagem</h3>
        <StatusBadge status={report.status} />
        <PrioridadeBadge prioridade={report.prioridade} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="report-status">Status</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as StatusReport)}>
            <SelectTrigger id="report-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {/*
                Só a esteira DESTE tipo. Um bug não pode virar "entregue" e uma
                melhoria não entra "em correção" — o CHECK do banco recusaria, e
                oferecer uma opção que o banco recusa é prometer o impossível.
              */}
              {statusDoTipo(report.tipo as TipoReport).map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_REPORT_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="report-prioridade">Prioridade</Label>
          <Select value={prioridade} onValueChange={setPrioridade}>
            <SelectTrigger id="report-prioridade">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="nenhuma">Sem prioridade</SelectItem>
              {PRIORIDADES_REPORT.map((p) => (
                <SelectItem key={p} value={p}>
                  {PRIORIDADE_REPORT_LABELS[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {status === 'duplicado' && (
        <div className="space-y-1.5">
          <Label htmlFor="report-original">Duplicado de</Label>
          <Input
            id="report-original"
            value={numeroOriginal}
            placeholder="Número do report original, ex.: 42"
            inputMode="numeric"
            onChange={(e) => setNumeroOriginal(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            O autor vê que o report dele virou duplicado — o original é onde a conversa
            continua, então ele precisa existir.
          </p>
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button size="sm" disabled={!mudou || salvar.isPending} onClick={() => salvar.mutate()}>
          {salvar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
          Salvar
        </Button>
      </div>
      {status !== report.status && (
        <p className="text-right text-xs text-muted-foreground">
          Salvar avisa {report.autor_nome ?? 'o autor'} — sino e push.
        </p>
      )}
    </section>
  )
}

function NovoComentario({ reportId, onEnviado }: { reportId: string; onEnviado: () => void }) {
  const qc = useQueryClient()
  const [texto, setTexto] = React.useState('')
  const [interno, setInterno] = React.useState(false)

  const enviar = useMutation({
    mutationFn: async () => {
      const r = await comentarReportAction({ report_id: reportId, texto, interno })
      if (!r.ok) throw new Error(r.message)
    },
    onSuccess: () => {
      setTexto('')
      void qc.invalidateQueries({ queryKey: reportsKeys.comentarios(reportId) })
      onEnviado()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Não foi possível comentar.'),
  })

  return (
    <div className="space-y-2">
      <Textarea
        value={texto}
        rows={3}
        maxLength={5000}
        placeholder={interno ? 'Nota para a equipe — o autor não vê.' : 'Responder ao autor…'}
        onChange={(e) => setTexto(e.target.value)}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={interno}
            onChange={(e) => setInterno(e.target.checked)}
          />
          Comentário interno
          <span className="text-xs">(invisível ao autor, e não notifica)</span>
        </label>
        <Button
          size="sm"
          variant={interno ? 'outline' : 'default'}
          disabled={!texto.trim() || enviar.isPending}
          onClick={() => enviar.mutate()}
        >
          Comentar
        </Button>
      </div>
    </div>
  )
}

/**
 * O print, atrás de URL assinada de 5 minutos.
 *
 * Nada de `<img src>` direto: o bucket é privado (um print de dentro do sistema
 * mostra dado de cliente), e a única leitura possível é uma assinatura de vida
 * curta emitida sob a policy de quem pediu.
 */
function Anexo({ caminho }: { caminho: string | null }) {
  const [url, setUrl] = React.useState<string | null>(null)
  const [carregando, setCarregando] = React.useState(false)

  if (!caminho) return null

  async function abrir() {
    setCarregando(true)
    const r = await urlDoAnexoAction(caminho as string)
    setCarregando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    setUrl(r.data.url)
  }

  if (url) {
    return (
      // A URL é assinada e efêmera: next/image a serviria por um proxy que não
      // carrega a assinatura, e o anexo voltaria 403.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt="Anexo do report" className="max-h-80 w-auto rounded-md border" />
    )
  }

  return (
    <Button variant="outline" size="sm" disabled={carregando} onClick={() => void abrir()}>
      {carregando ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <ImageIcon className="mr-2 h-4 w-4" aria-hidden />
      )}
      Ver anexo
    </Button>
  )
}
