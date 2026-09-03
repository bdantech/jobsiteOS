'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, Check, EyeOff, Mail, MessageCircle, Star, Trash2, UserX } from 'lucide-react'
import {
  CANAIS,
  CANAL_LABELS,
  FAIXAS,
  FAIXA_LABELS,
  STATUS_OUTBOX,
  STATUS_OUTBOX_LABELS,
  formatCnpj,
  type Canal,
  type Faixa,
  type StatusOutbox,
} from '@jobsiteos/core'
import { Badge, STATUS_SUPERFICIE } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { descartarMensagemAction } from '@/actions/antecipacao'
import { aprovarMensagensAction } from '@/actions/comunicacao'
import { cn } from '@/lib/utils'
import { FAIXA_BADGE, formatarDataHora, formatarMoeda } from './format'
import { antecipacaoKeys, buscarOutbox, type FiltrosOutbox } from './queries'

/**
 * A Outbox (webOnly): a FILA DE SAÍDA.
 *
 * ── ELA DEIXOU DE SER SOMBRA (05A §2) ──────────────────────────────────────
 * Até o Prompt 05A esta tela mostrava "o que SERIA enviado" e nada saía. Agora o
 * canal existe: `aprovada` vira `enviada` no worker, e cada linha aqui é uma
 * mensagem que ainda não saiu.
 *
 * Por isso ela também deixou de ser HISTÓRICO. O corpo some da linha no instante
 * do envio (`mensagens_outbox_sem_copia_do_ledger`), e o que foi dito passa a
 * viver em `comunicacoes` — que é onde a aba "Mensagens" e a Company 360 leem. Uma
 * linha `enviada` aqui é um recibo, não uma cópia.
 *
 * Cada linha mostra o destinatário escolhido e — importante — SE ele veio do ponto
 * focal. Uma régua que sempre cai no "primeiro contato disponível" é uma régua que
 * vai falar com o estagiário do financeiro.
 *
 * Os descartes por `sem_contato` não são erro: são insumo. Cada um é um fornecedor
 * em faixa que ninguém consegue tocar, e a lista deles é exatamente o filtro de um
 * lote de contatos no Radar.
 */

const STATUS_COR: Record<StatusOutbox, string> = {
  pendente_envio: STATUS_SUPERFICIE.info,
  aprovada: STATUS_SUPERFICIE.success,
  enviada: STATUS_SUPERFICIE.success,
  falhou: STATUS_SUPERFICIE.critical,
  descartada: 'border-border bg-muted text-muted-foreground',
}

function DescartarDialog({
  id,
  aberto,
  onOpenChange,
}: {
  id: string
  aberto: boolean
  onOpenChange: (v: boolean) => void
}) {
  const qc = useQueryClient()
  const [motivo, setMotivo] = React.useState('')
  const [salvando, setSalvando] = React.useState(false)

  async function confirmar() {
    if (motivo.trim() === '') return
    setSalvando(true)
    const r = await descartarMensagemAction({ id, motivo: motivo.trim() })
    setSalvando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Mensagem descartada.')
    setMotivo('')
    onOpenChange(false)
    void qc.invalidateQueries({ queryKey: antecipacaoKeys.all })
  }

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Descartar mensagem</DialogTitle>
          <DialogDescription>
            Ela sai da fila e não será enviada. O motivo fica registrado — é o que permite ajustar a
            régua em vez de descartar as mesmas mensagens toda semana.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="motivo-descarte">Motivo</Label>
          <Textarea
            id="motivo-descarte"
            rows={3}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ex.: contato errado; mensagem não faz sentido para este fornecedor."
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={() => void confirmar()}
            disabled={salvando || motivo.trim() === ''}
          >
            {salvando ? 'Descartando…' : 'Descartar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function OutboxLista() {
  const [filtros, setFiltros] = React.useState<FiltrosOutbox>({})
  const [descartando, setDescartando] = React.useState<string | null>(null)
  const [aprovando, setAprovando] = React.useState(false)

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: antecipacaoKeys.outbox(filtros),
    queryFn: () => buscarOutbox(filtros),
  })

  /**
   * Aprovar em lote é o caso real: a régua gera dezenas por rodada, e aprovar uma
   * a uma faria a pessoa parar de ler o que aprova depois da quinta. O botão de
   * cada linha usa o mesmo caminho, com um id só.
   */
  const aprovar = React.useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return
      setAprovando(true)
      try {
        const r = await aprovarMensagensAction(ids)
        if (!r.ok) {
          toast.error(r.message)
          return
        }
        toast.success(
          r.data.aprovadas === 1
            ? 'Aprovada. Sai na próxima janela de envio.'
            : `${r.data.aprovadas} mensagens aprovadas. Saem na próxima janela de envio.`,
        )
        await refetch()
      } finally {
        setAprovando(false)
      }
    },
    [refetch],
  )

  const semContato = (data ?? []).filter((m) => m.motivo_descarte === 'sem_contato')
  const pendentes = (data ?? []).filter((m) => m.status === 'pendente_envio')

  return (
    <div className="space-y-4">
      <div className={cn('flex items-start gap-2 rounded-lg border p-3 text-sm', STATUS_SUPERFICIE.info)}>
        <EyeOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div>
          <p className="font-medium">Fila de saída</p>
          <p>
            O que ainda não saiu. Uma mensagem aprovada é enviada na próxima janela (seg–sex,
            9h–18h) depois de passar pelo portão — supressão, base legal, cooldown e teto do número.
            Depois de enviada, o texto passa a viver na conversa da pessoa; aqui fica só o recibo.
          </p>
        </div>
      </div>

      {pendentes.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-3">
          <p className="text-sm">
            <span className="font-medium">
              {pendentes.length} mensagem{pendentes.length === 1 ? '' : 's'}
            </span>{' '}
            <span className="text-muted-foreground">
              gerada{pendentes.length === 1 ? '' : 's'} pela régua, aguardando aprovação.
            </span>
          </p>
          <Button
            size="sm"
            disabled={aprovando}
            onClick={() => void aprovar(pendentes.map((m) => m.id))}
          >
            <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Aprovar as {pendentes.length} filtradas
          </Button>
        </div>
      ) : null}

      {/* ─── Filtros ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {CANAIS.map((c) => (
          <Button
            key={c}
            size="sm"
            variant={filtros.canal === c ? 'default' : 'outline'}
            aria-pressed={filtros.canal === c}
            onClick={() => setFiltros((f) => ({ ...f, canal: f.canal === c ? undefined : (c as Canal) }))}
          >
            {CANAL_LABELS[c]}
          </Button>
        ))}
        <span className="mx-1 h-5 w-px bg-border" />
        {FAIXAS.map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filtros.faixa === f ? 'default' : 'outline'}
            aria-pressed={filtros.faixa === f}
            onClick={() => setFiltros((prev) => ({ ...prev, faixa: prev.faixa === f ? undefined : (f as Faixa) }))}
          >
            {FAIXA_LABELS[f]}
          </Button>
        ))}
        <span className="mx-1 h-5 w-px bg-border" />
        {STATUS_OUTBOX.map((s) => (
          <Button
            key={s}
            size="sm"
            variant={filtros.status === s ? 'default' : 'outline'}
            aria-pressed={filtros.status === s}
            onClick={() => setFiltros((prev) => ({ ...prev, status: prev.status === s ? undefined : s }))}
          >
            {STATUS_OUTBOX_LABELS[s]}
          </Button>
        ))}
      </div>

      {semContato.length > 0 && (
        <Card className={STATUS_SUPERFICIE.warning}>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <UserX className="h-4 w-4" aria-hidden />
              <CardTitle className="text-base">
                {semContato.length} fornecedor{semContato.length > 1 ? 'es' : ''} em faixa sem
                contato
              </CardTitle>
            </div>
            <CardDescription className="text-inherit opacity-90">
              Nenhum canal válido para tocá-los. Isto não é erro da régua — é uma lista de
              enriquecimento pronta.{' '}
              <Link href="/radar/lotes/nova" className="font-medium underline">
                Criar lote de contatos no Radar
              </Link>
              .
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-lg" />
          ))}
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
            <p className="text-sm text-muted-foreground">
              {error instanceof Error ? error.message : 'Erro ao carregar a outbox.'}
            </p>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      ) : data.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <p className="font-medium">Fila vazia</p>
            <p className="max-w-md text-sm text-muted-foreground">
              A outbox só gera mensagem para faixas com algum canal habilitado em Disparos. Com tudo
              desligado — o estado inicial — não há o que gerar.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {data.map((m) => (
            <li key={m.id}>
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {m.canal === 'email' ? (
                          <Mail className="h-4 w-4 text-muted-foreground" aria-hidden />
                        ) : (
                          <MessageCircle className="h-4 w-4 text-muted-foreground" aria-hidden />
                        )}
                        <span className="font-medium">
                          {/* `fornecedor_cnpj` ficou anulável na 0144: a outbox deixou de ser
                              exclusiva da Antecipação e o compositor manda para contato de
                              qualquer funil, onde não há CNPJ de fornecedor nenhum. */}
                          {m.fornecedor_nome ??
                            (m.fornecedor_cnpj ? formatCnpj(m.fornecedor_cnpj) : 'Destinatário sem empresa')}
                        </span>
                        {m.faixa && (
                          <Badge className={FAIXA_BADGE[m.faixa as Faixa]}>
                            {FAIXA_LABELS[m.faixa as Faixa]}
                          </Badge>
                        )}
                        <Badge className={cn('border', STATUS_COR[m.status as StatusOutbox])}>
                          {STATUS_OUTBOX_LABELS[m.status as StatusOutbox]}
                        </Badge>
                      </div>
                      <CardDescription className="tabular-nums">
                        {m.access_keys.length} nota{m.access_keys.length > 1 ? 's' : ''} ·{' '}
                        {formatarMoeda(m.valor_total)} · {formatarDataHora(m.criada_em)}
                      </CardDescription>
                    </div>

                    <div className="flex shrink-0 gap-1">
                      {/*
                        Aprovar é o passo entre a régua e o envio (05A §5), e NÃO é
                        enviar: a linha entra na fila e continua passando pelo portão do
                        worker. Aprovar o texto não é aprovar o horário nem a saúde do
                        número.
                      */}
                      {m.status === 'pendente_envio' && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={aprovando}
                          onClick={() => void aprovar([m.id])}
                        >
                          <Check className="mr-1 h-3.5 w-3.5" aria-hidden />
                          Aprovar
                        </Button>
                      )}
                      {(m.status === 'pendente_envio' || m.status === 'aprovada') && (
                        <Button variant="ghost" size="sm" onClick={() => setDescartando(m.id)}>
                          <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden />
                          Descartar
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Para:</span>
                    <span className="font-mono">{m.destinatario ?? '—'}</span>
                    {m.destinatario_ponto_focal && (
                      <Badge variant="outline" className="gap-1">
                        <Star className="h-3 w-3" aria-hidden />
                        Ponto focal
                      </Badge>
                    )}
                    {m.motivo_descarte && (
                      <Badge variant="outline" className="text-destructive">
                        {m.motivo_descarte}
                      </Badge>
                    )}
                  </div>

                  {m.assunto && <p className="text-sm font-medium">{m.assunto}</p>}
                  {m.corpo ? (
                    <p className="whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 text-sm">
                      {m.corpo}
                    </p>
                  ) : m.comunicacao_id ? (
                    // Enviada: o texto migrou para o ledger, e a linha guarda só a
                    // referência. Duas cópias divergentes pagam uma coisa e mostram outra.
                    <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                      Enviada. O texto está na conversa da pessoa
                      {m.empresa_id ? (
                        <>
                          {' '}
                          —{' '}
                          <Link href={`/empresas/${m.empresa_id}`} className="underline">
                            abrir a ficha da empresa
                          </Link>
                        </>
                      ) : null}
                      .
                    </p>
                  ) : null}
                  {m.erro ? <p className="text-xs text-destructive">{m.erro}</p> : null}

                  {m.fornecedor_cnpj && (
                    <Link
                      href={`/antecipacao/fornecedores/${m.fornecedor_cnpj}`}
                      className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                    >
                      Ver as notas deste fornecedor
                    </Link>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {descartando && (
        <DescartarDialog
          id={descartando}
          aberto
          onOpenChange={(v) => !v && setDescartando(null)}
        />
      )}
    </div>
  )
}
