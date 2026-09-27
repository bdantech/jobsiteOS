'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, Mail, MessageCircle, Pencil, RefreshCw, Send, Truck } from 'lucide-react'
import {
  CANAL_ENTREGA_LABELS,
  COBRANCA_ESTAGIOS_ENCERRADOS,
  PAPEL_NOTIFICACAO_COBRANCA_LABELS,
  STATUS_ENTREGA_LABELS,
  STATUS_NOTIFICACAO_COBRANCA_LABELS,
  formatarEndereco,
  hojeSaoPaulo,
  type CanalEntrega,
  type EnderecoDestinatario,
  type PapelNotificacaoCobranca,
  type StatusEntrega,
  type StatusNotificacaoCobranca,
  type Tables,
} from '@jobsiteos/core'
import { Badge, type BadgeProps } from '@/components/ui/badge'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  editarNotificacaoAction,
  enviarNotificacaoAction,
  gerarMinutasNotificacaoAction,
  gerarPdfsNotificacoesAction,
  registrarEntregaAction,
  type ResultadoDocumentos,
} from '@/actions/cobranca'
import { cn } from '@/lib/utils'
import { ArquivoLink, AvisoApoliceDialog } from './cobranca-detalhe-comum'
import { brl, cnpj, data, dataHora } from './format'
import {
  buscarContatosDestinatario,
  buscarNotificacoes,
  buscarTitulosDaCobranca,
  cobrancaKeys,
  numeroDoTitulo,
  subirArquivoCobranca,
  type CardCobranca,
  type NotificacaoDaCobranca,
} from './queries'

/**
 * Notificações por rodada (§4, §5).
 *
 * O PDF enviado é imutável: depois que uma notificação da rodada saiu, a única forma de
 * mudar a carta é a próxima rodada ("Nova rodada"), com o valor atualizado na data. Uma
 * rodada ainda em rascunho pode ser refeita inteira, e cada notificação dela pode ter
 * endereço e razão social corrigidos — o endereço da Receita desatualizado é a causa nº
 * 1 de AR devolvido.
 *
 * O aviso da apólice (§6.4) aparece antes do PRIMEIRO envio, por qualquer canal. O RPC
 * recusa sem ele; a tela só pergunta antes de alguém escolher contatos à toa.
 */

const TOM_STATUS: Record<StatusNotificacaoCobranca, BadgeProps['variant']> = {
  rascunho: 'neutral',
  pronta: 'info',
  enviada: 'warning',
  entregue: 'success',
  falhou: 'critical',
  respondida: 'success',
}

const TOM_ENTREGA: Record<StatusEntrega, BadgeProps['variant']> = {
  pendente: 'neutral',
  enviado: 'info',
  entregue: 'success',
  recusado: 'critical',
  devolvido: 'critical',
  falhou: 'critical',
}

type Entrega = Tables<'cobranca_notificacao_entregas'>

function avisarDocumentos(docs: ResultadoDocumentos, onErros: (erros: Map<string, string>) => void): void {
  if (docs.aviso) toast.warning(docs.aviso)
  const m = new Map(docs.erros.map((e) => [e.id, e.mensagem]))
  onErros(m)
  if (docs.erros.length > 0) {
    toast.warning(`${docs.erros.length} PDF(s) não saíram. O motivo aparece em cada notificação.`)
  } else if (!docs.aviso && docs.gerados > 0) {
    toast.success(`${docs.gerados} PDF(s) gerado(s).`)
  }
}

export function AbaNotificacoes({ cobranca }: { cobranca: CardCobranca }) {
  const id = cobranca.id!
  const qc = useQueryClient()
  const notificacoes = useQuery({ queryKey: cobrancaKeys.notificacoes(id), queryFn: () => buscarNotificacoes(id) })
  const titulos = useQuery({ queryKey: cobrancaKeys.titulos(id), queryFn: () => buscarTitulosDaCobranca(id) })
  const [errosPdf, setErrosPdf] = React.useState<Map<string, string>>(new Map())
  const [gerando, setGerando] = React.useState(false)
  const [confirmarRodada, setConfirmarRodada] = React.useState(false)
  // O ato que espera o aceite do aviso da apólice para seguir.
  const [pendente, setPendente] = React.useState<(() => void) | null>(null)

  const encerrada = (COBRANCA_ESTAGIOS_ENCERRADOS as readonly string[]).includes(cobranca.estagio ?? '')

  function exigirAviso(acao: () => void) {
    if (cobranca.aceite_apolice_em) acao()
    else setPendente(() => acao)
  }

  function mesclarErros(novos: Map<string, string>, ids?: readonly string[]) {
    setErrosPdf((atual) => {
      const m = new Map(atual)
      for (const i of ids ?? []) m.delete(i)
      for (const [k, v] of novos) m.set(k, v)
      return m
    })
  }

  function invalidar() {
    void qc.invalidateQueries({ queryKey: cobrancaKeys.all })
  }

  async function gerarRodada() {
    setGerando(true)
    const r = await gerarMinutasNotificacaoAction(id)
    setGerando(false)
    setConfirmarRodada(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(`Rodada ${r.data.rodada}: ${r.data.notificacoes} minuta(s) gravada(s).`)
    avisarDocumentos(r.data, (m) => setErrosPdf(m))
    invalidar()
  }

  if (notificacoes.isPending) return <Skeleton className="h-64 w-full" />

  const lista = notificacoes.data ?? []
  const numeroPorCt = new Map((titulos.data ?? []).map((t) => [t.id, numeroDoTitulo(t)]))
  const rodadas = [...new Set(lista.map((n) => n.rodada))].sort((a, b) => b - a)
  const maxRodada = rodadas[0] ?? 0
  const ultimaSaiu = lista.some((n) => n.rodada === maxRodada && !['rascunho', 'pronta'].includes(n.status))
  const semPdf = lista.filter((n) => n.rodada === maxRodada && !n.documento_path).map((n) => n.id)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle className="text-sm">Notificações extrajudiciais</CardTitle>
              <CardDescription>
                O PDF enviado é imutável: qualquer mudança depois do envio vira uma nova rodada, com o valor
                atualizado na data e todo o histórico mantido.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              {semPdf.length > 0 && !encerrada ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={gerando}
                  onClick={async () => {
                    setGerando(true)
                    const r = await gerarPdfsNotificacoesAction(id, semPdf)
                    setGerando(false)
                    if (!r.ok) {
                      toast.error(r.message)
                      return
                    }
                    avisarDocumentos(r.data, (m) => mesclarErros(m, semPdf))
                    invalidar()
                  }}
                >
                  <RefreshCw className="mr-1 h-4 w-4" aria-hidden />
                  Gerar PDFs pendentes ({semPdf.length})
                </Button>
              ) : null}
              {!encerrada ? (
                maxRodada === 0 ? (
                  <Button size="sm" disabled={gerando} onClick={gerarRodada}>
                    {gerando ? 'Gerando…' : 'Gerar minutas'}
                  </Button>
                ) : ultimaSaiu ? (
                  <Button size="sm" disabled={gerando} onClick={() => setConfirmarRodada(true)}>
                    Nova rodada
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled={gerando} onClick={gerarRodada}>
                    {gerando ? 'Refazendo…' : `Refazer minutas da rodada ${maxRodada}`}
                  </Button>
                )
              ) : null}
            </div>
          </div>
        </CardHeader>
        {lista.length === 0 ? (
          <CardContent>
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhuma minuta gerada. “Gerar minutas” calcula os destinatários pela regra matriz/SPE/cedente,
              atualiza a dívida de cada carta e gera os PDFs — nada é enviado.
            </p>
          </CardContent>
        ) : null}
      </Card>

      {rodadas.map((r) => (
        <div key={r} className="space-y-2">
          <h3 className="px-1 text-xs font-bold uppercase tracking-[0.06em] text-muted-foreground">
            Rodada {r} {r === 1 ? '— notificação inicial' : '— reiteração'}
          </h3>
          {lista
            .filter((n) => n.rodada === r)
            .map((n) => (
              <NotificacaoItem
                key={n.id}
                n={n}
                cobrancaId={id}
                encerrada={encerrada}
                numeros={n.cobranca_notificacao_titulos.map((x) => numeroPorCt.get(x.cobranca_titulo_id) ?? '—')}
                erroPdf={errosPdf.get(n.id) ?? null}
                onErros={(m) => mesclarErros(m, [n.id])}
                exigirAviso={exigirAviso}
              />
            ))}
        </div>
      ))}

      <Dialog open={confirmarRodada} onOpenChange={setConfirmarRodada}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova rodada (reiteração)</DialogTitle>
            <DialogDescription>
              Gera a rodada {maxRodada + 1} para os títulos ainda em aberto, com o valor atualizado hoje e o
              modelo de reiteração. As cartas já enviadas continuam como estão — elas são prova e não mudam.
              Endereços corrigidos à mão nas rodadas anteriores são mantidos.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmarRodada(false)}>
              Cancelar
            </Button>
            <Button disabled={gerando} onClick={gerarRodada}>
              {gerando ? 'Gerando…' : `Gerar rodada ${maxRodada + 1}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AvisoApoliceDialog
        cobrancaId={id}
        aberto={pendente !== null}
        onOpenChange={(v) => !v && setPendente(null)}
        onAceito={() => {
          const acao = pendente
          setPendente(null)
          // O cabeçalho relê a cobrança; a ação segue já com o aceite gravado.
          acao?.()
        }}
      />
    </div>
  )
}

// ─── Uma notificação ────────────────────────────────────────────────────────

function NotificacaoItem({
  n,
  cobrancaId,
  encerrada,
  numeros,
  erroPdf,
  onErros,
  exigirAviso,
}: {
  n: NotificacaoDaCobranca
  cobrancaId: string
  encerrada: boolean
  numeros: string[]
  erroPdf: string | null
  onErros: (m: Map<string, string>) => void
  exigirAviso: (acao: () => void) => void
}) {
  const qc = useQueryClient()
  const [editando, setEditando] = React.useState(false)
  const [enviando, setEnviando] = React.useState(false)
  const [manual, setManual] = React.useState(false)
  const [atualizandoEntrega, setAtualizandoEntrega] = React.useState<Entrega | null>(null)
  const [gerando, setGerando] = React.useState(false)

  const editavel = ['rascunho', 'pronta'].includes(n.status) && !encerrada
  const temPdf = Boolean(n.documento_path)
  const endereco = n.destinatario_endereco as EnderecoDestinatario | null
  const status = n.status as StatusNotificacaoCobranca

  async function gerarPdf() {
    setGerando(true)
    const r = await gerarPdfsNotificacoesAction(cobrancaId, [n.id])
    setGerando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    avisarDocumentos(r.data, onErros)
    void qc.invalidateQueries({ queryKey: cobrancaKeys.notificacoes(cobrancaId) })
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{n.destinatario_razao_social}</span>
              <Badge variant={n.papel === 'sacado_matriz' ? 'default' : 'outline'} className="text-[10px]">
                {PAPEL_NOTIFICACAO_COBRANCA_LABELS[n.papel as PapelNotificacaoCobranca] ?? n.papel}
              </Badge>
              <Badge variant={TOM_STATUS[status] ?? 'outline'}>{STATUS_NOTIFICACAO_COBRANCA_LABELS[status] ?? n.status}</Badge>
            </div>
            <div className="font-mono text-xs text-muted-foreground">{cnpj(n.destinatario_cnpj)}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {formatarEndereco(endereco) ?? (
                <span className="text-amber-700 dark:text-amber-400">Sem endereço cadastral — edite antes de enviar por correio.</span>
              )}
              {endereco?.editado ? <span className="ml-1 italic">(editado)</span> : null}
            </div>
          </div>
          <div className="text-right text-sm">
            <div className="tabular-nums">
              {brl(n.valor_total_atualizado)}
              <span className="block text-[11px] text-muted-foreground">face {brl(n.valor_total)}</span>
            </div>
            <div className="text-[11px] text-muted-foreground">
              {n.qtd_titulos} título(s) · prazo {n.prazo_pagamento_dias} d
              {n.prazo_expira_em ? ` (até ${data(n.prazo_expira_em)})` : ''}
            </div>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Títulos: {numeros.slice(0, 12).join(', ')}
          {numeros.length > 12 ? ` e mais ${numeros.length - 12}` : ''}
        </p>

        {erroPdf ? (
          <p className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            O PDF não saiu: {erroPdf}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {temPdf ? (
            <ArquivoLink caminho={n.documento_path}>Abrir PDF</ArquivoLink>
          ) : (
            <span className="text-xs text-muted-foreground">PDF ainda não gerado</span>
          )}
          {n.documento_hash ? (
            <span className="font-mono text-[10px] text-muted-foreground" title="SHA-256 do PDF">
              {n.documento_hash.slice(0, 12)}…
            </span>
          ) : null}
          <span className="flex-1" />
          {editavel ? (
            <>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditando(true)}>
                <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden />
                Endereço
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" disabled={gerando} onClick={gerarPdf}>
                <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden />
                {temPdf ? 'Regerar PDF' : 'Gerar PDF'}
              </Button>
            </>
          ) : null}
          {temPdf && n.status !== 'rascunho' && !encerrada ? (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => exigirAviso(() => setManual(true))}
              >
                <Truck className="mr-1 h-3.5 w-3.5" aria-hidden />
                Entrega manual
              </Button>
              <Button size="sm" className="h-7 text-xs" onClick={() => exigirAviso(() => setEnviando(true))}>
                <Send className="mr-1 h-3.5 w-3.5" aria-hidden />
                Enviar
              </Button>
            </>
          ) : null}
        </div>

        {n.cobranca_notificacao_entregas.length > 0 ? (
          <div className="rounded-md border">
            {[...n.cobranca_notificacao_entregas]
              .sort((a, b) => (b.criado_em ?? '').localeCompare(a.criado_em ?? ''))
              .map((e) => {
                const st = e.status as StatusEntrega
                const manualCanal = ['correio_ar', 'cartorio_td', 'entrega_pessoal'].includes(e.canal)
                return (
                  <div key={e.id} className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs last:border-b-0">
                    <Badge variant="outline" className="text-[10px]">
                      {CANAL_ENTREGA_LABELS[e.canal as CanalEntrega] ?? e.canal}
                    </Badge>
                    <span className="min-w-0 max-w-[18rem] truncate" title={e.destino ?? undefined}>
                      {e.destino ?? '—'}
                    </span>
                    {e.codigo_rastreio ? <span className="font-mono">{e.codigo_rastreio}</span> : null}
                    <Badge variant={TOM_ENTREGA[st] ?? 'outline'}>{STATUS_ENTREGA_LABELS[st] ?? e.status}</Badge>
                    <span className="text-muted-foreground">
                      {e.confirmado_em ? `confirmado ${dataHora(e.confirmado_em)}` : e.enviado_em ? `enviado ${dataHora(e.enviado_em)}` : dataHora(e.criado_em)}
                    </span>
                    <ArquivoLink caminho={e.comprovante_path}>comprovante</ArquivoLink>
                    <span className="flex-1" />
                    {manualCanal && !encerrada ? (
                      <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={() => setAtualizandoEntrega(e)}>
                        Atualizar
                      </Button>
                    ) : null}
                  </div>
                )
              })}
          </div>
        ) : null}
      </CardContent>

      <EditarNotificacaoDialog n={n} aberto={editando} onOpenChange={setEditando} cobrancaId={cobrancaId} onErros={onErros} />
      {enviando ? <EnviarDialog n={n} cobrancaId={cobrancaId} onFechar={() => setEnviando(false)} /> : null}
      {manual ? <EntregaManualDialog n={n} cobrancaId={cobrancaId} onFechar={() => setManual(false)} /> : null}
      {atualizandoEntrega ? (
        <AtualizarEntregaDialog
          entrega={atualizandoEntrega}
          cobrancaId={cobrancaId}
          notificacaoId={n.id}
          onFechar={() => setAtualizandoEntrega(null)}
        />
      ) : null}
    </Card>
  )
}

// ─── Editar endereço / razão social ─────────────────────────────────────────

const CAMPOS_ENDERECO: [keyof EnderecoDestinatario, string][] = [
  ['logradouro', 'Logradouro'],
  ['numero', 'Número'],
  ['complemento', 'Complemento'],
  ['bairro', 'Bairro'],
  ['municipio', 'Município'],
  ['uf', 'UF'],
  ['cep', 'CEP'],
]

function EditarNotificacaoDialog({
  n,
  aberto,
  onOpenChange,
  cobrancaId,
  onErros,
}: {
  n: NotificacaoDaCobranca
  aberto: boolean
  onOpenChange: (v: boolean) => void
  cobrancaId: string
  onErros: (m: Map<string, string>) => void
}) {
  const qc = useQueryClient()
  const [razao, setRazao] = React.useState(n.destinatario_razao_social)
  const [end, setEnd] = React.useState<EnderecoDestinatario>({})
  const [salvando, setSalvando] = React.useState(false)

  React.useEffect(() => {
    if (!aberto) return
    setRazao(n.destinatario_razao_social)
    setEnd({ ...((n.destinatario_endereco as EnderecoDestinatario | null) ?? {}) })
  }, [aberto, n])

  async function salvar() {
    setSalvando(true)
    const r = await editarNotificacaoAction({
      id: n.id,
      destinatario_razao_social: razao.trim(),
      destinatario_endereco: { ...end, editado: true },
    })
    setSalvando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Destinatário atualizado.')
    avisarDocumentos(r.data.documentos, onErros)
    void qc.invalidateQueries({ queryKey: cobrancaKeys.notificacoes(cobrancaId) })
    onOpenChange(false)
  }

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Destinatário da notificação</DialogTitle>
          <DialogDescription>
            O endereço veio do cadastro da Receita. Corrigir aqui descarta o PDF atual e gera outro com o
            endereço novo; as próximas rodadas mantêm a correção.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="razao">Razão social</Label>
            <Input id="razao" value={razao} onChange={(e) => setRazao(e.target.value)} />
          </div>
          {CAMPOS_ENDERECO.map(([k, rotulo]) => (
            <div key={k} className={cn('space-y-1', k === 'logradouro' && 'sm:col-span-2')}>
              <Label htmlFor={`end-${k}`}>{rotulo}</Label>
              <Input
                id={`end-${k}`}
                value={(end[k] as string | null | undefined) ?? ''}
                onChange={(e) => setEnd({ ...end, [k]: e.target.value || null })}
              />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={salvando || !razao.trim()} onClick={salvar}>
            {salvando ? 'Salvando e gerando PDF…' : 'Salvar e regerar PDF'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Envio por e-mail / WhatsApp ────────────────────────────────────────────

function EnviarDialog({
  n,
  cobrancaId,
  onFechar,
}: {
  n: NotificacaoDaCobranca
  cobrancaId: string
  onFechar: () => void
}) {
  const qc = useQueryClient()
  const empresaId = n.destinatario_empresa_id
  const contatos = useQuery({
    queryKey: cobrancaKeys.contatos(empresaId ?? ''),
    queryFn: () => buscarContatosDestinatario(empresaId!),
    enabled: Boolean(empresaId),
  })
  const [escolhas, setEscolhas] = React.useState<Set<string>>(new Set())
  const [assunto, setAssunto] = React.useState('')
  const [mensagem, setMensagem] = React.useState('')
  const [enviando, setEnviando] = React.useState(false)

  function alternar(chave: string) {
    const s = new Set(escolhas)
    if (s.has(chave)) s.delete(chave)
    else s.add(chave)
    setEscolhas(s)
  }

  async function enviar() {
    const envios = [...escolhas].map((k) => {
      const [canal, contato_id] = k.split(':') as ['email' | 'whatsapp', string]
      return { canal, contato_id }
    })
    setEnviando(true)
    const r = await enviarNotificacaoAction(cobrancaId, {
      notificacao_id: n.id,
      envios,
      ...(assunto.trim() ? { assunto: assunto.trim() } : {}),
      ...(mensagem.trim() ? { mensagem: mensagem.trim() } : {}),
    })
    setEnviando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(
      `${r.data.length} envio(s) na fila de comunicação. O status de cada um aparece aqui quando o disparo acontecer.`,
    )
    void qc.invalidateQueries({ queryKey: cobrancaKeys.all })
    onFechar()
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Enviar notificação</DialogTitle>
          <DialogDescription>
            {n.destinatario_razao_social} — o PDF vai anexo, pela fila do módulo de comunicação (mesma supressão,
            mesma thread da empresa).
          </DialogDescription>
        </DialogHeader>

        {!empresaId ? (
          <p className="rounded-md border border-amber-600/30 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            Este CNPJ não está cadastrado em Empresas, então não há contatos para e-mail ou WhatsApp. Use a
            entrega manual (correio com AR ou cartório de TD) — que é, de todo modo, a prova mais forte para o
            dossiê.
          </p>
        ) : contatos.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : (contatos.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum contato cadastrado para esta empresa. Cadastre na ficha da empresa ou use a entrega manual.
          </p>
        ) : (
          <div className="max-h-72 divide-y overflow-y-auto rounded-md border">
            {(contatos.data ?? []).map((c) => {
              const whats = c.whatsapp ?? c.telefone
              return (
                <div key={c.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <span className="font-medium">{c.nome ?? 'Sem nome'}</span>
                    {c.ponto_focal ? (
                      <Badge variant="info" className="ml-2 text-[10px]">
                        ponto focal
                      </Badge>
                    ) : null}
                    {c.cargo ? <span className="block text-xs text-muted-foreground">{c.cargo}</span> : null}
                  </div>
                  <label className={cn('flex items-center gap-1.5 text-xs', !c.email && 'opacity-40')}>
                    <input
                      type="checkbox"
                      disabled={!c.email}
                      checked={escolhas.has(`email:${c.id}`)}
                      onChange={() => alternar(`email:${c.id}`)}
                    />
                    <Mail className="h-3.5 w-3.5" aria-hidden />
                    {c.email ?? 'sem e-mail'}
                  </label>
                  <label className={cn('flex items-center gap-1.5 text-xs', !whats && 'opacity-40')}>
                    <input
                      type="checkbox"
                      disabled={!whats}
                      checked={escolhas.has(`whatsapp:${c.id}`)}
                      onChange={() => alternar(`whatsapp:${c.id}`)}
                    />
                    <MessageCircle className="h-3.5 w-3.5" aria-hidden />
                    {whats ?? 'sem WhatsApp'}
                  </label>
                </div>
              )
            })}
          </div>
        )}

        <div className="grid gap-3">
          <div className="space-y-1">
            <Label htmlFor="assunto">Assunto do e-mail (opcional)</Label>
            <Input
              id="assunto"
              placeholder="Notificação extrajudicial — código — destinatário"
              value={assunto}
              onChange={(e) => setAssunto(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="mensagem">Mensagem (opcional)</Label>
            <Textarea
              id="mensagem"
              rows={3}
              placeholder="Prezados, segue em anexo notificação extrajudicial referente aos títulos em aberto…"
              value={mensagem}
              onChange={(e) => setMensagem(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button disabled={escolhas.size === 0 || enviando} onClick={enviar}>
            {enviando ? 'Enfileirando…' : `Enviar para ${escolhas.size} destino(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Entrega manual ─────────────────────────────────────────────────────────

const CANAIS_MANUAIS = ['correio_ar', 'cartorio_td', 'entrega_pessoal'] as const

function EntregaManualDialog({
  n,
  cobrancaId,
  onFechar,
}: {
  n: NotificacaoDaCobranca
  cobrancaId: string
  onFechar: () => void
}) {
  const qc = useQueryClient()
  const [canal, setCanal] = React.useState<(typeof CANAIS_MANUAIS)[number]>('correio_ar')
  const [destino, setDestino] = React.useState(formatarEndereco(n.destinatario_endereco as EnderecoDestinatario | null) ?? '')
  const [rastreio, setRastreio] = React.useState('')
  const [status, setStatus] = React.useState<'enviado' | 'entregue' | 'recusado' | 'devolvido'>('enviado')
  const [enviadoEm, setEnviadoEm] = React.useState(hojeSaoPaulo())
  const [observacao, setObservacao] = React.useState('')
  const [arquivo, setArquivo] = React.useState<File | null>(null)
  const [salvando, setSalvando] = React.useState(false)

  async function salvar() {
    setSalvando(true)
    try {
      const comprovante = arquivo ? await subirArquivoCobranca(`${cobrancaId}/entregas`, arquivo, n.id) : undefined
      const r = await registrarEntregaAction(cobrancaId, {
        notificacao_id: n.id,
        canal,
        status,
        ...(destino.trim() ? { destino: destino.trim() } : {}),
        ...(rastreio.trim() ? { codigo_rastreio: rastreio.trim() } : {}),
        ...(comprovante ? { comprovante_path: comprovante } : {}),
        ...(enviadoEm ? { enviado_em: `${enviadoEm}T12:00:00-03:00` } : {}),
        ...(observacao.trim() ? { observacao: observacao.trim() } : {}),
      })
      if (!r.ok) {
        toast.error(r.message)
        return
      }
      toast.success('Entrega registrada.')
      void qc.invalidateQueries({ queryKey: cobrancaKeys.all })
      onFechar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao registrar a entrega.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Registrar entrega manual</DialogTitle>
          <DialogDescription>
            Imprima o PDF, envie pelo canal e registre aqui o rastreio e o comprovante. A prova de entrega é
            item obrigatório do dossiê de sinistro.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Canal</Label>
            <Select value={canal} onValueChange={(v) => setCanal(v as typeof canal)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CANAIS_MANUAIS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CANAL_ENTREGA_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Situação</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['enviado', 'entregue', 'recusado', 'devolvido'] as const).map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_ENTREGA_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="destino">Endereço de destino</Label>
            <Input id="destino" value={destino} onChange={(e) => setDestino(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rastreio">{canal === 'cartorio_td' ? 'Protocolo do cartório' : 'Código de rastreio (AR)'}</Label>
            <Input id="rastreio" value={rastreio} onChange={(e) => setRastreio(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="enviado-em">Enviado em</Label>
            <Input id="enviado-em" type="date" value={enviadoEm} onChange={(e) => setEnviadoEm(e.target.value)} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="comprovante">Comprovante (AR digitalizado, certidão, protocolo)</Label>
            <Input
              id="comprovante"
              type="file"
              accept="application/pdf,image/*"
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="obs-entrega">Observação</Label>
            <Input id="obs-entrega" value={observacao} onChange={(e) => setObservacao(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button disabled={salvando} onClick={salvar}>
            {salvando ? 'Registrando…' : 'Registrar entrega'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AtualizarEntregaDialog({
  entrega,
  cobrancaId,
  notificacaoId,
  onFechar,
}: {
  entrega: Entrega
  cobrancaId: string
  notificacaoId: string
  onFechar: () => void
}) {
  const qc = useQueryClient()
  const [status, setStatus] = React.useState<'enviado' | 'entregue' | 'recusado' | 'devolvido'>(
    entrega.status === 'enviado' || entrega.status === 'pendente' ? 'entregue' : (entrega.status as 'entregue'),
  )
  const [rastreio, setRastreio] = React.useState(entrega.codigo_rastreio ?? '')
  const [confirmadoEm, setConfirmadoEm] = React.useState(hojeSaoPaulo())
  const [observacao, setObservacao] = React.useState('')
  const [arquivo, setArquivo] = React.useState<File | null>(null)
  const [salvando, setSalvando] = React.useState(false)

  async function salvar() {
    setSalvando(true)
    try {
      const comprovante = arquivo ? await subirArquivoCobranca(`${cobrancaId}/entregas`, arquivo, notificacaoId) : undefined
      const r = await registrarEntregaAction(cobrancaId, {
        id: entrega.id,
        status,
        ...(rastreio.trim() ? { codigo_rastreio: rastreio.trim() } : {}),
        ...(comprovante ? { comprovante_path: comprovante } : {}),
        ...(confirmadoEm && status !== 'enviado' ? { confirmado_em: `${confirmadoEm}T12:00:00-03:00` } : {}),
        ...(observacao.trim() ? { observacao: observacao.trim() } : {}),
      })
      if (!r.ok) {
        toast.error(r.message)
        return
      }
      toast.success(status === 'devolvido' || status === 'recusado' ? 'Devolução registrada. Confira o endereço e reenvie.' : 'Entrega atualizada.')
      void qc.invalidateQueries({ queryKey: cobrancaKeys.all })
      onFechar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao atualizar a entrega.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Atualizar entrega</DialogTitle>
          <DialogDescription>
            {CANAL_ENTREGA_LABELS[entrega.canal as CanalEntrega] ?? entrega.canal} — {entrega.destino ?? 'sem destino'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Situação</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['enviado', 'entregue', 'recusado', 'devolvido'] as const).map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_ENTREGA_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="confirmado-em">Data da confirmação</Label>
            <Input id="confirmado-em" type="date" value={confirmadoEm} onChange={(e) => setConfirmadoEm(e.target.value)} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="rastreio-upd">Rastreio / protocolo</Label>
            <Input id="rastreio-upd" value={rastreio} onChange={(e) => setRastreio(e.target.value)} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="comprovante-upd">Comprovante</Label>
            <Input
              id="comprovante-upd"
              type="file"
              accept="application/pdf,image/*"
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="obs-upd">Observação</Label>
            <Input id="obs-upd" value={observacao} onChange={(e) => setObservacao(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button disabled={salvando} onClick={salvar}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
