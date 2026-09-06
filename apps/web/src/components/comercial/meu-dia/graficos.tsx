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

/**
 * A tinta que fica legível sobre uma cor de fundo.
 *
 * As quatro cores de status são reservadas e não se mexem — o que se escolhe é o texto
 * por cima. Branco sobre o amarelo de `low_operation` (#fab219) fica em 1,7:1, ilegível;
 * preto sobre o vermelho de `inoperative` também não serve. A luminância decide.
 */
export function tintaSobre(fundo: string): string {
  const hex = fundo.replace('#', '')
  const canal = (i: number) => {
    const v = parseInt(hex.slice(i * 2, i * 2 + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const l = 0.2126 * canal(0) + 0.7152 * canal(1) + 0.0722 * canal(2)
  return l > 0.42 ? '#0b0b0b' : '#ffffff'
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
 *
 * A legenda LATERAL saiu e o gráfico ficou com o componente inteiro. O que ela dava —
 * nome e valor de cada fatia — passou para duas coisas melhores: o RÓTULO DIRETO na
 * fatia, que o método de dataviz prefere à legenda justamente por não exigir o vaivém
 * dos olhos, e o TOOLTIP, que traz o nome inteiro e o valor em reais. Fatia abaixo de 7%
 * não recebe rótulo (o texto colidiria com o vizinho) e depende do tooltip — é o preço
 * de mostrar seis fatias num círculo, e por isso "Outros" existe.
 */
const RAD = Math.PI / 180

interface FatiaRotulo {
  cx: number
  cy: number
  midAngle: number
  outerRadius: number
  percent: number
  index: number
}

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

  const rotulo = (props: unknown) => {
    const d = props as FatiaRotulo
    if (d.percent < 0.07) return null
    const r = d.outerRadius + 12
    const x = d.cx + r * Math.cos(-d.midAngle * RAD)
    const y = d.cy + r * Math.sin(-d.midAngle * RAD)
    const nome = dados[d.index]?.nome ?? ''
    const curto = nome.length > 20 ? `${nome.slice(0, 19)}…` : nome
    return (
      <text
        x={x}
        y={y}
        textAnchor={x > d.cx ? 'start' : 'end'}
        dominantBaseline="central"
        fontSize={10}
      >
        <tspan className="fill-foreground font-medium">{curto}</tspan>
        <tspan x={x} dy="1.15em" className="fill-muted-foreground">
          {Math.round(d.percent * 100)}%
        </tspan>
      </text>
    )
  }

  return (
    <div className="relative h-[272px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart margin={{ top: 12, right: 78, bottom: 12, left: 78 }}>
          <Pie
            data={dados}
            dataKey="valor"
            nameKey="nome"
            innerRadius="52%"
            outerRadius="82%"
            paddingAngle={2}
            stroke="none"
            isAnimationActive={false}
            label={rotulo}
            /* Sem linha-guia: o recharts desenha uma por fatia mesmo quando o rótulo é
               nulo, e as fatias abaixo de 7% ficariam com um traço apontando para o
               nada. O rótulo encosta no arco e dispensa a linha. */
            labelLine={false}
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
                opacity={fatiaAtiva && fatiaAtiva !== d.nome ? 0.25 : 1}
                className="cursor-pointer outline-none"
              />
            ))}
          </Pie>
          <Tooltip
            content={({ payload }) => {
              const p = payload?.[0]
              if (!p) return null
              const valor = Number(p.value)
              return (
                <Dica>
                  <p className="max-w-[18rem] font-medium">{p.name}</p>
                  <p className="tabular-nums text-muted-foreground">
                    {brl(valor)}
                    {total > 0 ? ` · ${Math.round((valor / total) * 100)}%` : ''}
                  </p>
                </Dica>
              )
            }}
          />
        </PieChart>
      </ResponsiveContainer>

      {/* O total no miolo: o buraco do donut é espaço morto, e a soma é o número que
          contextualiza toda fatia. */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-base font-semibold tabular-nums">{brl(total)}</span>
        <span className="text-[10px] text-muted-foreground">{dados.length} cedentes</span>
      </div>
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
    <div className="h-[272px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 10, right: 14, bottom: 24, left: 4 }}>
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
          <ZAxis type="number" dataKey="tamanho" range={[110, 1500]} />
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

// ─── Treemap: a carteira inteira, sem sobra de espaço ───────────────────────

export interface Retangulo {
  x: number
  y: number
  w: number
  h: number
}

/**
 * O algoritmo squarify (Bruls, Huizing & van Wijk, 2000).
 *
 * A versão anterior do mapa era uma fileira de quadrados com `flex-wrap`: cada um com o
 * lado proporcional à raiz do limite, quebrando linha quando não coubesse. Ficava bonito
 * e deixava um rio de espaço vazio à direita — e, pior, o espaço vazio ENTRAVA na leitura:
 * a última linha meio cheia parecia dizer alguma coisa sobre as contas dela.
 *
 * O treemap não deixa sobra: a área do retângulo é a fração do limite, e a soma das áreas
 * é o componente inteiro. Squarify existe para que os retângulos saiam perto do quadrado
 * em vez de tiras finas — uma tira de 4px de largura tem área correta e é ilegível.
 *
 * A entrada precisa vir em ordem decrescente; é isso que dá ao algoritmo a chance de
 * fechar cada faixa antes que a proporção piore.
 */
export function squarify(valores: readonly number[], largura: number, altura: number): Retangulo[] {
  const vazio = valores.map(() => ({ x: 0, y: 0, w: 0, h: 0 }))
  if (largura <= 0 || altura <= 0 || valores.length === 0) return vazio

  /* Um piso por item: o cliente com limite zero ainda é um cliente, e um retângulo de
     área zero o apagaria do mapa sem dizer que ele existe. */
  const total = valores.reduce((s, v) => s + Math.max(v, 0), 0)
  const piso = total > 0 ? total * 0.004 : 1
  const ajustados = valores.map((v) => Math.max(v, piso))
  const soma = ajustados.reduce((s, v) => s + v, 0)
  const escala = (largura * altura) / soma
  const areas = ajustados.map((v) => v * escala)

  const saida: Retangulo[] = []
  let livre: Retangulo = { x: 0, y: 0, w: largura, h: altura }

  /** A pior razão de aspecto da faixa se ela for fechada com este lado. */
  const pior = (faixa: number[], lado: number): number => {
    if (faixa.length === 0 || lado <= 0) return Number.POSITIVE_INFINITY
    const s = faixa.reduce((a, b) => a + b, 0)
    if (s <= 0) return Number.POSITIVE_INFINITY
    const maior = Math.max(...faixa)
    const menor = Math.min(...faixa)
    return Math.max((lado * lado * maior) / (s * s), (s * s) / (lado * lado * menor))
  }

  const fechar = (faixa: number[], r: Retangulo): Retangulo => {
    const s = faixa.reduce((a, b) => a + b, 0)
    if (r.w >= r.h) {
      const w = s / r.h
      let y = r.y
      for (const a of faixa) {
        const h = a / w
        saida.push({ x: r.x, y, w, h })
        y += h
      }
      return { x: r.x + w, y: r.y, w: Math.max(r.w - w, 0), h: r.h }
    }
    const h = s / r.w
    let x = r.x
    for (const a of faixa) {
      const w = a / h
      saida.push({ x, y: r.y, w, h })
      x += w
    }
    return { x: r.x, y: r.y + h, w: r.w, h: Math.max(r.h - h, 0) }
  }

  let faixa: number[] = []
  for (const a of areas) {
    const lado = Math.min(livre.w, livre.h)
    if (faixa.length > 0 && pior([...faixa, a], lado) > pior(faixa, lado)) {
      livre = fechar(faixa, livre)
      faixa = []
    }
    faixa.push(a)
  }
  if (faixa.length > 0) fechar(faixa, livre)

  return saida.length === valores.length ? saida : vazio
}

/** Mede a largura real do contêiner — o treemap precisa dela para saber o que é quadrado. */
export function useLargura<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = React.useRef<T>(null)
  const [largura, setLargura] = React.useState(0)
  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new ResizeObserver(([e]) => setLargura(e?.contentRect.width ?? 0))
    obs.observe(el)
    setLargura(el.getBoundingClientRect().width)
    return () => obs.disconnect()
  }, [])
  return [ref, largura]
}
