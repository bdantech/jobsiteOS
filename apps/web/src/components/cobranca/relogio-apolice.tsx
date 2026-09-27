'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { AlertOctagon, Clock, Info } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { buscarRelogio, buscarTitulosBoletoTrocado, gestaoKeys, type LinhaRelogio } from './gestao-queries'
import { MARCO_APOLICE_LABELS, brl, cnpj, corDoPrazo, data, prazoTexto } from './format'

/**
 * O relógio da apólice (§6.3) — a primeira coisa do módulo, e por isso a primeira
 * coisa do Painel. Cada linha é um título com o PRÓXIMO marco que ainda importa
 * (a view `apolice_relogio` já pula o D+90 depois de notificada a seguradora).
 *
 * ── AS FAIXAS SÃO DE AÇÃO, NÃO DE ESTÉTICA ─────────────────────────────────
 * ≤ 5 dias é a janela do D+85: o próximo aviso depois dela é a perda do direito à
 * indenização (cl. 28509.01 iv). ≤ 15 e ≤ 30 são as antecedências dos alertas do
 * job. Vencido é prazo que passou — ainda aparece, porque "perdido" também é uma
 * informação que alguém precisa ver para decidir o que sobra fazer.
 *
 * ── AGRUPADO PELO COMPRADOR ────────────────────────────────────────────────
 * O prazo corre por título, mas a decisão é por grupo: a franquia é por comprador e
 * o sinistro consolida o grupo inteiro (§7.3). Os grupos saem ordenados pelo título
 * mais urgente de cada um.
 */

type Faixa = 'vencido' | 'ate5' | 'ate15' | 'ate30' | 'mais30'

const FAIXAS: { id: Faixa; rotulo: string; nota: string }[] = [
  { id: 'vencido', rotulo: 'Vencidos / perdidos', nota: 'marco já passou' },
  { id: 'ate5', rotulo: '≤ 5 dias', nota: 'crítico' },
  { id: 'ate15', rotulo: '≤ 15 dias', nota: 'alto' },
  { id: 'ate30', rotulo: '≤ 30 dias', nota: 'atenção' },
  { id: 'mais30', rotulo: '> 30 dias', nota: 'no prazo' },
]

function faixaDe(dias: number | null): Faixa {
  if (dias === null) return 'mais30'
  if (dias < 0) return 'vencido'
  if (dias <= 5) return 'ate5'
  if (dias <= 15) return 'ate15'
  if (dias <= 30) return 'ate30'
  return 'mais30'
}

/** O caso D+85: notificar a seguradora em 5 dias ou menos, ou já estourado. */
function ehCritico(l: LinhaRelogio): boolean {
  return l.proximo_marco === 'notificacao_seguradora' && (l.dias_restantes ?? 99) <= 5
}

const GRUPOS_POR_PAGINA = 20

export function RelogioApolice({ usuarioId, gestor }: { usuarioId: string; gestor: boolean }) {
  const relogio = useQuery({ queryKey: gestaoKeys.relogio(), queryFn: buscarRelogio })
  const trocados = useQuery({ queryKey: gestaoKeys.boletoTrocado(), queryFn: buscarTitulosBoletoTrocado })

  // Operador abre na PRÓPRIA fila; gestor, na carteira inteira. Um toggle troca — o
  // relógio não esconde nada de ninguém, só escolhe por onde começar.
  const [minhas, setMinhas] = React.useState(!gestor)
  const [faixa, setFaixa] = React.useState<Faixa | null>(null)
  const [paginas, setPaginas] = React.useState(1)
  React.useEffect(() => setMinhas(!gestor), [gestor])

  const linhas = React.useMemo(() => relogio.data ?? [], [relogio.data])
  const visiveis = React.useMemo(
    () => (minhas ? linhas.filter((l) => l.responsavel_id === usuarioId) : linhas),
    [linhas, minhas, usuarioId],
  )

  const porFaixa = React.useMemo(() => {
    const m = new Map<Faixa, { qtd: number; valor: number }>()
    for (const l of visiveis) {
      const f = faixaDe(l.dias_restantes)
      const v = m.get(f) ?? { qtd: 0, valor: 0 }
      v.qtd++
      v.valor += Number(l.valor_face ?? 0)
      m.set(f, v)
    }
    return m
  }, [visiveis])

  const criticos = visiveis.filter(ehCritico)

  const grupos = React.useMemo(() => {
    const filtradas = faixa ? visiveis.filter((l) => faixaDe(l.dias_restantes) === faixa) : visiveis
    const m = new Map<string, LinhaRelogio[]>()
    for (const l of filtradas) {
      const k = l.sacado_matriz_cnpj ?? '—'
      const g = m.get(k) ?? []
      g.push(l)
      m.set(k, g)
    }
    return [...m.entries()]
      .map(([matriz, itens]) => {
        const ordenados = [...itens].sort((a, b) => (a.dias_restantes ?? 9999) - (b.dias_restantes ?? 9999))
        const daMatriz = itens.find((i) => i.sacado_cnpj === matriz)
        return {
          matriz,
          nome: daMatriz?.sacado_nome ?? itens[0]?.sacado_nome ?? null,
          itens: ordenados,
          minimo: ordenados[0]?.dias_restantes ?? 9999,
          valor: itens.reduce((s, i) => s + Number(i.valor_face ?? 0), 0),
          critico: itens.some(ehCritico),
        }
      })
      .sort((a, b) => a.minimo - b.minimo)
  }, [visiveis, faixa])

  if (relogio.isLoading) return <Skeleton className="h-72 w-full" />
  if (relogio.isError) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-destructive">
          Não foi possível carregar o relógio da apólice. Recarregue a página — este bloco não pode ficar em branco sem aviso.
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={cn(criticos.length > 0 && 'border-destructive')}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4" aria-hidden />
            Relógio da apólice
          </CardTitle>
          <div className="flex items-center gap-2">
            <Switch id="relogio-minhas" checked={minhas} onCheckedChange={setMinhas} />
            <Label htmlFor="relogio-minhas" className="text-sm font-normal">
              Só minhas cobranças
            </Label>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {criticos.length > 0 ? (
          <div className="flex items-start gap-3 rounded-md border border-destructive bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-100">
            <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden />
            <div>
              <p className="font-semibold">
                {criticos.length} título(s) a 5 dias ou menos do prazo de notificar a seguradora (D+90).
              </p>
              <p>
                Perder esse prazo é perder o direito à indenização (cl. 28509.01 iv). Notifique pelo sinistro — ou, se o
                sistema falhar, pelo modo manual. O prazo não espera.
              </p>
            </div>
          </div>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {FAIXAS.map((f) => {
            const v = porFaixa.get(f.id)
            const ativa = faixa === f.id
            const vermelho = f.id === 'vencido' || f.id === 'ate5'
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  setFaixa(ativa ? null : f.id)
                  setPaginas(1)
                }}
                aria-pressed={ativa}
                className={cn(
                  'rounded-md border p-3 text-left transition-colors hover:bg-accent',
                  ativa ? 'border-primary ring-1 ring-primary' : 'border-border',
                )}
              >
                <div className="text-xs text-muted-foreground">{f.rotulo}</div>
                <div
                  className={cn(
                    'text-xl font-semibold tabular-nums',
                    vermelho && (v?.qtd ?? 0) > 0 && 'text-destructive',
                    f.id === 'ate15' && (v?.qtd ?? 0) > 0 && 'text-amber-600 dark:text-amber-400',
                  )}
                >
                  {v?.qtd ?? 0}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {brl(v?.valor ?? 0, 0)} · {f.nota}
                </div>
              </button>
            )
          })}
        </div>

        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          A produção não informa a liquidação de títulos com boleto trocado (BILLET_SWAPPED e variantes): alguns
          destes podem já estar pagos. Os marcados “boleto trocado” pedem conferência na plataforma antes de qualquer
          comunicação à seguradora.
        </p>

        {grupos.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {minhas
              ? 'Nenhum prazo de apólice nas suas cobranças. Desligue "Só minhas cobranças" para ver a carteira inteira.'
              : 'Nenhum título com prazo de apólice em aberto.'}
          </p>
        ) : (
          <div className="space-y-3">
            {grupos.slice(0, paginas * GRUPOS_POR_PAGINA).map((g) => (
              <div key={g.matriz} className={cn('rounded-md border', g.critico ? 'border-destructive' : 'border-border')}>
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2">
                  <div>
                    <span className="font-medium">{g.nome ?? 'Sacado sem nome'}</span>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{cnpj(g.matriz)}</span>
                  </div>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {g.itens.length} título(s) · {brl(g.valor)}
                  </span>
                </div>
                <ul className="divide-y divide-border">
                  {g.itens.map((l) => (
                    <LinhaPrazo key={l.id ?? `${l.titulo_id}`} l={l} boletoTrocado={!!l.titulo_id && !!trocados.data?.has(l.titulo_id)} />
                  ))}
                </ul>
              </div>
            ))}
            {grupos.length > paginas * GRUPOS_POR_PAGINA ? (
              <Button variant="outline" size="sm" onClick={() => setPaginas((p) => p + 1)}>
                Mostrar mais {Math.min(GRUPOS_POR_PAGINA, grupos.length - paginas * GRUPOS_POR_PAGINA)} grupo(s)
              </Button>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function LinhaPrazo({ l, boletoTrocado }: { l: LinhaRelogio; boletoTrocado: boolean }) {
  const critico = ehCritico(l)
  const spe = l.sacado_cnpj && l.sacado_cnpj !== l.sacado_matriz_cnpj ? l.sacado_nome ?? cnpj(l.sacado_cnpj) : null
  return (
    <li className={cn('grid gap-2 px-3 py-2 text-sm sm:grid-cols-[1fr_auto]', critico && 'bg-red-50 dark:bg-red-950/40')}>
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">Título {l.numero ?? '—'}</span>
          {spe ? <span className="truncate text-xs text-muted-foreground">SPE: {spe}</span> : null}
          <span className="text-xs text-muted-foreground">cedente {l.cedente_nome ?? '—'}</span>
          {l.causa === 'insolvencia' ? <Badge variant="warning">insolvência</Badge> : null}
          {boletoTrocado ? <Badge variant="warning">boleto trocado — pode estar pago</Badge> : null}
        </div>
        <div className="text-xs text-muted-foreground">
          {MARCO_APOLICE_LABELS[l.proximo_marco ?? ''] ?? l.proximo_marco} em {data(l.proximo_marco_em)} · vencimento
          original {data(l.vencimento_original)} (D+{l.dias_desde_vencimento ?? '—'})
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {l.cobranca_id ? (
            <Link href={`/cobranca/cobrancas/${l.cobranca_id}`} className="text-primary hover:underline">
              {l.cobranca_codigo ?? 'Cobrança'}
            </Link>
          ) : (
            <>
              <Badge variant="neutral">fora de cobrança</Badge>
              <Link
                href={`/cobranca/nova?sacado=${l.sacado_matriz_cnpj ?? ''}`}
                className="text-primary hover:underline"
              >
                Nova cobrança
              </Link>
            </>
          )}
          {l.sinistro_id ? (
            <Link href={`/cobranca/sinistros/${l.sinistro_id}`} className="text-primary hover:underline">
              {l.sinistro_codigo ?? 'Sinistro'}
            </Link>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-4 sm:flex-col sm:items-end sm:gap-0">
        <span className={cn('tabular-nums', corDoPrazo(l.dias_restantes))}>{prazoTexto(l.dias_restantes)}</span>
        <span className="tabular-nums text-muted-foreground">{brl(l.valor_face)}</span>
      </div>
    </li>
  )
}
