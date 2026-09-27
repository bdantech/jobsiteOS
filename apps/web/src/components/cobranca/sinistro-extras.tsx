'use client'

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, Paperclip } from 'lucide-react'
import { hojeSaoPaulo } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { custoSinistroAction, solicitacaoSinistroAction } from '@/actions/cobranca-gestao'
import { gestaoKeys, subirArquivoCobranca, type SinistroDetalhe } from './gestao-queries'
import { abrirArquivo, numeroBr } from './sinistro-arquivos'
import { diasAte } from './sinistros-lista'
import { brl, corDoPrazo, data, prazoTexto } from './format'

// ─── Documentos complementares ──────────────────────────────────────────────

/**
 * Pedido de documento complementar da seguradora: 30 dias (parâmetro da apólice) a
 * partir da solicitação, sob pena de suspensão ou negativa da análise. Registrar o
 * pedido move o sinistro para "documentos pendentes"; responder todos o devolve à
 * análise (a RPC faz as duas coisas).
 */
export function SolicitacoesSinistro({ d }: { d: SinistroDetalhe }) {
  const qc = useQueryClient()
  const [descricao, setDescricao] = React.useState('')
  const [solicitadaEm, setSolicitadaEm] = React.useState(hojeSaoPaulo())
  const [enviando, setEnviando] = React.useState(false)
  const prazoDias = d.apolice?.prazo_documentos_complementares_dias ?? 30

  async function executar(input: Parameters<typeof solicitacaoSinistroAction>[0], ok: string) {
    setEnviando(true)
    const r = await solicitacaoSinistroAction(input)
    setEnviando(false)
    if (!r.ok) {
      toast.error(r.message)
      return false
    }
    toast.success(ok)
    void qc.invalidateQueries({ queryKey: gestaoKeys.all })
    return true
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Documentos complementares pedidos pela seguradora</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {d.solicitacoes.length === 0 ? (
          <p className="text-muted-foreground">Nenhum pedido registrado.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {d.solicitacoes.map((s) => {
              const dias = s.status === 'aberta' ? diasAte(s.prazo_em) : null
              return (
                <li key={s.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-wrap">{s.descricao}</p>
                    <p className="text-xs text-muted-foreground">
                      pedido em {data(s.solicitada_em)} · prazo {data(s.prazo_em)}
                      {s.respondida_em ? ` · respondido em ${data(s.respondida_em)}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {s.status === 'aberta' ? (
                      <>
                        <span className={cn('text-xs tabular-nums', corDoPrazo(dias))}>{prazoTexto(dias)}</span>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={enviando}
                          onClick={() => void executar({ id: s.id, respondida_em: hojeSaoPaulo() }, 'Pedido marcado como respondido.')}
                        >
                          Respondido
                        </Button>
                      </>
                    ) : (
                      <Badge variant={s.status === 'vencida' ? 'critical' : 'success'}>
                        {s.status === 'vencida' ? 'vencida' : 'respondida'}
                      </Badge>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        <div className="grid gap-2 border-t border-border pt-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
          <div className="space-y-1">
            <Label htmlFor="sol-desc">Novo pedido da seguradora</Label>
            <Textarea id="sol-desc" rows={2} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sol-data">Pedido em</Label>
            <Input id="sol-data" type="date" value={solicitadaEm} onChange={(e) => setSolicitadaEm(e.target.value)} />
          </div>
          <Button
            size="sm"
            disabled={enviando || descricao.trim().length < 3}
            onClick={async () => {
              const ok = await executar(
                { sinistro_id: d.sinistro.id, descricao: descricao.trim(), solicitada_em: solicitadaEm },
                `Pedido registrado: prazo de ${prazoDias} dias.`,
              )
              if (ok) setDescricao('')
            }}
          >
            Registrar
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Custos (cl. 20700.20) ──────────────────────────────────────────────────

/**
 * Custo de cobrança só é reembolsado com aprovação PRÉVIA ou por instrução da
 * seguradora. O que entra sem ela fica em vermelho, "provável não reembolsável": a
 * tela existe para o time parar de gastar às cegas, não para enfeitar o custo.
 */
export function CustosSinistro({ d }: { d: SinistroDetalhe }) {
  const qc = useQueryClient()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [descricao, setDescricao] = React.useState('')
  const [valor, setValor] = React.useState('')
  const [dataCusto, setDataCusto] = React.useState(hojeSaoPaulo())
  const [aprovado, setAprovado] = React.useState(false)
  const [referencia, setReferencia] = React.useState('')
  const [arquivo, setArquivo] = React.useState<File | null>(null)
  const [enviando, setEnviando] = React.useState(false)

  const total = d.custos.reduce((s, c) => s + Number(c.valor), 0)
  const naoAprovado = d.custos.filter((c) => !c.aprovado_pela_seguradora).reduce((s, c) => s + Number(c.valor), 0)
  const valorN = numeroBr(valor)

  async function registrar() {
    if (!valorN || valorN <= 0) return
    setEnviando(true)
    try {
      const comprovante = arquivo ? await subirArquivoCobranca(`sinistros/${d.sinistro.id}/custos`, arquivo) : null
      const r = await custoSinistroAction({
        sinistro_id: d.sinistro.id,
        cobranca_id: d.sinistro.cobranca_id ?? undefined,
        descricao: descricao.trim(),
        valor: valorN,
        data: dataCusto,
        aprovado_pela_seguradora: aprovado,
        aprovacao_referencia: aprovado ? referencia.trim() : undefined,
        comprovante_path: comprovante?.caminho,
      })
      if (!r.ok) {
        toast.error(r.message)
        return
      }
      toast.success(aprovado ? 'Custo registrado.' : 'Custo registrado sem aprovação prévia — provável não reembolsável.')
      setDescricao('')
      setValor('')
      setAprovado(false)
      setReferencia('')
      setArquivo(null)
      void qc.invalidateQueries({ queryKey: gestaoKeys.all })
    } catch (e) {
      toast.error(e instanceof Error ? `Falha no upload: ${e.message}` : 'Falha no upload.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Custos de cobrança</CardTitle>
          <span className="text-xs text-muted-foreground">
            total {brl(total)}
            {naoAprovado > 0 ? <span className="ml-2 text-destructive">não aprovado {brl(naoAprovado)}</span> : null}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {d.custos.length === 0 ? (
          <p className="text-muted-foreground">Nenhum custo lançado.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {d.custos.map((c) => (
              <li
                key={c.id}
                className={cn(
                  'flex flex-wrap items-center justify-between gap-2 px-3 py-2',
                  !c.aprovado_pela_seguradora && 'bg-red-50 dark:bg-red-950/40',
                )}
              >
                <div className="min-w-0">
                  <p>{c.descricao}</p>
                  <p className="text-xs text-muted-foreground">
                    {data(c.data)}
                    {c.aprovacao_referencia ? ` · aprovação: ${c.aprovacao_referencia}` : ''}
                  </p>
                  {c.comprovante_path ? (
                    <button
                      type="button"
                      className="flex items-center gap-1 text-xs text-primary hover:underline"
                      onClick={() => void abrirArquivo(c.comprovante_path!)}
                    >
                      <Paperclip className="h-3 w-3" aria-hidden />
                      comprovante
                    </button>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  {c.aprovado_pela_seguradora ? (
                    <Badge variant="success">aprovado pela seguradora</Badge>
                  ) : (
                    <span className="flex items-center gap-1 text-xs font-medium text-destructive">
                      <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                      provável não reembolsável
                    </span>
                  )}
                  <span className="tabular-nums font-medium">{brl(c.valor)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="grid gap-3 border-t border-border pt-3 sm:grid-cols-4">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="custo-desc">Descrição</Label>
            <Input id="custo-desc" value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Custas de protesto, AR, diligência…" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="custo-valor">Valor (R$)</Label>
            <Input id="custo-valor" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="custo-data">Data</Label>
            <Input id="custo-data" type="date" value={dataCusto} onChange={(e) => setDataCusto(e.target.value)} />
          </div>
          <div className="flex items-center gap-2 sm:col-span-2">
            <Switch id="custo-aprovado" checked={aprovado} onCheckedChange={setAprovado} />
            <Label htmlFor="custo-aprovado" className="font-normal">
              Aprovado previamente pela seguradora
            </Label>
          </div>
          {aprovado ? (
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="custo-ref">Referência da aprovação (e-mail/protocolo)</Label>
              <Input id="custo-ref" value={referencia} onChange={(e) => setReferencia(e.target.value)} />
            </div>
          ) : (
            <p className="text-xs text-destructive sm:col-span-2">
              Sem aprovação prévia, a cl. 20700.20 não reembolsa este custo.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 sm:col-span-4">
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                setArquivo(e.target.files?.[0] ?? null)
                e.target.value = ''
              }}
            />
            <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()} disabled={enviando}>
              <Paperclip className="mr-1 h-3.5 w-3.5" />
              {arquivo ? arquivo.name : 'Comprovante (opcional)'}
            </Button>
            <Button
              size="sm"
              onClick={() => void registrar()}
              disabled={enviando || descricao.trim().length < 2 || !valorN || valorN <= 0 || (aprovado && !referencia.trim())}
            >
              {enviando ? 'Salvando…' : 'Lançar custo'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
