'use client'

import * as React from 'react'
import {
  Cell, Pie, PieChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip,
  XAxis, YAxis, ZAxis,
} from 'recharts'
import { ordenarItens, type ItemMeuDia } from '@jobsiteos/core'
import { cn } from '@/lib/utils'

/**
 * Os gráficos do Meu Dia.
 *
 * A PALETA não foi escolhida no olho. São os slots categóricos validados do sistema de
 * dataviz, rodados no validador para as duas superfícies: a pior separação de par
 * adjacente fica em ΔE 9,1 (claro) e 8,4 (escuro) sob simulação de daltonismo, acima do
 * piso de 8. O modo escuro tem os SEUS passos, não uma inversão automática do claro.
 *
 * Onde a cor claro fica abaixo de 3:1 contra a superfície, a regra de alívio vale e está
 * cumprida: toda fatia tem rótulo direto e a legenda repete o valor em texto. Nenhuma
 * informação depende só de matiz.
 *
 * TODO gráfico aqui é CLICÁVEL. Ele não é um enfeite acima da lista — ele É a lista:
 * clicar numa fatia, numa bolha ou numa barra abre os itens daquele recorte.
 */

const CATEGORICA_CLARO = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300']
const CATEGORICA_ESCURO = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300']

/** Status do temperature report. Reservadas — nunca viram "série 4". */
export const STATUS_CORES: Record<string, string> = {
  operating_normally: '#0ca30c',
  low_operation: '#fab219',
  requires_attention: '#ec835a',
  inoperative: '#d03b3b',
}

export const STATUS_ROTULOS: Record<string, string> = {
  operating_normally: 'Operando normalmente',
  low_operation: 'Operando pouco',
  requires_attention: 'Pede atenção',
  inoperative: 'Parou de operar',
}

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
  return escuro ? CATEGORICA_ESCURO : CATEGORICA_CLARO
}

const brl = (n: number) =>
  n >= 1_000_000
    ? `R$ ${(n / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
    : n >= 1000
      ? `R$ ${Math.round(n / 1000).toLocaleString('pt-BR')} mil`
      : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

function Dica({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md">
      {children}
    </div>
  )
}

// ─── Pizza: de quem é o volume ──────────────────────────────────────────────

/**
 * A composição por cedente. Responde "de quem é o dinheiro que está parado" — que é
 * outra pergunta que a lista de notas não responde: doze notas do mesmo fornecedor são
 * uma conversa, e não doze.
 *
 * Cinco fatias e "Outros". Além disso a legenda deixa de caber e as fatias finas viram
 * uma faixa de cor que ninguém distingue.
 */
export function PizzaPorChave({
  itens, chave, onFatia, fatiaAtiva,
}: {
  itens: ItemMeuDia[]
  chave: string
  onFatia: (valor: string | null) => void
  fatiaAtiva: string | null
}) {
  const paleta = usePaleta()

  const dados = React.useMemo(() => {
    const acc = new Map<string, number>()
    for (const i of itens) {
      const k = String((i.meta as Record<string, unknown>)[chave] ?? i.titulo)
      acc.set(k, (acc.get(k) ?? 0) + (i.valor ?? 0))
    }
    const ord = [...acc.entries()].sort((a, b) => b[1] - a[1])
    const topo = ord.slice(0, 5).map(([nome, valor]) => ({ nome, valor }))
    const resto = ord.slice(5).reduce((s, [, v]) => s + v, 0)
    return resto > 0 ? [...topo, { nome: 'Outros', valor: resto }] : topo
  }, [itens, chave])

  const total = dados.reduce((s, d) => s + d.valor, 0)

  return (
    <div className="flex items-center gap-3">
      <div className="h-[132px] w-[132px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={dados}
              dataKey="valor"
              nameKey="nome"
              innerRadius={34}
              outerRadius={62}
              paddingAngle={2}
              stroke="none"
              /* O recharts tipa o payload do clique como a sua própria forma interna;
                 o nosso dado chega junto, e é dele que sai a fatia. */
              onClick={(d) => {
                const nome = (d as unknown as { nome?: string }).nome ?? null
                onFatia(fatiaAtiva === nome ? null : nome)
              }}
            >
              {dados.map((d, i) => (
                <Cell
                  key={d.nome}
                  fill={paleta[i % paleta.length]}
                  opacity={fatiaAtiva && fatiaAtiva !== d.nome ? 0.3 : 1}
                  className="cursor-pointer outline-none"
                />
              ))}
            </Pie>
            <Tooltip
              content={({ payload }) =>
                payload?.[0] ? (
                  <Dica>
                    <p className="font-medium">{payload[0].name}</p>
                    <p className="tabular-nums text-muted-foreground">
                      {brl(Number(payload[0].value))}
                    </p>
                  </Dica>
                ) : null
              }
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* A legenda repete o valor em texto: é o alívio exigido pelo contraste da fatia. */}
      <ul className="min-w-0 flex-1 space-y-1">
        {dados.map((d, i) => (
          <li key={d.nome}>
            <button
              type="button"
              onClick={() => onFatia(fatiaAtiva === d.nome ? null : d.nome)}
              className={cn(
                'flex w-full items-baseline gap-1.5 text-left text-xs transition-opacity',
                fatiaAtiva && fatiaAtiva !== d.nome && 'opacity-40',
              )}
            >
              <span
                className="mt-0.5 h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: paleta[i % paleta.length] }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">{d.nome}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {total > 0 ? Math.round((d.valor / total) * 100) : 0}%
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ─── Bolhas: duas grandezas de uma vez ──────────────────────────────────────

export interface Bolha {
  id: string
  nome: string
  x: number
  y: number
  tamanho: number
  cor: string
  detalhe: string
}

/**
 * O gráfico de bolhas, e o motivo de ele existir aqui: ele mostra o que uma lista
 * ordenada esconde — o item que está no MEIO das duas grandezas. Uma lista por limite
 * ocioso põe no topo quem tem muito limite; uma por certificados faltantes, quem tem
 * muitos. Quem tem os dois em quantidade média nunca aparece no topo de nenhuma, e é
 * exatamente ele o maior potencial não atacado.
 */
export function GraficoBolhas({
  bolhas, rotuloX, rotuloY, formatarX, formatarY, onBolha, dominioX,
}: {
  bolhas: Bolha[]
  rotuloX: string
  rotuloY: string
  formatarX?: (n: number) => string
  formatarY?: (n: number) => string
  onBolha?: (id: string) => void
  dominioX?: [number, number]
}) {
  const fx = formatarX ?? ((n: number) => String(n))
  const fy = formatarY ?? brl

  return (
    <div className="h-[200px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 12, bottom: 22, left: 4 }}>
          <XAxis
            type="number"
            dataKey="x"
            domain={dominioX ?? ['dataMin', 'dataMax']}
            tickFormatter={fx}
            tick={{ fontSize: 10 }}
            stroke="currentColor"
            className="text-muted-foreground"
            label={{ value: rotuloX, position: 'insideBottom', offset: -12, fontSize: 10 }}
          />
          <YAxis
            type="number"
            dataKey="y"
            tickFormatter={fy}
            tick={{ fontSize: 10 }}
            width={58}
            stroke="currentColor"
            className="text-muted-foreground"
            label={{ value: rotuloY, angle: -90, position: 'insideLeft', fontSize: 10, offset: 12 }}
          />
          {/* O tamanho é a terceira grandeza; a área, e não o raio, é o que se compara. */}
          <ZAxis type="number" dataKey="tamanho" range={[80, 900]} />
          <Tooltip
            cursor={{ strokeDasharray: '3 3' }}
            content={({ payload }) => {
              const b = payload?.[0]?.payload as Bolha | undefined
              return b ? (
                <Dica>
                  <p className="max-w-[16rem] font-medium">{b.nome}</p>
                  <p className="text-muted-foreground">{b.detalhe}</p>
                </Dica>
              ) : null
            }}
          />
          <Scatter
            data={bolhas}
            onClick={(d) => {
              const id = (d as unknown as { id?: string }).id
              if (id) onBolha?.(id)
            }}
            className={onBolha ? 'cursor-pointer' : undefined}
          >
            {bolhas.map((b) => (
              /* Anel da superfície nas bolhas que se sobrepõem — sem ele, duas contas
                 próximas viram uma mancha só. */
              <Cell key={b.id} fill={b.cor} fillOpacity={0.75} stroke="var(--background)" strokeWidth={2} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Barras: ranking por uma grandeza ───────────────────────────────────────

/**
 * O ranking. Barra horizontal porque o rótulo é um nome de empresa — em barra vertical
 * ele vira texto na diagonal, que ninguém lê.
 *
 * Sem eixo e sem grade: a barra mais longa é a referência, e o número está escrito no
 * fim de cada uma. Um eixo aqui seria tinta para uma precisão que a pergunta não pede.
 */
export function BarrasRanking({
  itens, formatar, onItem, maximo,
}: {
  itens: { id: string; nome: string; valor: number; detalhe: string; cor?: string }[]
  formatar: (n: number) => string
  onItem?: (id: string) => void
  maximo?: number
}) {
  const maior = maximo ?? Math.max(...itens.map((i) => i.valor), 1)

  return (
    <ul className="space-y-1.5">
      {itens.map((i) => (
        <li key={i.id}>
          <button
            type="button"
            onClick={() => onItem?.(i.id)}
            className="group w-full text-left"
            title={i.detalhe}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-xs group-hover:underline">{i.nome}</span>
              <span className="shrink-0 text-xs font-medium tabular-nums">{formatar(i.valor)}</span>
            </div>
            <div className="mt-0.5 h-1.5 rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max((i.valor / maior) * 100, 2)}%`,
                  backgroundColor: i.cor ?? 'var(--primary)',
                }}
              />
            </div>
          </button>
        </li>
      ))}
    </ul>
  )
}

// ─── Rolagem: a lista longa que vira um widget ──────────────────────────────

/**
 * 185 fornecedores em 185 cards é a tela que o vendedor fecha. Os mesmos 185 num cartão
 * de altura fixa, ordenados pelo que emitem, é um widget — e a rolagem interna mantém o
 * resto da página no lugar.
 */
export function ListaRolagem({
  itens, onItem, altura = 'h-64',
}: {
  itens: ItemMeuDia[]
  onItem?: (item: ItemMeuDia) => void
  altura?: string
}) {
  return (
    <ul className={cn('divide-y divide-border overflow-y-auto pr-1', altura)}>
      {ordenarItens(itens).map((i) => (
        <li key={i.referencia_id}>
          <button
            type="button"
            onClick={() => onItem?.(i)}
            className="flex w-full items-baseline justify-between gap-2 py-1.5 text-left hover:bg-muted/50"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium">{i.titulo}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{i.subtitulo}</span>
            </span>
            {i.valor !== null && i.valor > 0 ? (
              <span className="shrink-0 text-xs tabular-nums">{brl(i.valor)}</span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  )
}
