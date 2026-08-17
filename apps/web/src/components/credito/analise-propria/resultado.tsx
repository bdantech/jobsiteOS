'use client'

import * as React from 'react'
import { AlertTriangle, CheckCircle2, MinusCircle, XCircle } from 'lucide-react'
import {
  INDICADOR_LABELS,
  TETO_LABELS,
  type Cenario,
  type Indicador,
  type IndicadorId,
  type Semaforo,
  type Teto,
  type TetoId,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/**
 * O resultado do cálculo determinístico, na tela.
 *
 * ─── A REGRA DE APRESENTAÇÃO ────────────────────────────────────────────────
 * O que NÃO pôde ser calculado aparece com o mesmo destaque do que pôde, e sempre com o
 * motivo. Esconder o teto não aplicável deixaria o limite parecer o resultado de cinco
 * réguas quando ele saiu de duas — e é justamente a diferença entre um número e um
 * número que alguém consegue defender.
 *
 * O teto VINCULANTE é o único destacado: entre cinco números, é o único que virou o
 * limite, e ler os cinco em pé de igualdade é não ler nenhum.
 */

export const brl = (n: number | null | undefined): string =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? '—'
    : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

function formatarIndicador(i: Indicador): string {
  if (i.valor === null) return '—'
  if (i.unidade === 'pct') return `${(i.valor * 100).toFixed(1)}%`
  if (i.unidade === 'dias') return `${Math.round(i.valor)} dias`
  return `${i.valor.toFixed(2)}x`
}

const CORES: Record<Semaforo, string> = {
  verde: 'bg-emerald-500',
  amarelo: 'bg-amber-500',
  vermelho: 'bg-red-500',
}

function Farol({ faixa }: { faixa: Semaforo | null }) {
  if (!faixa) {
    return (
      <span
        className="inline-block h-2 w-2 shrink-0 rounded-full border border-muted-foreground/40"
        title="Sem valor: o indicador não é avaliável com o que foi extraído."
        aria-label="Não avaliável"
      />
    )
  }
  return (
    <span
      className={cn('inline-block h-2 w-2 shrink-0 rounded-full', CORES[faixa])}
      aria-label={faixa}
      title={faixa}
    />
  )
}

export function Indicadores({ indicadores }: { indicadores: Indicador[] }) {
  const comValor = indicadores.filter((i) => i.valor !== null)
  const semValor = indicadores.filter((i) => i.valor === null)

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Indicadores</CardTitle>
        <CardDescription>
          Cada um com a fórmula e os insumos que entraram. Fórmula fixa e versionada — a mesma
          entrada dá o mesmo número, sempre.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="divide-y rounded-lg border">
          {comValor.map((i) => (
            <li key={i.id} className="px-3 py-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex items-center gap-2 text-sm">
                  <Farol faixa={i.faixa} />
                  {INDICADOR_LABELS[i.id as IndicadorId] ?? i.id}
                </span>
                <span className="shrink-0 text-sm font-medium tabular-nums">{formatarIndicador(i)}</span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{i.formula}</p>
            </li>
          ))}
        </ul>

        {semValor.length > 0 && (
          <div className="rounded-lg border border-dashed p-3">
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Não avaliáveis ({semValor.length})
            </p>
            <ul className="space-y-1">
              {semValor.map((i) => (
                <li key={i.id} className="text-xs text-muted-foreground">
                  <span className="text-foreground">{INDICADOR_LABELS[i.id as IndicadorId] ?? i.id}</span>
                  {' — '}
                  {i.motivo_sem_valor}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function Tetos({ tetos }: { tetos: Teto[] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Os cinco tetos</CardTitle>
        <CardDescription>
          Vale o <strong>menor entre os aplicáveis</strong>. Um teto não aplicável sai da conta —
          nunca entra como zero.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {tetos.map((t) => (
            <li
              key={t.id}
              className={cn(
                'rounded-lg border p-3',
                t.vinculante && 'border-primary bg-primary/5',
                !t.aplicavel && 'border-dashed bg-muted/30',
              )}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-medium">
                  {t.aplicavel ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  ) : (
                    <MinusCircle className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  )}
                  {TETO_LABELS[t.id as TetoId] ?? t.id}
                  {t.vinculante && (
                    <Badge variant="default" className="text-[10px]">
                      vinculante
                    </Badge>
                  )}
                </span>
                <span className="shrink-0 text-sm tabular-nums">
                  {t.aplicavel ? brl(t.valor) : <span className="text-muted-foreground">não aplicável</span>}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t.aplicavel ? t.formula : t.motivo_nao_aplicavel}
              </p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

export function Cenarios({
  cenarios,
  recomendacao,
  limite,
  motivos,
}: {
  cenarios: Cenario[]
  recomendacao: string | null
  limite: number | null
  motivos: string[]
}) {
  const operar = recomendacao === 'operar'

  return (
    <Card className={cn(operar ? 'border-emerald-500/40' : 'border-red-500/40')}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          {operar ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden />
          ) : (
            <XCircle className="h-5 w-5 text-red-600" aria-hidden />
          )}
          <CardTitle className="text-base">{operar ? 'OPERAR' : 'NÃO OPERAR'}</CardTitle>
          {operar && <span className="text-lg font-semibold tabular-nums">{brl(limite)}</span>}
        </div>
        <CardDescription>
          {operar
            ? 'O cenário base é o número da recomendação. Ele é o menor teto aplicável, sem ajuste.'
            : 'A recomendação é automática e sempre acompanhada dos motivos. Ela não impede a decisão humana — só a obriga a ser escrita.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {motivos.length > 0 && (
          <ul className="space-y-1 rounded-lg border border-red-500/40 bg-red-500/5 p-3">
            {motivos.map((m) => (
              <li key={m} className="flex gap-2 text-sm">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" aria-hidden />
                {m}
              </li>
            ))}
          </ul>
        )}

        {cenarios.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-3">
            {cenarios.map((c) => (
              <div
                key={c.nome}
                className={cn('rounded-lg border p-3', c.nome === 'base' && 'border-primary bg-primary/5')}
              >
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{c.nome}</p>
                <p className="text-lg font-semibold tabular-nums">{brl(c.limite)}</p>
                <p className="mt-1 text-xs text-muted-foreground">{c.racional}</p>
                {c.condicionantes && c.condicionantes.length > 0 && (
                  <ul className="mt-2 space-y-0.5">
                    {c.condicionantes.map((cd) => (
                      <li key={cd} className="text-xs text-amber-700 dark:text-amber-500">
                        · {cd}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function Lacunas({ lacunas }: { lacunas: string[] }) {
  if (lacunas.length === 0) return null
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">O que não fechou</CardTitle>
        <CardDescription>
          Não impede a recomendação — mas é sobre isto que se pergunta ao cliente.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1">
          {lacunas.map((l) => (
            <li key={l} className="text-xs text-muted-foreground">
              · {l}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
