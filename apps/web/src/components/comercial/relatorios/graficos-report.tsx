'use client'

import * as React from 'react'
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'
import {
  STATUS_CORES, brlCurto, paletaCategorica, type ETAPAS_FUNIL,
} from '@jobsiteos/core'
import { cn } from '@/lib/utils'

/**
 * Os gráficos da aba Relatórios.
 *
 * A aba mostra os MESMOS números do PDF, e a diferença é o que cada superfície consegue
 * fazer: no papel, uma tabela; na tela, a forma — e o clique. O PDF diz "conversão de 9,7%
 * na faixa alta contra 47% em doze meses"; aqui as duas barras ficam lado a lado e a
 * distância é a informação.
 *
 * A paleta é a mesma do Meu Dia, importada do core: os slots categóricos validados, com o
 * pior par adjacente em ΔE 9,1 (claro) e 8,4 (escuro) sob simulação de daltonismo.
 */

function usePaleta(): string[] {
  const [escuro, setEscuro] = React.useState(false)
  React.useEffect(() => {
    const raiz = document.documentElement
    const ler = () =>
      setEscuro(
        raiz.dataset.theme === 'dark' ||
          (raiz.dataset.theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches),
      )
    ler()
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', ler)
    const obs = new MutationObserver(ler)
    obs.observe(raiz, { attributes: true, attributeFilter: ['data-theme', 'class'] })
    return () => {
      mq.removeEventListener('change', ler)
      obs.disconnect()
    }
  }, [])
  return paletaCategorica(escuro)
}

function Dica({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md">
      {children}
    </div>
  )
}

// ─── Série de 12 meses ──────────────────────────────────────────────────────

export interface PontoSerie {
  competencia: string
  volume: number
  vop: number
  receita: number
}

/**
 * A série de doze meses, com a SEMANA marcada.
 *
 * Três linhas num eixo só — e é legítimo aqui porque as três são reais na mesma unidade.
 * Um segundo eixo para a receita (que é duas ordens de grandeza menor) é o erro clássico
 * de dashboard: duas escalas fazem qualquer par de curvas parecer correlacionado.
 *
 * A receita fica visível assim mesmo porque o que se lê nela é a FORMA, não o nível — e
 * o valor exato está no tooltip e nos KPIs.
 */
export function SerieDoAno({ pontos }: { pontos: PontoSerie[] }) {
  const paleta = usePaleta()
  if (pontos.length === 0) return null

  return (
    <div className="h-[220px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={pontos} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
          <XAxis
            dataKey="competencia"
            tick={{ fontSize: 10 }}
            stroke="currentColor"
            className="text-muted-foreground"
            tickFormatter={(v: string) => mesCurto(v)}
          />
          <YAxis
            tick={{ fontSize: 10 }}
            width={54}
            stroke="currentColor"
            className="text-muted-foreground"
            tickFormatter={(v: number) => brlCurto(v)}
          />
          <Tooltip
            content={({ payload, label }) =>
              payload && payload.length > 0 ? (
                <Dica>
                  <p className="font-medium">{mesCurto(String(label))}</p>
                  {payload.map((p) => (
                    <p key={String(p.dataKey)} className="tabular-nums text-muted-foreground">
                      {ROTULO_SERIE[String(p.dataKey)] ?? String(p.dataKey)}: {brlCurto(Number(p.value))}
                    </p>
                  ))}
                </Dica>
              ) : null
            }
          />
          <Legend
            wrapperStyle={{ fontSize: 11 }}
            formatter={(v: string) => ROTULO_SERIE[v] ?? v}
          />
          <Line type="monotone" dataKey="volume" stroke={paleta[0]} strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="vop" stroke={paleta[1]} strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="receita" stroke={paleta[2]} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

const ROTULO_SERIE: Record<string, string> = {
  volume: 'Volume convertido',
  vop: 'VOP operado',
  receita: 'Receita',
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const mesCurto = (iso: string) => {
  const [a, m] = iso.split('-')
  return `${MESES[Number(m) - 1] ?? m}/${a?.slice(2) ?? ''}`
}

// ─── Funil em etapas ────────────────────────────────────────────────────────

export function FunilEtapas({
  etapas, onEtapa,
}: {
  etapas: { id: string; label: string; valor: number; passagem: number | null }[]
  onEtapa?: (id: string) => void
}) {
  const maior = Math.max(...etapas.map((e) => e.valor), 1)
  return (
    <div className="flex items-end gap-1.5">
      {etapas.map((e) => (
        <button
          key={e.id}
          type="button"
          onClick={() => onEtapa?.(e.id)}
          className="flex-1 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex h-[70px] items-end">
            <div
              className="w-full rounded-t bg-primary transition-all"
              /* Etapa zerada não ganha barra: um traço de 2px na base parece linha de
                 grade, e uma fileira deles faz o funil parecer quebrado em vez de vazio. */
              style={{ height: e.valor > 0 ? `${Math.max((e.valor / maior) * 100, 6)}%` : 0 }}
            />
          </div>
          <p className="mt-1 text-base font-semibold tabular-nums">{e.valor}</p>
          <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
            {e.label}
          </p>
          {e.passagem !== null ? (
            <p className="text-[10px] text-muted-foreground">
              {e.passagem.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
            </p>
          ) : null}
        </button>
      ))}
    </div>
  )
}

// ─── Conversão por faixa, contra a média ────────────────────────────────────

/**
 * Duas barras por faixa: a semana e os doze meses.
 *
 * É onde a tela ganha do papel. No PDF são duas colunas de números e o leitor faz a conta;
 * aqui a diferença entre as duas barras É a notícia, e ela aparece antes de qualquer
 * leitura.
 */
export function ConversaoPorFaixa({
  faixas, onFaixa,
}: {
  faixas: { faixa: string; semana: number | null; doze: number | null; entradas: number }[]
  onFaixa?: (faixa: string) => void
}) {
  const paleta = usePaleta()
  const dados = faixas.map((f) => ({
    faixa: FAIXA_LABEL[f.faixa] ?? f.faixa,
    chave: f.faixa,
    semana: f.semana ?? 0,
    doze: f.doze ?? 0,
    entradas: f.entradas,
  }))

  return (
    <div className="h-[200px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={dados} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
          <XAxis dataKey="faixa" tick={{ fontSize: 10 }} stroke="currentColor" className="text-muted-foreground" />
          <YAxis
            tick={{ fontSize: 10 }}
            width={36}
            stroke="currentColor"
            className="text-muted-foreground"
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip
            cursor={{ className: 'fill-muted/40' }}
            content={({ payload }) => {
              const d = payload?.[0]?.payload as { faixa: string; semana: number; doze: number; entradas: number } | undefined
              return d ? (
                <Dica>
                  <p className="font-medium">{d.faixa}</p>
                  <p className="tabular-nums text-muted-foreground">
                    Semana: {d.semana}% · 12 meses: {d.doze}%
                  </p>
                  <p className="text-muted-foreground">{d.entradas} entradas na semana</p>
                </Dica>
              ) : null
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v: string) => (v === 'semana' ? 'Semana' : '12 meses')} />
          <Bar
            dataKey="semana"
            fill={paleta[0]}
            radius={[3, 3, 0, 0]}
            onClick={(d) => onFaixa?.((d as unknown as { chave?: string }).chave ?? '')}
            className={onFaixa ? 'cursor-pointer' : undefined}
          />
          <Bar dataKey="doze" fill={paleta[3]} radius={[3, 3, 0, 0]} fillOpacity={0.55} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

const FAIXA_LABEL: Record<string, string> = {
  alta: 'Alta', boa: 'Boa', media: 'Média', sem_faixa: 'Sem faixa',
}

// ─── Limite ocioso por gestor ───────────────────────────────────────────────

export function OciosoPorGestor({
  clientes, onGestor,
}: {
  clientes: { gestor: string | null; ocioso: number }[]
  onGestor?: (gestor: string) => void
}) {
  const paleta = usePaleta()
  const porGestor = new Map<string, number>()
  for (const c of clientes) {
    const g = c.gestor ?? 'Sem gestor'
    porGestor.set(g, (porGestor.get(g) ?? 0) + c.ocioso)
  }
  const dados = [...porGestor.entries()]
    .map(([gestor, ocioso]) => ({ gestor, ocioso }))
    .sort((a, b) => b.ocioso - a.ocioso)

  if (dados.length === 0) return null

  return (
    <div style={{ height: Math.max(dados.length * 34 + 20, 90) }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={dados} layout="vertical" margin={{ top: 4, right: 60, bottom: 4, left: 4 }}>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="gestor"
            width={110}
            tick={{ fontSize: 11 }}
            stroke="currentColor"
            className="text-muted-foreground"
          />
          <Tooltip
            cursor={{ className: 'fill-muted/40' }}
            content={({ payload }) => {
              const d = payload?.[0]?.payload as { gestor: string; ocioso: number } | undefined
              return d ? (
                <Dica>
                  <p className="font-medium">{d.gestor}</p>
                  <p className="tabular-nums text-muted-foreground">{brlCurto(d.ocioso)} parados</p>
                </Dica>
              ) : null
            }}
          />
          <Bar
            dataKey="ocioso"
            radius={[0, 3, 3, 0]}
            onClick={(d) => onGestor?.((d as unknown as { gestor?: string }).gestor ?? '')}
            className={onGestor ? 'cursor-pointer' : undefined}
          >
            {dados.map((d) => (
              /* "Sem gestor" em cinza: é ausência de dono, não mais um dono. Pintá-lo com
                 uma cor de série o faria parecer uma pessoa na lista. */
              <Cell key={d.gestor} fill={d.gestor === 'Sem gestor' ? '#94a3b8' : paleta[0]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Cobertura de certificados ──────────────────────────────────────────────

export function BarraCobertura({
  cobertos, vencendo, sem, total,
}: {
  cobertos: number
  vencendo: number
  sem: number
  total: number
}) {
  const t = Math.max(total, 1)
  const seg = [
    { rotulo: 'Válidos', n: cobertos - vencendo, cor: STATUS_CORES.operating_normally! },
    { rotulo: 'Vencendo em 30 dias', n: vencendo, cor: STATUS_CORES.low_operation! },
    { rotulo: 'Sem certificado', n: sem, cor: '#e4e4e7' },
  ].filter((s) => s.n > 0)

  return (
    <div className="space-y-2">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
        {seg.map((s) => (
          <div key={s.rotulo} style={{ width: `${(s.n / t) * 100}%`, backgroundColor: s.cor }} />
        ))}
      </div>
      {/* A legenda repete o NÚMERO em texto: a faixa cinza de "sem certificado" fica
          abaixo de 3:1 contra o fundo, e a regra de alívio do método exige o rótulo. */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        {seg.map((s) => (
          <span key={s.rotulo} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: s.cor }} aria-hidden />
            {s.rotulo} · <span className="tabular-nums text-foreground">{s.n.toLocaleString('pt-BR')}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

// ─── Ranking do time ────────────────────────────────────────────────────────

export function RankingTime({
  vendedores, onVendedor,
}: {
  vendedores: { vendedor_id: string; nome: string; tipo: string; vop: number; comissao: number; conversoes: number }[]
  onVendedor?: (id: string) => void
}) {
  const maior = Math.max(...vendedores.map((v) => v.vop), 1)
  return (
    <ul className="space-y-2">
      {vendedores.map((v) => (
        <li key={v.vendedor_id}>
          <button
            type="button"
            onClick={() => onVendedor?.(v.vendedor_id)}
            className="group w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-xs group-hover:underline">
                {v.nome} <span className="text-muted-foreground">· {v.tipo}</span>
              </span>
              <span className="shrink-0 text-xs font-medium tabular-nums">{brlCurto(v.vop)}</span>
            </div>
            <div className="mt-0.5 h-1.5 rounded-full bg-muted">
              <div
                className={cn('h-full rounded-full bg-primary')}
                style={{ width: `${Math.max((v.vop / maior) * 100, 2)}%` }}
              />
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {v.conversoes} conversões · {brlCurto(v.comissao)} de comissão
            </p>
          </button>
        </li>
      ))}
    </ul>
  )
}

export type EtapaId = (typeof ETAPAS_FUNIL)[number]
