'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Lock, Receipt, TrendingUp } from 'lucide-react'
import {
  CAMADAS,
  CAMADA_DESCRICOES,
  CAMADA_LABELS,
  formatCnpj,
  proximaExecucao,
  type Camada,
} from '@jobsiteos/core'
import vercel from '../../../vercel.json'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import {
  CirculosCamadas,
  type DadosCamada,
} from '@/components/mercado/camadas/circulos-camadas'
import {
  buscarClientesOnepayFiltrados,
  buscarCustoProtestos,
  buscarOnepayAnalytics,
  buscarProtestosDoCliente,
  empresasKeys,
  type ClienteProtesto,
  type ClienteProtestoRecente,
  type OnepayAnalytics,
} from './queries'
import { GraficoTempoProtestos, extrairProtestos } from './protestos-serie'

const pctDe = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0)
const fmtPct = (p: number) => `${p.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
const brl = (n: number | null) =>
  n == null ? null : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

/** Um recorte clicado num gráfico → a lista de clientes que caem nele. */
export interface Filtro {
  dimensao: 'regiao' | 'camada' | 'capital' | 'faturamento' | 'funcionarios'
  valor: string
  label: string
}

/** Um cliente clicado num ranking de protesto → a evolução no tempo. */
interface AlvoProtesto {
  cnpj: string
  nome: string
}

const fmtData = (iso: string | null) =>
  iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR') : '—'

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

function MapaRegioes({
  porRegiao,
  onAbrir,
}: {
  porRegiao: Record<string, number>
  onAbrir: (f: Filtro) => void
}) {
  const totalComUf = REGIOES.reduce((s, r) => s + (porRegiao[r.key] ?? 0), 0)
  const semUf = porRegiao.sem_uf ?? 0
  const maxN = Math.max(1, ...REGIOES.map((r) => porRegiao[r.key] ?? 0))
  const abrir = (key: string, label: string, n: number) =>
    n > 0 ? onAbrir({ dimensao: 'regiao', valor: key, label: `Região ${label}` }) : undefined

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
                className={`fill-primary stroke-background ${n > 0 ? 'cursor-pointer hover:brightness-110' : ''}`}
                style={{ fillOpacity: op }}
                strokeWidth={1.2}
                onClick={() => abrir(r.key, r.label, n)}
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
                <li key={r.key}>
                  <button
                    type="button"
                    disabled={r.n === 0}
                    onClick={() => abrir(r.key, r.label, r.n)}
                    className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left transition-colors hover:bg-muted/60 disabled:cursor-default disabled:hover:bg-transparent"
                  >
                    <span className="inline-block h-3 w-3 shrink-0 rounded-sm bg-primary" style={{ opacity: op }} />
                    <span className="flex-1">{r.label}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {r.n} · {fmtPct(pctDe(r.n, totalComUf))}
                    </span>
                  </button>
                </li>
              )
            })}
          {semUf > 0 ? (
            <li className="px-1 pt-1 text-xs text-muted-foreground">
              {semUf} cliente(s) sem UF (fora do universo Mercado).
            </li>
          ) : null}
        </ul>
      </CardContent>
    </Card>
  )
}

// ─── b) Camadas (mesmo visual do Mercado) ────────────────────────────────────
function CamadasClientes({
  porCamada,
  total,
  onAbrir,
}: {
  porCamada: Record<string, number>
  total: number
  onAbrir: (f: Filtro) => void
}) {
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
          dicaVazia="Selecione uma camada e clique em “Ver empresas”."
          acao={{
            label: 'Ver empresas',
            onClick: (camada) =>
              onAbrir({ dimensao: 'camada', valor: camada, label: `Camada ${CAMADA_LABELS[camada]}` }),
          }}
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

function CapitalPie({
  porCapital,
  onAbrir,
}: {
  porCapital: Record<string, number>
  onAbrir: (f: Filtro) => void
}) {
  const itens = FAIXAS_CAPITAL.map((f) => ({ ...f, n: porCapital[f.key] ?? 0 }))
  const total = itens.reduce((s, i) => s + i.n, 0)
  const abrir = (key: string, label: string, n: number) =>
    n > 0 ? onAbrir({ dimensao: 'capital', valor: key, label: `Capital ${label}` }) : undefined

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
                  <circle
                    key={f.key}
                    cx={50}
                    cy={50}
                    r={48}
                    fill={f.cor}
                    className="cursor-pointer hover:brightness-110"
                    onClick={() => abrir(f.key, f.label, f.n)}
                  />
                ) : (
                  <path
                    key={f.key}
                    d={f.d}
                    fill={f.cor}
                    stroke="var(--background)"
                    strokeWidth={0.5}
                    className="cursor-pointer hover:brightness-110"
                    onClick={() => abrir(f.key, f.label, f.n)}
                  >
                    <title>{`${f.label}: ${f.n} (${fmtPct(pctDe(f.n, total))})`}</title>
                  </path>
                ),
              )}
            </svg>

            <ul className="flex-1 space-y-1 text-sm">
              {itens.map((f) => (
                <li key={f.key}>
                  <button
                    type="button"
                    disabled={f.n === 0}
                    onClick={() => abrir(f.key, f.label, f.n)}
                    className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left transition-colors hover:bg-muted/60 disabled:cursor-default disabled:hover:bg-transparent"
                  >
                    <span className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: f.cor }} />
                    <span className="flex-1">{f.label}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {f.n} · {fmtPct(pctDe(f.n, total))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  )
}


// ─── d) Faturamento e funcionários (barras horizontais) ──────────────────────
// Barra, e não pizza: aqui a ordem das faixas é a informação (elas são uma ESCALA,
// não categorias soltas), e pizza embaralha grandeza com ângulo. O capital social
// continua em pizza porque já estava — trocar os dois de uma vez seria mexer no que
// ninguém pediu.

interface FaixaBarra {
  key: string
  label: string
}

const FAIXAS_FATURAMENTO: readonly FaixaBarra[] = [
  { key: 'f1', label: 'até 4,8 mi' },
  { key: 'f2', label: '4,8 – 20 mi' },
  { key: 'f3', label: '20 – 50 mi' },
  { key: 'f4', label: '50 – 100 mi' },
  { key: 'f5', label: '100 – 300 mi' },
  { key: 'f6', label: '300 mi +' },
  { key: 'sem_dado', label: 'Sem estimativa' },
]

const FAIXAS_FUNCIONARIOS: readonly FaixaBarra[] = [
  { key: 'f1', label: 'até 9' },
  { key: 'f2', label: '10 – 49' },
  { key: 'f3', label: '50 – 99' },
  { key: 'f4', label: '100 – 249' },
  { key: 'f5', label: '250 +' },
  { key: 'sem_dado', label: 'Sem dado' },
]

function BarrasPorFaixa({
  titulo,
  nota,
  faixas,
  dados,
  dimensao,
  prefixoLabel,
  onAbrir,
}: {
  titulo: string
  nota?: string
  faixas: readonly FaixaBarra[]
  dados: Record<string, number>
  dimensao: Filtro['dimensao']
  prefixoLabel: string
  onAbrir: (f: Filtro) => void
}) {
  const itens = faixas.map((f) => ({ ...f, n: dados[f.key] ?? 0 }))
  const total = itens.reduce((s, i) => s + i.n, 0)
  const max = Math.max(1, ...itens.map((i) => i.n))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{titulo}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {total === 0 ? (
          <p className="text-sm text-muted-foreground">Sem clientes para exibir.</p>
        ) : (
          <>
            {itens.map((f) => (
              <button
                key={f.key}
                type="button"
                disabled={f.n === 0}
                onClick={() =>
                  onAbrir({ dimensao, valor: f.key, label: `${prefixoLabel} ${f.label}` })
                }
                className="block w-full rounded px-1 py-1 text-left transition-colors hover:bg-muted/60 disabled:cursor-default disabled:hover:bg-transparent"
              >
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className={f.key === 'sem_dado' ? 'text-muted-foreground' : ''}>{f.label}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {f.n} · {fmtPct(pctDe(f.n, total))}
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${f.key === 'sem_dado' ? 'bg-muted-foreground/40' : 'bg-primary'}`}
                    style={{ width: `${(f.n / max) * 100}%` }}
                  />
                </div>
              </button>
            ))}
            {nota ? <p className="pt-1 text-xs text-muted-foreground">{nota}</p> : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ─── e) Protesto: dois rankings ──────────────────────────────────────────────
// ─── O preço de descobrir tudo isso ─────────────────────────────────────────

const PATH_CRON_PROTESTOS = '/api/cron/radar-protestos-clientes'

/**
 * Quanto custa a rodada mensal de protestos, antes de ela acontecer.
 *
 * Todo o resto desta aba é retrato do que já sabemos; este card é o único que fala do
 * que vai ser gasto para saber. A consulta é paga por CNPJ, o lote roda sozinho no
 * dia 5 (é política, não decisão de alguém), e até agora o número só aparecia depois,
 * no extrato — que é tarde para a única reação possível, que é pôr crédito antes.
 *
 * A agenda vem do `vercel.json`, o mesmo arquivo que a Vercel executa. Uma data
 * digitada aqui teria dois donos e mostraria com confiança um dia em que nada roda.
 */
function CustoDoCron() {
  const { data } = useQuery({
    queryKey: empresasKeys.custoProtestos(),
    queryFn: buscarCustoProtestos,
  })

  const proxima = React.useMemo(() => {
    const cron = vercel.crons.find((c) => c.path === PATH_CRON_PROTESTOS)
    return cron ? proximaExecucao(cron.schedule, new Date()) : null
  }, [])

  if (!data || !data.tem_acesso) return null

  const pctTeto =
    data.teto_mensal && data.teto_mensal > 0 ? (data.custo_total / data.teto_mensal) * 100 : null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Receipt className="h-4 w-4" aria-hidden />
          Custo da rodada mensal de protestos
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <div>
            <p className="text-2xl font-semibold tabular-nums">{brl(data.custo_total)}</p>
            <p className="text-xs text-muted-foreground">
              {/* Com centavos: o unitário é R$ 3,50, e arredondar viraria "R$ 4". */}
              {data.consultas.toLocaleString('pt-BR')} consulta(s) ×{' '}
              {data.custo_unitario.toLocaleString('pt-BR', {
                style: 'currency',
                currency: 'BRL',
              })}
            </p>
          </div>
          <dl className="grid gap-1 text-sm">
            <div className="flex items-baseline gap-2">
              <dt className="text-muted-foreground">Clientes Onepay</dt>
              <dd className="tabular-nums">{data.clientes.toLocaleString('pt-BR')}</dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="text-muted-foreground">SPEs afiançadas (fora da carteira)</dt>
              <dd className="tabular-nums">{data.monitoradas.toLocaleString('pt-BR')}</dd>
            </div>
          </dl>
        </div>

        <p className="text-xs text-muted-foreground">
          Cada cliente e cada SPE marcada como afiançada é <strong>uma consulta paga</strong>, pelo
          provedor nacional. Uma SPE que também é cliente conta uma vez só.
          {proxima ? <> Próxima rodada em {proxima.toLocaleDateString('pt-BR')}.</> : null}{' '}
          {pctTeto === null ? null : (
            <>
              É {fmtPct(Math.round(pctTeto * 10) / 10)} do teto mensal do Radar (
              {brl(data.teto_mensal)}), que cobre todo o resto do enriquecimento também.
            </>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          Quem tem perfil de Crédito recebe este valor no último dia do mês — cinco dias antes
          da rodada, que é o tempo de pôr crédito na plataforma se faltar.
        </p>
      </CardContent>
    </Card>
  )
}

// Ranking, e não faixa: a pergunta aqui não é "como se distribuem" e sim "quais são
// os piores". E o valor é o do GRUPO — cliente que opera por SPE tem o protesto na
// SPE, não na matriz, e somar só o CNPJ dele mostraria zero justamente em quem tem
// risco espalhado.

function RankingProtestoGrupo({
  itens,
  onAbrir,
}: {
  itens: ClienteProtesto[]
  onAbrir: (a: AlvoProtesto) => void
}) {
  const max = Math.max(1, ...itens.map((i) => i.valor))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Clientes por protesto do grupo</CardTitle>
      </CardHeader>
      <CardContent>
        {itens.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum cliente com protesto.</p>
        ) : (
          <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {itens.map((c) => {
              const nome = c.nome ?? formatCnpj(c.cnpj)
              const meta = [
                c.qtd > 0 ? `${c.qtd} protesto(s)` : null,
                c.tem_grupo && c.empresas_com_protesto > 1
                  ? `${c.empresas_com_protesto} empresas do grupo`
                  : null,
                // Só quando há: a maioria dos clientes não tem SPE afiançada, e um
                // "0 SPEs" em toda linha seria ruído com cara de informação.
                c.spes_monitoradas > 0
                  ? `${c.spes_monitoradas} SPE(s) monitorada(s)` +
                    // Matriz e filial da mesma SPE entram as duas na marcação, e a
                    // consulta é por estabelecimento — quem paga a conta é o CNPJ.
                    (c.cnpjs_monitorados > c.spes_monitoradas
                      ? ` em ${c.cnpjs_monitorados} CNPJs`
                      : '')
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')

              return (
                <button
                  key={c.cnpj}
                  type="button"
                  onClick={() => onAbrir({ cnpj: c.cnpj, nome })}
                  className="block w-full rounded px-1 py-1 text-left transition-colors hover:bg-muted/60"
                >
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate">{nome}</span>
                    <span className="shrink-0 tabular-nums font-medium">{brl(c.valor)}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-destructive"
                      style={{ width: `${(c.valor / max) * 100}%` }}
                    />
                  </div>
                  {meta ? <p className="mt-0.5 text-xs text-muted-foreground">{meta}</p> : null}
                </button>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ProtestosRecentes({
  itens,
  onAbrir,
}: {
  itens: ClienteProtestoRecente[]
  onAbrir: (a: AlvoProtesto) => void
}) {
  const max = Math.max(1, ...itens.map((i) => i.qtd))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="h-4 w-4 text-destructive" aria-hidden />
          Protestos nos últimos 12 meses
        </CardTitle>
      </CardHeader>
      <CardContent>
        {itens.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum protesto datado no período.</p>
        ) : (
          <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {itens.map((c) => {
              const nome = c.nome ?? formatCnpj(c.cnpj)
              return (
                <button
                  key={c.cnpj}
                  type="button"
                  onClick={() => onAbrir({ cnpj: c.cnpj, nome })}
                  className="block w-full rounded px-1 py-1 text-left transition-colors hover:bg-muted/60"
                >
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate">{nome}</span>
                    <span className="shrink-0 tabular-nums font-medium">{c.qtd}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-destructive/70"
                      style={{ width: `${(c.qtd / max) * 100}%` }}
                    />
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {brl(c.valor)} · último em {fmtData(c.ultimo)}
                  </p>
                </button>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** A evolução no tempo do grupo do cliente — o MESMO gráfico da ficha da empresa. */
function ProtestoEvolucaoDialog({
  alvo,
  onOpenChange,
}: {
  alvo: AlvoProtesto | null
  onOpenChange: (aberto: boolean) => void
}) {
  const aberto = alvo !== null
  const q = useQuery({
    queryKey: empresasKeys.onepayProtestosCliente(alvo?.cnpj ?? ''),
    queryFn: () => buscarProtestosDoCliente(alvo!.cnpj),
    enabled: aberto,
  })

  const protestos = React.useMemo(
    () => (q.data ?? []).flatMap((e) => extrairProtestos(e.cartorios, e.nome)),
    [q.data],
  )
  const total = protestos.reduce((s, p) => s + p.valor, 0)

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{alvo?.nome ?? ''}</DialogTitle>
          <DialogDescription>
            Valor protestado por mês, somando as empresas do grupo.
          </DialogDescription>
        </DialogHeader>
        {q.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : protestos.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Sem detalhe de protesto para desenhar a série.
          </p>
        ) : (
          <div className="space-y-3">
            <GraficoTempoProtestos protestos={protestos} />
            <p className="text-xs text-muted-foreground">
              {protestos.length} protesto(s) · {brl(total)} no total
              {(q.data ?? []).length > 1 ? ` · ${(q.data ?? []).length} empresas do grupo` : ''}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
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

/** Lista de clientes de um recorte clicado num gráfico. */
function ClientesFiltradosDialog({
  filtro,
  onOpenChange,
}: {
  filtro: Filtro | null
  onOpenChange: (aberto: boolean) => void
}) {
  const aberto = filtro !== null
  const q = useQuery({
    queryKey: empresasKeys.onepayClientesFiltrados(filtro?.dimensao ?? '', filtro?.valor ?? ''),
    queryFn: () => buscarClientesOnepayFiltrados(filtro!.dimensao, filtro!.valor),
    enabled: aberto,
  })

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{filtro?.label ?? ''}</DialogTitle>
          <DialogDescription>Clientes Onepay neste recorte.</DialogDescription>
        </DialogHeader>
        {q.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : (q.data ?? []).length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nenhum cliente.</p>
        ) : (
          <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
            {(q.data ?? []).map((c) => {
              const nome = c.nome ?? formatCnpj(c.cnpj)
              const meta = [c.uf, c.camada ? CAMADA_LABELS[c.camada as Camada] : null, brl(c.capital_social)]
                .filter(Boolean)
                .join(' · ')
              return (
                <li key={c.cnpj} className="rounded-md border border-border p-2">
                  <div className="flex items-center justify-between gap-2">
                    {c.empresa_id ? (
                      <Link href={`/empresas/${c.empresa_id}`} className="text-sm font-medium hover:underline">
                        {nome}
                      </Link>
                    ) : (
                      <span className="text-sm font-medium">{nome}</span>
                    )}
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {formatCnpj(c.cnpj)}
                    </span>
                  </div>
                  {meta ? <p className="mt-0.5 text-xs text-muted-foreground">{meta}</p> : null}
                </li>
              )
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Aba "Análise" (menu Empresas): retrato dos clientes Onepay em três recortes —
 * região do Brasil, camada do Mercado e faixa de capital social. Do RPC
 * radar_onepay_analytics (gate no Radar; `tem_acesso:false` mostra estado amigável).
 * Clicar em qualquer segmento abre a lista de clientes daquele recorte.
 */
export function OnepayAnalyticsTab({ temRadar }: { temRadar: boolean }) {
  const [filtro, setFiltro] = React.useState<Filtro | null>(null)
  const [alvoProtesto, setAlvoProtesto] = React.useState<AlvoProtesto | null>(null)
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
        {data.total.toLocaleString('pt-BR')} cliente(s) Onepay. Clique num segmento para ver as
        empresas, ou num cliente dos rankings de protesto para ver a evolução no tempo.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <MapaRegioes porRegiao={data.por_regiao} onAbrir={setFiltro} />
        <CamadasClientes porCamada={data.por_camada} total={data.total} onAbrir={setFiltro} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <BarrasPorFaixa
          titulo="Clientes por faturamento"
          nota="Faturamento estimado pelo Radar, ou declarado quando o cliente informou."
          faixas={FAIXAS_FATURAMENTO}
          dados={data.por_faturamento}
          dimensao="faturamento"
          prefixoLabel="Faturamento"
          onAbrir={setFiltro}
        />
        <BarrasPorFaixa
          titulo="Clientes por número de funcionários"
          nota="Contagem do Apollo, que indexa perfis públicos e subconta mão de obra de canteiro."
          faixas={FAIXAS_FUNCIONARIOS}
          dados={data.por_funcionarios}
          dimensao="funcionarios"
          prefixoLabel="Funcionários"
          onAbrir={setFiltro}
        />
      </div>

      <CapitalPie porCapital={data.por_capital} onAbrir={setFiltro} />

      {/* Antes dos rankings de protesto: é o preço de mantê-los atualizados. */}
      <CustoDoCron />

      <div className="grid gap-4 lg:grid-cols-2">
        <RankingProtestoGrupo itens={data.protestos_grupo} onAbrir={setAlvoProtesto} />
        <ProtestosRecentes itens={data.protestos_recentes} onAbrir={setAlvoProtesto} />
      </div>

      <ProtestoEvolucaoDialog
        alvo={alvoProtesto}
        onOpenChange={(aberto) => {
          if (!aberto) setAlvoProtesto(null)
        }}
      />

      <ClientesFiltradosDialog
        filtro={filtro}
        onOpenChange={(aberto) => {
          if (!aberto) setFiltro(null)
        }}
      />
    </div>
  )
}
