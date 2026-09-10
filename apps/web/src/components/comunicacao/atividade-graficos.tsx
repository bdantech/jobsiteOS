'use client'

import * as React from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/**
 * Os dois desenhos do painel de atividade: a série por período e o mapa de calor
 * por hora. Sem biblioteca de gráfico, como o resto do repo (ver `GraficoBarras`
 * do Mercado) — o que estes dois precisam é de escala compartilhada e de um
 * tooltip, e nenhuma das duas coisas justifica 40 kB no bundle.
 *
 * ─── ERA EMPILHADO, VIROU UMA LINHA POR PESSOA ──────────────────────────────
 * O desenho anterior era de barras empilhadas: a altura da coluna era o dia do
 * TIME e cada faixa uma pessoa. Ele respondia bem "quanto o time fez hoje" e mal
 * "como o Fabio vem se comportando" — seguir alguém exigia comparar a espessura
 * de uma faixa que muda de posição conforme os outros sobem e descem.
 *
 * A linha inverte a prioridade: cada pessoa tem uma trajetória própria, contínua,
 * na cor dela. O total do time, que a coluna dava de graça, passa a viver no
 * tooltip — onde ele continua a uma passada de mouse de distância.
 */

export interface PontoPeriodo {
  /** Início do balde: o dia, a segunda-feira da semana ou o dia 1º do mês. */
  periodo: string
  vendedor_id: string
  vendedor_nome: string
  is_ia: boolean
  empresas: number
  mensagens: number
  enviadas: number
  recebidas: number
}

export type Granularidade = 'dia' | 'semana' | 'mes'

export interface PontoHora {
  vendedor_id: string
  vendedor_nome: string
  is_ia: boolean
  hora: number
  total: number
}

/**
 * A cor é derivada do NOME, com a mesma função do inbox: a mesma pessoa tem a
 * mesma cor nos dois gráficos, na legenda e na lista de conversas. Cor por
 * posição na lista mudaria a cada filtro, e a legenda deixaria de ser memorizável.
 *
 * `traco` existe porque SVG não lê `bg-*`: a linha e o ponto pintam com
 * `currentColor`, e é o `text-*` no grupo que decide qual cor é essa.
 */
const PALETA = [
  { barra: 'bg-sky-500', ponto: 'bg-sky-500', traco: 'text-sky-500' },
  { barra: 'bg-emerald-500', ponto: 'bg-emerald-500', traco: 'text-emerald-500' },
  { barra: 'bg-amber-500', ponto: 'bg-amber-500', traco: 'text-amber-500' },
  { barra: 'bg-violet-500', ponto: 'bg-violet-500', traco: 'text-violet-500' },
  { barra: 'bg-rose-500', ponto: 'bg-rose-500', traco: 'text-rose-500' },
  { barra: 'bg-teal-500', ponto: 'bg-teal-500', traco: 'text-teal-500' },
] as const

export function corDoVendedor(nome: string): (typeof PALETA)[number] {
  let soma = 0
  for (let i = 0; i < nome.length; i++) soma = (soma + nome.charCodeAt(i)) % 997
  return PALETA[soma % PALETA.length]!
}

const emData = (iso: string) => new Date(`${iso}T12:00:00`)

/** O rótulo do eixo: curto, porque ele se repete uma vez por ponto. */
function rotuloEixo(iso: string, g: Granularidade): string {
  const d = emData(iso)
  if (g === 'mes') return d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

/**
 * O rótulo do tooltip, por extenso. "07/09" sozinho num gráfico semanal não diz
 * se é o começo ou o fim da semana — e a diferença muda a leitura do número.
 */
function rotuloCheio(iso: string, g: Granularidade): string {
  const d = emData(iso)
  if (g === 'mes') return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  if (g === 'semana') {
    const fim = new Date(d.getTime() + 6 * 86_400_000)
    return `Semana de ${rotuloEixo(iso, 'dia')} a ${fim.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`
  }
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// ─── A série por período ────────────────────────────────────────────────────

/*
 * Geometria em constantes e não espalhada pelo JSX: a linha, o ponto, a área de
 * captura do mouse e o tooltip precisam concordar sobre onde fica cada x, e três
 * cópias do mesmo cálculo é como um deles fica meio pixel fora e ninguém acha.
 */
const ALTURA = 180
const TOPO = 10
const GUTTER = 36
const PASSO_MIN = 46

export function GraficoPorPeriodo({
  pontos,
  metrica,
  granularidade,
  direcao,
}: {
  pontos: PontoPeriodo[]
  /** O que a linha mede. Empresas por padrão; mensagens quando se quer volume. */
  metrica: 'empresas' | 'mensagens'
  granularidade: Granularidade
  /** O filtro de direção em vigor — decide o que o tooltip pode afirmar. */
  direcao: 'todas' | 'saida' | 'entrada'
}) {
  const [foco, setFoco] = React.useState<number | null>(null)

  const { periodos, porPeriodo, vendedores, maximo } = React.useMemo(() => {
    const mapa = new Map<string, PontoPeriodo[]>()
    const nomes = new Map<string, string>()
    for (const p of pontos) {
      mapa.set(p.periodo, [...(mapa.get(p.periodo) ?? []), p])
      nomes.set(p.vendedor_id, p.vendedor_nome)
    }
    const chaves = [...mapa.keys()].sort((a, b) => a.localeCompare(b))
    // A escala é do MAIOR PONTO de uma pessoa, e não da soma do time: numa linha
    // por pessoa, escalar pelo total deixaria todas as trajetórias achatadas no
    // rodapé do gráfico.
    const max = pontos.reduce((maior, p) => Math.max(maior, p[metrica]), 0)
    return {
      periodos: chaves,
      porPeriodo: mapa,
      vendedores: [...nomes.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR')),
      maximo: max,
    }
  }, [pontos, metrica])

  if (periodos.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        Nenhuma atividade no período.
      </p>
    )
  }

  const passo = Math.max(PASSO_MIN, Math.min(96, Math.round(720 / periodos.length)))
  const largura = GUTTER + periodos.length * passo
  const x = (i: number) => GUTTER + i * passo + passo / 2
  const y = (v: number) => TOPO + (1 - (maximo > 0 ? v / maximo : 0)) * (ALTURA - TOPO)

  const linhaDoFoco = foco !== null ? periodos[foco] : null
  const doFoco = linhaDoFoco ? (porPeriodo.get(linhaDoFoco) ?? []) : []

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 text-xs">
        {vendedores.map(([id, nome]) => (
          <span key={id} className="flex items-center gap-1.5">
            <span className={cn('h-2.5 w-2.5 rounded-sm', corDoVendedor(nome).ponto)} aria-hidden />
            {nome}
          </span>
        ))}
      </div>

      {/*
        Rola no eixo x: 90 pontos não cabem numa tela, e comprimir até caber
        transforma o gráfico numa mancha. O contêiner rola; a página não.
      */}
      <div className="overflow-x-auto pb-1">
        <div className="relative" style={{ width: `${largura}px`, minWidth: '100%' }}>
          <svg
            viewBox={`0 0 ${largura} ${ALTURA + 20}`}
            width={largura}
            height={ALTURA + 20}
            role="img"
            aria-label={`${metrica === 'empresas' ? 'Empresas' : 'Mensagens'} por ${granularidade}, uma linha por pessoa`}
            onMouseLeave={() => setFoco(null)}
          >
            {/* Três referências horizontais. Sem elas, uma linha sem eixo vira desenho. */}
            <g className="text-muted-foreground">
              {[0, 0.5, 1].map((f) => (
                <g key={f}>
                  <line
                    x1={GUTTER}
                    x2={largura}
                    y1={y(maximo * f)}
                    y2={y(maximo * f)}
                    stroke="currentColor"
                    strokeOpacity={0.18}
                    strokeDasharray={f === 0 ? undefined : '3 3'}
                  />
                  <text
                    x={GUTTER - 6}
                    y={y(maximo * f) + 3}
                    textAnchor="end"
                    fill="currentColor"
                    className="text-[9px] tabular-nums"
                  >
                    {Math.round(maximo * f)}
                  </text>
                </g>
              ))}
            </g>

            {/* A guia vertical do ponto em foco, atrás das linhas. */}
            {foco !== null ? (
              <line
                x1={x(foco)}
                x2={x(foco)}
                y1={TOPO}
                y2={ALTURA}
                className="text-foreground"
                stroke="currentColor"
                strokeOpacity={0.25}
              />
            ) : null}

            {vendedores.map(([id, nome]) => {
              /*
               * PERÍODO SEM LINHA DA PESSOA É ZERO, e não um buraco. O banco só
               * devolve linha quando houve atividade; sem completar com zero, a
               * trajetória saltaria por cima do dia parado como se ele não
               * existisse — que é exatamente o dia que se quer enxergar.
               */
              const serie = periodos.map((per, i) => {
                const achado = (porPeriodo.get(per) ?? []).find((p) => p.vendedor_id === id)
                return { i, v: achado ? achado[metrica] : 0 }
              })
              const cor = corDoVendedor(nome)
              return (
                <g key={id} className={cor.traco}>
                  <polyline
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    points={serie.map((s) => `${x(s.i)},${y(s.v)}`).join(' ')}
                  />
                  {serie.map((s) => (
                    <circle
                      key={s.i}
                      cx={x(s.i)}
                      cy={y(s.v)}
                      r={foco === s.i ? 4.5 : 2.5}
                      fill="currentColor"
                    />
                  ))}
                </g>
              )
            })}

            {/*
              A captura do mouse é uma faixa por período, e não o círculo: acertar
              um alvo de 2,5 px com o ponteiro é o tipo de tooltip que ninguém
              consegue abrir. A faixa inteira do período responde.
            */}
            {periodos.map((per, i) => (
              <rect
                key={per}
                x={GUTTER + i * passo}
                y={0}
                width={passo}
                height={ALTURA}
                fill="transparent"
                onMouseEnter={() => setFoco(i)}
              />
            ))}

            <g className="text-muted-foreground">
              {periodos.map((per, i) => (
                <text
                  key={per}
                  x={x(i)}
                  y={ALTURA + 14}
                  textAnchor="middle"
                  fill="currentColor"
                  className="text-[9px]"
                >
                  {rotuloEixo(per, granularidade)}
                </text>
              ))}
            </g>
          </svg>

          {linhaDoFoco && foco !== null ? (
            <div
              className="pointer-events-none absolute z-10 w-56 rounded-md border bg-popover p-2 text-xs shadow-md"
              style={{
                // Preso às bordas do desenho: perto do fim da série, um balão
                // centrado no ponto sairia pela direita e ficaria ilegível.
                left: `${Math.min(Math.max(x(foco) - 112, 0), Math.max(largura - 224, 0))}px`,
                top: '4px',
              }}
            >
              <p className="mb-1 font-medium text-foreground">
                {rotuloCheio(linhaDoFoco, granularidade)}
              </p>
              <ul className="space-y-0.5">
                {[...doFoco]
                  .sort((a, b) => b[metrica] - a[metrica])
                  .map((p) => (
                    <li key={p.vendedor_id} className="flex items-start gap-1.5">
                      <span
                        className={cn(
                          'mt-1 h-2 w-2 shrink-0 rounded-sm',
                          corDoVendedor(p.vendedor_nome).ponto,
                        )}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-foreground">{p.vendedor_nome}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {metrica === 'empresas'
                            ? `${p.empresas} ${p.empresas === 1 ? 'empresa' : 'empresas'}`
                            : direcao === 'todas'
                              ? `${p.enviadas} enviadas · ${p.recebidas} recebidas`
                              : `${p.mensagens} ${direcao === 'saida' ? 'enviadas' : 'recebidas'}`}
                        </span>
                      </span>
                    </li>
                  ))}
              </ul>
              {/* O total do time — o que a barra empilhada mostrava sem pedir. */}
              <p className="mt-1 border-t pt-1 tabular-nums text-muted-foreground">
                Time: {doFoco.reduce((s, p) => s + p[metrica], 0)}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {maximo === 0
          ? 'Nenhum registro no período.'
          : 'Passe o mouse sobre o gráfico para ver o detalhe do ponto. A escala é do maior valor individual — as linhas são comparáveis entre si.'}
      </p>
    </div>
  )
}

// ─── Mapa de calor por hora ─────────────────────────────────────────────────

const HORAS = Array.from({ length: 24 }, (_, i) => i)

/**
 * Uma linha por pessoa, 24 colunas, intensidade = volume.
 *
 * A escala é do MAIOR VALOR DA GRADE inteira, e não de cada linha: com escala por
 * linha, quem mandou 3 mensagens no dia inteiro fica tão "quente" quanto quem
 * mandou 300, e o mapa passa a comparar cada um consigo mesmo — que é justamente
 * o que um mapa de equipe não deve fazer.
 */
export function MapaDeCalorPorHora({ pontos }: { pontos: PontoHora[] }) {
  const { linhas, maximo } = React.useMemo(() => {
    const porVendedor = new Map<string, { nome: string; horas: Map<number, number> }>()
    let max = 0
    for (const p of pontos) {
      const atual = porVendedor.get(p.vendedor_id) ?? { nome: p.vendedor_nome, horas: new Map() }
      atual.horas.set(p.hora, (atual.horas.get(p.hora) ?? 0) + p.total)
      porVendedor.set(p.vendedor_id, atual)
      max = Math.max(max, atual.horas.get(p.hora)!)
    }
    return {
      linhas: [...porVendedor.entries()].sort((a, b) =>
        a[1].nome.localeCompare(b[1].nome, 'pt-BR'),
      ),
      maximo: max,
    }
  }, [pontos])

  if (linhas.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        Nenhuma atividade no período.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <div className="min-w-[42rem] space-y-1">
          <div className="flex items-center gap-1 pl-32">
            {HORAS.map((h) => (
              <span
                key={h}
                className="flex-1 text-center text-[9px] tabular-nums text-muted-foreground"
              >
                {/* De duas em duas: 24 rótulos de dois dígitos não cabem sem virar ruído. */}
                {h % 2 === 0 ? String(h).padStart(2, '0') : ''}
              </span>
            ))}
          </div>
          {linhas.map(([id, l]) => (
            <div key={id} className="flex items-center gap-1">
              <span className="w-32 shrink-0 truncate text-xs" title={l.nome}>
                {l.nome}
              </span>
              {HORAS.map((h) => {
                const n = l.horas.get(h) ?? 0
                const intensidade = maximo > 0 ? n / maximo : 0
                return (
                  <span
                    key={h}
                    title={`${l.nome} — ${String(h).padStart(2, '0')}h: ${n} ${n === 1 ? 'mensagem' : 'mensagens'}`}
                    className={cn(
                      'h-6 flex-1 rounded-sm',
                      n === 0 ? 'bg-muted' : corDoVendedor(l.nome).barra,
                    )}
                    style={
                      n === 0
                        ? undefined
                        : // Opacidade e não seis tons de classe: a rampa precisa ser
                          // contínua para que 5 e 6 mensagens não caiam no mesmo balde,
                          // e o piso de 0,15 mantém a célula de 1 mensagem visível.
                          { opacity: 0.15 + intensidade * 0.85 }
                    }
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Horário de São Paulo. A intensidade é comparável entre as linhas — a célula mais forte é o
        pico da equipe no período, não o de cada pessoa.
      </p>
    </div>
  )
}

export function CartaoGrafico({
  titulo,
  descricao,
  children,
}: {
  titulo: string
  descricao: string
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{titulo}</CardTitle>
        <CardDescription>{descricao}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}
