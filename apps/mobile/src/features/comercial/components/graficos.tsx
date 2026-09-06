import { type ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg'
import {
  STATUS_CORES,
  STATUS_ROTULOS,
  STATUS_SEM_DADO,
  paletaCategorica,
  squarify,
  tintaSobre,
  type FatiaComposicao,
} from '@jobsiteos/core'

import { useTheme } from '@/components/color-scheme-provider'
import { Card } from '@/components/ui/card'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

/**
 * Os gráficos do Meu Dia no celular.
 *
 * A REGRA vem do core (`meu-dia-visual`): paleta, cor de status, gradiente da espera e a
 * geometria do treemap são as mesmas da web, byte a byte. Aqui mora só o DESENHO, que é
 * o que muda de plataforma — a web usa recharts, o celular usa `react-native-svg`, que já
 * era dependência do app e não custa bundle novo.
 *
 * Três coisas mudam de propósito em relação à web, e todas pelo mesmo motivo — não existe
 * hover num telefone:
 *
 *   1. Onde a web mostra tooltip, aqui há LEGENDA EM TEXTO. Ela não é enfeite: metade dos
 *      slots categóricos fica abaixo de 3:1 contra o branco, e a regra de alívio do
 *      sistema de dataviz exige rótulo visível. No celular a legenda É o alívio.
 *   2. O toque leva direto para a tela de trabalho, em vez de abrir um detalhe.
 *   3. As fatias e bolhas pequenas ganham alvo de toque maior que a marca, pela legenda.
 *
 * O par `low_operation` (#fab219) × `requires_attention` (#ec835a) fica em ΔE 13,6 de
 * separação para visão normal, abaixo do piso de 15 do método. São cores RESERVADAS do
 * sistema e não se mexem — a mitigação documentada é ícone + rótulo, e é por isso que todo
 * status nesta tela aparece nomeado em texto e nunca só pela cor.
 */

const brl = (n: number) =>
  n >= 1_000_000
    ? `R$ ${(n / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
    : n >= 1000
      ? `R$ ${Math.round(n / 1000).toLocaleString('pt-BR')} mil`
      : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

// ─── A moldura ──────────────────────────────────────────────────────────────

/**
 * O widget: título, um número de contexto, o conteúdo e um rodapé curto.
 *
 * Pouca informação no menor espaço. A rolagem vertical é aceitável — o que não é aceitável
 * é a pessoa ter de ler dez cartões para descobrir onde está o dinheiro.
 */
export function Widget({
  titulo, contexto, descricao, children, rodape,
}: {
  titulo: string
  contexto?: string
  descricao?: string
  children: ReactNode
  rodape?: ReactNode
}) {
  return (
    <Card className="gap-2 p-4">
      <View className="flex-row items-start justify-between gap-2">
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="font-semibold">{titulo}</Text>
          {descricao ? (
            <Text numberOfLines={2} variant="muted" className="text-[11px]">{descricao}</Text>
          ) : null}
        </View>
        {contexto ? <Text className="text-sm font-medium">{contexto}</Text> : null}
      </View>
      {children}
      {rodape ? <View className="pt-0.5">{rodape}</View> : null}
    </Card>
  )
}

// ─── Pizza ──────────────────────────────────────────────────────────────────

const TAU = Math.PI * 2

function fatiaPath(cx: number, cy: number, rExt: number, rInt: number, a0: number, a1: number) {
  const ponto = (ang: number, r: number) => [cx + r * Math.sin(ang), cy - r * Math.cos(ang)] as const
  const [x0, y0] = ponto(a0, rExt)
  const [x1, y1] = ponto(a1, rExt)
  const [xi1, yi1] = ponto(a1, rInt)
  const [xi0, yi0] = ponto(a0, rInt)
  const grande = a1 - a0 > Math.PI ? 1 : 0
  return [
    `M ${x0} ${y0}`,
    `A ${rExt} ${rExt} 0 ${grande} 1 ${x1} ${y1}`,
    `L ${xi1} ${yi1}`,
    `A ${rInt} ${rInt} 0 ${grande} 0 ${xi0} ${yi0}`,
    'Z',
  ].join(' ')
}

/**
 * A composição por cedente — "de quem é o dinheiro que está parado".
 *
 * É outra pergunta que a lista de notas não responde: doze notas do mesmo fornecedor são
 * uma conversa, e não doze. Tocar numa linha da legenda abre as notas daquele fornecedor.
 */
export function PizzaMobile({
  fatias, onFatia, fatiaAtiva, subtitulo,
}: {
  fatias: FatiaComposicao[]
  onFatia?: (nome: string | null) => void
  fatiaAtiva?: string | null
  subtitulo?: string
}) {
  const { scheme } = useTheme()
  const paleta = paletaCategorica(scheme === 'dark')
  const total = fatias.reduce((s, f) => s + f.valor, 0)
  if (total <= 0) return null

  const lado = 132
  const c = lado / 2
  let acumulado = 0

  return (
    <View className="gap-3">
      <View className="items-center">
        <View style={{ width: lado, height: lado }}>
          <Svg width={lado} height={lado} accessibilityLabel="Composição por cedente">
            <G>
              {fatias.map((f, i) => {
                const a0 = acumulado
                const a1 = a0 + (f.valor / total) * TAU
                acumulado = a1
                const apagada = fatiaAtiva && fatiaAtiva !== f.nome
                return (
                  <Path
                    key={f.nome}
                    /* O respiro de 0,02 rad entre fatias é a lacuna de superfície do
                       método: sem ela, duas fatias vizinhas viram uma mancha só. */
                    d={fatiaPath(c, c, c - 2, c * 0.52, a0, Math.max(a1 - 0.02, a0))}
                    fill={paleta[i % paleta.length]}
                    opacity={apagada ? 0.25 : 1}
                  />
                )
              })}
            </G>
          </Svg>
          <View className="absolute inset-0 items-center justify-center">
            <Text className="text-sm font-semibold">{brl(total)}</Text>
            <Text variant="muted" className="text-[10px]">
              {subtitulo ?? `${fatias.length} cedentes`}
            </Text>
          </View>
        </View>
      </View>

      {/* A LEGENDA repete nome e valor em texto: é ela que dispensa o hover que não existe
          e cumpre a regra de alívio das fatias de baixo contraste. */}
      <View className="gap-1.5">
        {fatias.map((f, i) => (
          <Pressable
            key={f.nome}
            onPress={() => onFatia?.(fatiaAtiva === f.nome ? null : f.nome)}
            accessibilityRole="button"
            accessibilityLabel={`${f.nome}, ${brl(f.valor)}`}
            className={cn(
              'flex-row items-center gap-2 py-0.5 active:opacity-60',
              fatiaAtiva && fatiaAtiva !== f.nome && 'opacity-40',
            )}
          >
            <View
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: paleta[i % paleta.length] }}
            />
            <Text numberOfLines={1} className="flex-1 text-xs">{f.nome}</Text>
            <Text className="text-xs font-medium">{brl(f.valor)}</Text>
            <Text variant="muted" className="w-9 text-right text-[11px]">
              {Math.round((f.valor / total) * 100)}%
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

// ─── Bolhas ─────────────────────────────────────────────────────────────────

export interface BolhaMobile {
  id: string
  nome: string
  x: number
  y: number
  tamanho: number
  cor: string
  detalhe: string
}

/**
 * Duas grandezas de uma vez — e o motivo de existir num telefone.
 *
 * Ele mostra o que uma lista ordenada esconde: o item que está no MEIO das duas. Uma lista
 * por limite ocioso põe no topo quem tem muito limite; uma por certificados faltantes, quem
 * tem muitos. Quem tem os dois em quantidade média nunca aparece no topo de nenhuma, e é
 * exatamente ele o maior potencial não atacado.
 *
 * Abaixo do gráfico vão os TRÊS MAIORES nomeados: sem hover, um gráfico de bolhas mudo
 * seria bonito e inútil.
 */
export function BolhasMobile({
  bolhas, rotuloX, rotuloY, formatarX, dominioX, onBolha, largura,
}: {
  bolhas: BolhaMobile[]
  rotuloX: string
  rotuloY: string
  formatarX?: (n: number) => string
  dominioX?: [number, number]
  onBolha?: (id: string) => void
  largura: number
}) {
  const { colors } = useTheme()
  if (bolhas.length === 0) return null

  const altura = 176
  const margem = { top: 10, right: 12, bottom: 26, left: 46 }
  const w = Math.max(largura - margem.left - margem.right, 40)
  const h = altura - margem.top - margem.bottom

  const xs = bolhas.map((b) => b.x)
  const ys = bolhas.map((b) => b.y)
  const x0 = dominioX?.[0] ?? Math.min(...xs, 0)
  const x1 = dominioX?.[1] ?? Math.max(...xs, 1)
  const y1 = Math.max(...ys, 1)
  const tMax = Math.max(...bolhas.map((b) => b.tamanho), 1)

  const px = (v: number) => margem.left + ((v - x0) / Math.max(x1 - x0, 1e-9)) * w
  const py = (v: number) => margem.top + h - (v / y1) * h
  /* Raio pela raiz do tamanho: é a ÁREA que se compara, não o raio. Um raio proporcional
     ao valor faria a conta duas vezes maior parecer quatro vezes maior. */
  const raio = (v: number) => 5 + Math.sqrt(Math.max(v, 0) / tMax) * 17

  const fx = formatarX ?? ((n: number) => String(Math.round(n)))
  const maiores = [...bolhas].sort((a, b) => b.tamanho - a.tamanho).slice(0, 3)

  return (
    <View className="gap-2">
      <Svg width={largura} height={altura} accessibilityLabel={`${rotuloY} por ${rotuloX}`}>
        <Line
          x1={margem.left} y1={margem.top + h} x2={margem.left + w} y2={margem.top + h}
          stroke={colors.border} strokeWidth={1}
        />
        <Line
          x1={margem.left} y1={margem.top} x2={margem.left} y2={margem.top + h}
          stroke={colors.border} strokeWidth={1}
        />
        <SvgText x={margem.left} y={altura - 4} fontSize={9} fill={colors.mutedForeground}>
          {fx(x0)}
        </SvgText>
        <SvgText
          x={margem.left + w} y={altura - 4} fontSize={9} fill={colors.mutedForeground}
          textAnchor="end"
        >
          {`${fx(x1)} · ${rotuloX}`}
        </SvgText>
        <SvgText x={2} y={margem.top + 8} fontSize={9} fill={colors.mutedForeground}>
          {brl(y1)}
        </SvgText>

        {bolhas.map((b) => (
          <Circle
            key={b.id}
            cx={px(b.x)}
            cy={py(b.y)}
            r={raio(b.tamanho)}
            fill={b.cor}
            fillOpacity={0.75}
            /* Anel da superfície: sem ele, duas contas próximas viram uma mancha só. */
            stroke={colors.card}
            strokeWidth={2}
          />
        ))}
      </Svg>

      <View className="gap-1">
        {maiores.map((b) => (
          <Pressable
            key={b.id}
            onPress={() => onBolha?.(b.id)}
            accessibilityRole="button"
            className="flex-row items-center gap-2 active:opacity-60"
          >
            <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: b.cor }} />
            <View className="min-w-0 flex-1">
              <Text numberOfLines={1} className="text-xs">{b.nome}</Text>
              <Text numberOfLines={1} variant="muted" className="text-[11px]">{b.detalhe}</Text>
            </View>
          </Pressable>
        ))}
        {bolhas.length > maiores.length ? (
          <Text variant="muted" className="text-[11px]">
            e mais {bolhas.length - maiores.length} no gráfico
          </Text>
        ) : null}
      </View>
    </View>
  )
}

// ─── Barras ─────────────────────────────────────────────────────────────────

/**
 * O ranking. Barra horizontal porque o rótulo é um nome de empresa — em barra vertical ele
 * vira texto na diagonal, que ninguém lê, e num telefone nem isso.
 *
 * Sem eixo e sem grade: a barra mais longa é a referência e o número está escrito no fim de
 * cada uma. Um eixo aqui seria tinta para uma precisão que a pergunta não pede.
 */
export function BarrasMobile({
  itens, formatar, onItem, maximo,
}: {
  itens: { id: string; nome: string; valor: number; detalhe?: string; cor?: string }[]
  formatar: (n: number) => string
  onItem?: (id: string) => void
  maximo?: number
}) {
  const { colors } = useTheme()
  const maior = maximo ?? Math.max(...itens.map((i) => i.valor), 1)

  return (
    <View className="gap-2">
      {itens.map((i) => (
        <Pressable
          key={i.id}
          onPress={() => onItem?.(i.id)}
          accessibilityRole="button"
          accessibilityLabel={`${i.nome}, ${formatar(i.valor)}`}
          className="gap-1 active:opacity-60"
        >
          <View className="flex-row items-baseline justify-between gap-2">
            <Text numberOfLines={1} className="flex-1 text-xs">{i.nome}</Text>
            <Text className="text-xs font-medium">{formatar(i.valor)}</Text>
          </View>
          <View className="h-1.5 overflow-hidden rounded-full bg-muted">
            <View
              style={{
                width: `${Math.max((i.valor / maior) * 100, 2)}%`,
                height: '100%',
                borderRadius: 999,
                backgroundColor: i.cor ?? colors.primary,
              }}
            />
          </View>
        </Pressable>
      ))}
    </View>
  )
}

// ─── Treemap da carteira ────────────────────────────────────────────────────

export interface ClienteMapa {
  empresa_id: string | null
  cnpj: string
  nome: string
  limite: number
  limite_disponivel: number
  operation_status?: string | null
}

/**
 * O mapa da carteira: área pelo limite, cor pelo temperature report.
 *
 * A cor já foi a ociosidade em dias, que é um proxy; o report é a leitura da plataforma
 * sobre a saúde da conta, e usar o proxy existindo a leitura direta é escolher o pior dos
 * dois.
 *
 * O preço do treemap é a cauda: numa carteira de R$ 18 milhões, o cliente de R$ 150 mil
 * ganha um retângulo pequeno DE VERDADE, e num telefone quase nenhum comporta o nome. A
 * área honesta vale mais que o rótulo em todos — o mapa existe para dizer onde está o
 * limite, e é o retângulo grande que tem de ler grande. Quem precisa da lista nominal tem
 * a legenda de status abaixo e o toque em cada retângulo.
 */
export function TreemapCarteira({
  clientes, largura, altura = 200, onCliente,
}: {
  clientes: ClienteMapa[]
  largura: number
  altura?: number
  onCliente?: (c: ClienteMapa) => void
}) {
  const ordenados = [...clientes].sort((a, b) => b.limite - a.limite)
  const caixas = squarify(ordenados.map((c) => c.limite), largura, altura)

  const porStatus = new Map<string, number>()
  for (const c of ordenados) {
    const s = String(c.operation_status ?? 'operating_normally')
    porStatus.set(s, (porStatus.get(s) ?? 0) + 1)
  }

  return (
    <View className="gap-2">
      <View style={{ width: largura, height: altura }}>
        {ordenados.map((c, i) => {
          const r = caixas[i]
          if (!r || r.w <= 2 || r.h <= 2) return null
          const status = String(c.operation_status ?? 'operating_normally')
          const fundo = STATUS_CORES[status] ?? STATUS_SEM_DADO
          const cabeNome = r.w >= 52 && r.h >= 24
          return (
            <Pressable
              key={c.cnpj}
              onPress={() => onCliente?.(c)}
              accessibilityRole="button"
              accessibilityLabel={`${c.nome}, limite de ${brl(c.limite)}, ${
                STATUS_ROTULOS[status] ?? status
              }`}
              style={{
                position: 'absolute',
                /* O recuo de 1px de cada lado dá os 2px de superfície entre vizinhos —
                   sem ele, dois retângulos do mesmo status viram um só. */
                left: r.x + 1,
                top: r.y + 1,
                width: Math.max(r.w - 2, 0),
                height: Math.max(r.h - 2, 0),
                backgroundColor: fundo,
                borderRadius: 3,
                padding: 3,
                overflow: 'hidden',
                justifyContent: 'flex-end',
              }}
            >
              {cabeNome ? (
                <Text
                  numberOfLines={2}
                  style={{ color: tintaSobre(fundo), fontSize: 9, lineHeight: 11, fontWeight: '500' }}
                >
                  {c.nome}
                </Text>
              ) : null}
            </Pressable>
          )
        })}
      </View>

      {/* Todo status na tela aparece NOMEADO. É a mitigação exigida por duas das quatro
          cores ficarem perto demais uma da outra para visão normal. */}
      <View className="flex-row flex-wrap gap-x-3 gap-y-1">
        {[...porStatus.entries()].map(([s, n]) => (
          <View key={s} className="flex-row items-center gap-1">
            <View
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: STATUS_CORES[s] ?? STATUS_SEM_DADO }}
            />
            <Text variant="muted" className="text-[11px]">
              {STATUS_ROTULOS[s] ?? s} · {n}
            </Text>
          </View>
        ))}
      </View>
    </View>
  )
}
