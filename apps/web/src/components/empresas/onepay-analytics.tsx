'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Lock } from 'lucide-react'
import { CAMADAS, CAMADA_DESCRICOES, type Camada } from '@jobsiteos/core'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  CirculosCamadas,
  type DadosCamada,
} from '@/components/mercado/camadas/circulos-camadas'
import { buscarOnepayAnalytics, empresasKeys, type OnepayAnalytics } from './queries'

const pctDe = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0)
const fmtPct = (p: number) => `${p.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`

// ─── a) Mapa do Brasil por região ───────────────────────────────────────────
// SVG estilizado (não é geografia exata): 5 regiões em posições relativas corretas,
// coloridas pela intensidade (nº de clientes). O número exato fica na legenda ao lado.
interface Regiao {
  key: string
  label: string
  path: string
}
const REGIOES: readonly Regiao[] = [
  { key: 'norte', label: 'Norte', path: 'M10,34 L30,20 L58,18 L60,30 L58,50 L44,58 L22,54 L10,44 Z' },
  { key: 'nordeste', label: 'Nordeste', path: 'M58,18 L78,24 L88,40 L86,56 L70,62 L58,50 L60,30 Z' },
  { key: 'centro_oeste', label: 'Centro-Oeste', path: 'M44,58 L58,50 L70,62 L68,80 L48,84 L38,70 Z' },
  { key: 'sudeste', label: 'Sudeste', path: 'M68,80 L70,62 L86,56 L88,70 L82,86 L70,90 Z' },
  { key: 'sul', label: 'Sul', path: 'M48,84 L68,80 L70,90 L58,102 L46,98 L42,88 Z' },
]

function MapaRegioes({ porRegiao }: { porRegiao: Record<string, number> }) {
  const totalComUf = REGIOES.reduce((s, r) => s + (porRegiao[r.key] ?? 0), 0)
  const semUf = porRegiao.sem_uf ?? 0
  const maxN = Math.max(1, ...REGIOES.map((r) => porRegiao[r.key] ?? 0))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Clientes por região</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6 sm:flex-row sm:items-center">
        <svg viewBox="0 0 100 112" className="w-full max-w-[240px] shrink-0" role="img" aria-label="Mapa de clientes por região">
          {REGIOES.map((r) => {
            const n = porRegiao[r.key] ?? 0
            const op = n === 0 ? 0.08 : 0.25 + 0.75 * (n / maxN)
            return (
              <path
                key={r.key}
                d={r.path}
                className="fill-primary stroke-background"
                style={{ fillOpacity: op }}
                strokeWidth={1.2}
              >
                <title>{`${r.label}: ${n} (${fmtPct(pctDe(n, totalComUf))})`}</title>
              </path>
            )
          })}
        </svg>

        <ul className="flex-1 space-y-1.5 text-sm">
          {[...REGIOES]
            .map((r) => ({ ...r, n: porRegiao[r.key] ?? 0 }))
            .sort((a, b) => b.n - a.n)
            .map((r) => {
              const op = r.n === 0 ? 0.08 : 0.25 + 0.75 * (r.n / maxN)
              return (
                <li key={r.key} className="flex items-center gap-2">
                  <span
                    className="inline-block h-3 w-3 shrink-0 rounded-sm bg-primary"
                    style={{ opacity: op }}
                  />
                  <span className="flex-1">{r.label}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {r.n} · {fmtPct(pctDe(r.n, totalComUf))}
                  </span>
                </li>
              )
            })}
          {semUf > 0 ? (
            <li className="pt-1 text-xs text-muted-foreground">
              {semUf} cliente(s) sem UF (fora do universo Mercado).
            </li>
          ) : null}
        </ul>
      </CardContent>
    </Card>
  )
}

// ─── b) Camadas (mesmo visual do Mercado) ────────────────────────────────────
function CamadasClientes({ porCamada, total }: { porCamada: Record<string, number>; total: number }) {
  const [sel, setSel] = React.useState<Camada | null>('som')
  const soma = CAMADAS.reduce((s, c) => s + (porCamada[c] ?? 0), 0)
  const foraUniverso = total - soma

  const dados: DadosCamada[] = CAMADAS.map((c) => {
    const n = porCamada[c] ?? 0
    return {
      camada: c,
      total: n,
      participacao: pctDe(n, soma),
      metricas: [{ label: 'Clientes', valor: n.toLocaleString('pt-BR') }],
      descricao: CAMADA_DESCRICOES[c],
    }
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Clientes por camada</CardTitle>
      </CardHeader>
      <CardContent>
        <CirculosCamadas
          dados={dados}
          selecionada={sel}
          onSelecionar={setSel}
          dicaVazia="Clique numa camada para ver os clientes dela."
        />
        {foraUniverso > 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {foraUniverso} cliente(s) fora do universo Mercado (sem camada).
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

// ─── c) Capital social (pie) ─────────────────────────────────────────────────
interface Faixa {
  key: string
  label: string
  cor: string
}
// Rampa sequencial (claro→escuro) para valor crescente; cinza para "sem dado".
const FAIXAS_CAPITAL: readonly Faixa[] = [
  { key: 'f1', label: '0 – 500 mil', cor: '#dbeafe' },
  { key: 'f2', label: '500 mil – 2 mi', cor: '#bfdbfe' },
  { key: 'f3', label: '2 – 5 mi', cor: '#93c5fd' },
  { key: 'f4', label: '5 – 10 mi', cor: '#60a5fa' },
  { key: 'f5', label: '10 – 20 mi', cor: '#3b82f6' },
  { key: 'f6', label: '20 – 50 mi', cor: '#2563eb' },
  { key: 'f7', label: '50 – 100 mi', cor: '#1d4ed8' },
  { key: 'f8', label: '100 mi +', cor: '#1e3a8a' },
  { key: 'sem_dado', label: 'Sem dado', cor: '#cbd5e1' },
]

function ponto(cx: number, cy: number, r: number, ang: number) {
  return { x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) }
}
function fatiaPath(cx: number, cy: number, r: number, a0: number, a1: number) {
  const p0 = ponto(cx, cy, r, a0)
  const p1 = ponto(cx, cy, r, a1)
  const grande = a1 - a0 > Math.PI ? 1 : 0
  return `M ${cx} ${cy} L ${p0.x} ${p0.y} A ${r} ${r} 0 ${grande} 1 ${p1.x} ${p1.y} Z`
}

function CapitalPie({ porCapital }: { porCapital: Record<string, number> }) {
  const itens = FAIXAS_CAPITAL.map((f) => ({ ...f, n: porCapital[f.key] ?? 0 }))
  const total = itens.reduce((s, i) => s + i.n, 0)

  // Ângulos acumulados a partir do topo (-90°). Só fatias com valor entram no desenho.
  let ang = -Math.PI / 2
  const fatias = itens
    .filter((i) => i.n > 0)
    .map((i) => {
      const a0 = ang
      const a1 = ang + (i.n / total) * 2 * Math.PI
      ang = a1
      // Um único valor = círculo cheio (o arco de 360° degenera).
      const d =
        i.n === total ? null : fatiaPath(50, 50, 48, a0, a1)
      return { ...i, d }
    })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Clientes por capital social</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6 sm:flex-row sm:items-center">
        {total === 0 ? (
          <p className="text-sm text-muted-foreground">Sem clientes para exibir.</p>
        ) : (
          <>
            <svg viewBox="0 0 100 100" className="w-full max-w-[200px] shrink-0" role="img" aria-label="Distribuição por capital social">
              {fatias.map((f) =>
                f.d === null ? (
                  <circle key={f.key} cx={50} cy={50} r={48} fill={f.cor} />
                ) : (
                  <path key={f.key} d={f.d} fill={f.cor} stroke="var(--background)" strokeWidth={0.5}>
                    <title>{`${f.label}: ${f.n} (${fmtPct(pctDe(f.n, total))})`}</title>
                  </path>
                ),
              )}
            </svg>

            <ul className="flex-1 space-y-1 text-sm">
              {itens.map((f) => (
                <li key={f.key} className="flex items-center gap-2">
                  <span className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: f.cor }} />
                  <span className="flex-1">{f.label}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {f.n} · {fmtPct(pctDe(f.n, total))}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ─── A aba ────────────────────────────────────────────────────────────────────
function SemRadar() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
        <div className="rounded-full bg-muted p-3">
          <Lock className="h-6 w-6 text-muted-foreground" aria-hidden />
        </div>
        <p className="text-sm font-medium">Requer o módulo Radar</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          A análise de clientes Onepay usa dados do Radar. Peça acesso ao módulo para ver os
          gráficos.
        </p>
      </CardContent>
    </Card>
  )
}

/**
 * Aba "Análise" (menu Empresas): retrato dos clientes Onepay em três recortes —
 * região do Brasil, camada do Mercado e faixa de capital social. Do RPC
 * radar_onepay_analytics (gate no Radar; `tem_acesso:false` mostra estado amigável).
 */
export function OnepayAnalyticsTab({ temRadar }: { temRadar: boolean }) {
  const { data, isPending, isError, error } = useQuery<OnepayAnalytics>({
    queryKey: empresasKeys.onepayAnalytics(),
    queryFn: buscarOnepayAnalytics,
    enabled: temRadar,
  })

  if (!temRadar) return <SemRadar />
  if (isPending) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  if (isError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'Não foi possível carregar a análise.'}
          </p>
        </CardContent>
      </Card>
    )
  }
  if (!data.tem_acesso) return <SemRadar />
  if (data.total === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Nenhum cliente Onepay sincronizado ainda.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {data.total.toLocaleString('pt-BR')} cliente(s) Onepay.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <MapaRegioes porRegiao={data.por_regiao} />
        <CamadasClientes porCamada={data.por_camada} total={data.total} />
      </div>
      <CapitalPie porCapital={data.por_capital} />
    </div>
  )
}
