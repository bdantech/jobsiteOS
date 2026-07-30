'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Banknote, History, RefreshCw, TrendingDown, TrendingUp, Users } from 'lucide-react'
import {
  ORIGEM_METRICA_LABELS,
  crescimento12m,
  type OrigemMetrica,
  type Tables,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
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
import { Skeleton } from '@/components/ui/skeleton'
import { atualizarFuncionariosAction } from '@/actions/radar'
import { declararMetricaAction } from '@/actions/empresas'
import { cn } from '@/lib/utils'
import { empresasKeys, buscarMetricas } from './queries'

/**
 * Faturamento & Equipe na Company 360 (04c §8).
 *
 * O card mostra o valor VIGENTE de cada métrica com origem, confiança e data — e a
 * origem é tão importante quanto o número. "R$ 40M declarado pelo cliente" e "R$ 40M
 * estimado por um modelo calibrado em cinco empresas" levam a conversas comerciais
 * diferentes, e sem o rótulo as duas viram a mesma frase na boca do vendedor.
 *
 * A sparkline existe pela mesma razão: o nível interessa menos que a direção. Uma
 * empresa que saiu de 40 para 120 pessoas em um ano é uma conversa; a mesma empresa
 * parada em 120 há três anos é outra.
 */

type Metrica = Tables<'empresa_metricas'>

const CONFIANCA_BADGE: Record<string, string> = {
  alta: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200',
  media: 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
  baixa: 'bg-red-100 text-red-900 dark:bg-red-500/20 dark:text-red-200',
}

function moeda(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—'
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

function data(v: string | null): string {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR')
}

function rotuloOrigem(o: string | null): string {
  if (!o) return '—'
  return ORIGEM_METRICA_LABELS[o as OrigemMetrica] ?? o
}

/**
 * Sparkline em SVG puro, sem biblioteca: são até 20 pontos numa caixa de 40px. Uma
 * dependência de gráfico aqui custaria mais bytes que o resto do card inteiro.
 */
function Sparkline({ pontos }: { pontos: number[] }) {
  if (pontos.length < 2) return null
  const max = Math.max(...pontos)
  const min = Math.min(...pontos)
  const amplitude = max - min || 1
  const largura = 88
  const altura = 28
  const passo = largura / (pontos.length - 1)
  const d = pontos
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${(i * passo).toFixed(1)} ${(altura - ((p - min) / amplitude) * altura).toFixed(1)}`)
    .join(' ')
  const subiu = pontos[pontos.length - 1]! >= pontos[0]!

  return (
    <svg width={largura} height={altura} className="shrink-0" aria-hidden>
      <path
        d={d}
        fill="none"
        strokeWidth={1.5}
        className={subiu ? 'stroke-emerald-500' : 'stroke-destructive'}
      />
    </svg>
  )
}

function Variacao({ valor }: { valor: number | null }) {
  if (valor === null) return null
  const pct = (valor * 100).toFixed(0)
  const subiu = valor >= 0
  const Icone = subiu ? TrendingUp : TrendingDown
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-xs font-medium',
        subiu ? 'text-emerald-700 dark:text-emerald-300' : 'text-destructive',
      )}
      title="Variação em 12 meses"
    >
      <Icone className="h-3 w-3" aria-hidden />
      {subiu ? '+' : ''}
      {pct}%
    </span>
  )
}

function HistoricoDialog({
  aberto,
  onOpenChange,
  titulo,
  pontos,
  formatar,
}: {
  aberto: boolean
  onOpenChange: (v: boolean) => void
  titulo: string
  pontos: Metrica[]
  formatar: (v: number) => string
}) {
  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>
            Cada linha é uma leitura, com a origem de onde veio. Nada aqui é sobrescrito — a
            série guarda inclusive as leituras que perderam para uma origem melhor.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-80 overflow-y-auto">
          {pontos.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma leitura ainda.</p>
          ) : (
            <ul className="divide-y">
              {pontos.map((p) => (
                <li key={p.id} className="flex items-baseline justify-between gap-3 py-2">
                  <span className="font-medium tabular-nums">{formatar(Number(p.valor))}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline" className="text-[10px]">
                      {rotuloOrigem(p.origem)}
                    </Badge>
                    {data(p.capturado_em)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function DeclararDialog({
  aberto,
  onOpenChange,
  empresaId,
  metrica,
  onSalvo,
}: {
  aberto: boolean
  onOpenChange: (v: boolean) => void
  empresaId: string
  metrica: 'faturamento_anual' | 'funcionarios'
  onSalvo: () => void
}) {
  const [salvando, setSalvando] = React.useState(false)
  const [erro, setErro] = React.useState<string | null>(null)
  const ehFaturamento = metrica === 'faturamento_anual'

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setSalvando(true)
    setErro(null)
    const r = await declararMetricaAction({
      empresa_id: empresaId,
      metrica,
      valor: String(fd.get('valor') ?? ''),
      ano: ehFaturamento ? String(fd.get('ano') ?? '') : undefined,
    })
    setSalvando(false)
    if (!r.ok) {
      setErro(r.message)
      return
    }
    toast.success('Declaração registrada. Ela vence qualquer estimativa.')
    onOpenChange(false)
    onSalvo()
  }

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={enviar}>
          <DialogHeader>
            <DialogTitle>
              {ehFaturamento ? 'Declarar faturamento anual' : 'Declarar funcionários'}
            </DialogTitle>
            <DialogDescription>
              O que o cliente informou. Fica no topo da hierarquia de origens: nenhuma
              estimativa sobrescreve, e é isto que calibra o modelo para todo o resto da base.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="valor">{ehFaturamento ? 'Faturamento anual (R$)' : 'Funcionários'}</Label>
              <Input id="valor" name="valor" type="number" min={0} step={ehFaturamento ? '0.01' : '1'} required />
            </div>
            {ehFaturamento && (
              <div className="space-y-1.5">
                <Label htmlFor="ano">Ano de referência</Label>
                <Input
                  id="ano"
                  name="ano"
                  type="number"
                  min={2000}
                  max={2100}
                  placeholder={String(new Date().getFullYear() - 1)}
                />
              </div>
            )}
          </div>

          {erro ? <p className="pb-2 text-sm text-destructive">{erro}</p> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={salvando}>
              {salvando ? 'Salvando…' : 'Declarar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export interface FaturamentoEquipeProps {
  empresaId: string
  cnpj: string
  faturamento: number | null
  faturamentoOrigem: string | null
  faturamentoConfianca: string | null
  faturamentoEm: string | null
  funcionarios: number | null
  funcionariosOrigem: string | null
  funcionariosEm: string | null
  /** Só clientes ganham os campos de declaração (§5). */
  eCliente: boolean
}

export function FaturamentoEquipe(props: FaturamentoEquipeProps) {
  const qc = useQueryClient()
  const [atualizando, setAtualizando] = React.useState(false)
  const [historico, setHistorico] = React.useState<'faturamento_anual' | 'funcionarios' | null>(null)
  const [declarando, setDeclarando] = React.useState<'faturamento_anual' | 'funcionarios' | null>(null)

  const { data: serie = [], isPending } = useQuery({
    queryKey: empresasKeys.metricas(props.cnpj),
    queryFn: () => buscarMetricas(props.cnpj),
  })

  function recarregar() {
    void qc.invalidateQueries({ queryKey: empresasKeys.metricas(props.cnpj) })
    void qc.invalidateQueries({ queryKey: empresasKeys.detalhe(props.empresaId) })
    void qc.invalidateQueries({ queryKey: empresasKeys.eventos(props.empresaId) })
  }

  const porMetrica = React.useMemo(() => {
    const f = serie.filter((m) => m.metrica === 'faturamento_anual')
    const h = serie.filter((m) => m.metrica === 'funcionarios')
    return { faturamento_anual: f, funcionarios: h }
  }, [serie])

  // A sparkline usa a série INTEIRA, inclusive leituras que perderam na hierarquia:
  // é a trajetória da medida, não do cache. Filtrar por origem daria uma linha com
  // buracos exatamente nos meses em que a fonte mudou.
  const crescimentoEquipe = React.useMemo(
    () =>
      crescimento12m(
        porMetrica.funcionarios.map((m) => ({ valor: Number(m.valor), capturado_em: m.capturado_em })),
      ),
    [porMetrica.funcionarios],
  )

  async function atualizarFuncionarios() {
    setAtualizando(true)
    const r = await atualizarFuncionariosAction(props.empresaId)
    setAtualizando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    if (!r.data.enfileirado) {
      toast.error(r.data.aviso ?? 'Não foi possível disparar a consulta.')
      return
    }
    // Assíncrono: o worker devolve 202 e consulta o Apollo em segundo plano.
    toast.success('Consultando o Apollo. Recarregue em alguns instantes.')
  }

  const pontosEquipe = [...porMetrica.funcionarios]
    .sort((a, b) => Date.parse(a.capturado_em) - Date.parse(b.capturado_em))
    .slice(-20)
    .map((m) => Number(m.valor))

  const pontosFat = [...porMetrica.faturamento_anual]
    .sort((a, b) => Date.parse(a.capturado_em) - Date.parse(b.capturado_em))
    .slice(-20)
    .map((m) => Number(m.valor))

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="text-base">Faturamento &amp; Equipe</CardTitle>
            <CardDescription>
              A <strong>origem</strong> conta tanto quanto o número: declarado pelo cliente é
              fato, o resto é estimativa. Fontes como o Apollo <strong>subcontam</strong> mão de
              obra de canteiro — servem para comparar empresas entre si, não como quadro real.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => void atualizarFuncionarios()}
            disabled={atualizando}
            title="Consulta o headcount no Apollo. Não consome crédito de revelação."
          >
            <RefreshCw className={cn('mr-1 h-3.5 w-3.5', atualizando && 'animate-spin')} aria-hidden />
            {atualizando ? 'Disparando…' : 'Atualizar funcionários'}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="grid gap-4 sm:grid-cols-2">
        {isPending ? (
          <>
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </>
        ) : (
          <>
            {/* ── Faturamento ── */}
            <div className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Banknote className="h-3.5 w-3.5" aria-hidden />
                Faturamento anual
              </div>
              <div className="flex items-end justify-between gap-2">
                <p className="text-xl font-semibold tabular-nums">{moeda(props.faturamento)}</p>
                <Sparkline pontos={pontosFat} />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="text-[10px]">
                  {rotuloOrigem(props.faturamentoOrigem)}
                </Badge>
                {props.faturamentoConfianca && (
                  <Badge className={cn('text-[10px]', CONFIANCA_BADGE[props.faturamentoConfianca])}>
                    {props.faturamentoConfianca}
                  </Badge>
                )}
                <span className="text-[11px] text-muted-foreground">{data(props.faturamentoEm)}</span>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  onClick={() => setHistorico('faturamento_anual')}
                >
                  <History className="h-3 w-3" aria-hidden />
                  Histórico ({porMetrica.faturamento_anual.length})
                </button>
                {props.eCliente && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    onClick={() => setDeclarando('faturamento_anual')}
                  >
                    Declarar
                  </button>
                )}
              </div>
            </div>

            {/* ── Equipe ── */}
            <div className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Users className="h-3.5 w-3.5" aria-hidden />
                Funcionários
              </div>
              <div className="flex items-end justify-between gap-2">
                <div className="flex items-baseline gap-2">
                  <p className="text-xl font-semibold tabular-nums">
                    {props.funcionarios === null ? '—' : props.funcionarios.toLocaleString('pt-BR')}
                  </p>
                  <Variacao valor={crescimentoEquipe} />
                </div>
                <Sparkline pontos={pontosEquipe} />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="text-[10px]">
                  {rotuloOrigem(props.funcionariosOrigem)}
                </Badge>
                <span className="text-[11px] text-muted-foreground">{data(props.funcionariosEm)}</span>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  onClick={() => setHistorico('funcionarios')}
                >
                  <History className="h-3 w-3" aria-hidden />
                  Histórico ({porMetrica.funcionarios.length})
                </button>
                {props.eCliente && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    onClick={() => setDeclarando('funcionarios')}
                  >
                    Declarar
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </CardContent>

      <HistoricoDialog
        aberto={historico !== null}
        onOpenChange={(v) => !v && setHistorico(null)}
        titulo={historico === 'faturamento_anual' ? 'Histórico de faturamento' : 'Histórico de equipe'}
        pontos={historico ? porMetrica[historico] : []}
        formatar={(v) => (historico === 'faturamento_anual' ? moeda(v) : v.toLocaleString('pt-BR'))}
      />

      {declarando && (
        <DeclararDialog
          aberto
          onOpenChange={(v) => !v && setDeclarando(null)}
          empresaId={props.empresaId}
          metrica={declarando}
          onSalvo={recarregar}
        />
      )}
    </Card>
  )
}
