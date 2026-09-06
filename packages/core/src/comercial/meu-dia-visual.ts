/**
 * A camada visual do Meu Dia, sem React e sem plataforma.
 *
 * A web desenha com SVG do recharts e o celular com `react-native-svg`; as duas desenham
 * a MESMA coisa. Cor de status, paleta categórica, o gradiente da espera e a geometria do
 * treemap são regra, não desenho — e regra duplicada é regra que diverge. O caso concreto:
 * se o vermelho de `inoperative` for um hex aqui e outro lá, a mesma conta é "parada" numa
 * tela e "atenção" na outra, e ninguém percebe até alguém comparar as duas telas lado a
 * lado.
 *
 * PALETA VALIDADA, não escolhida no olho. São os slots categóricos do sistema de dataviz,
 * rodados no validador para as quatro superfícies em que este código desenha (web claro e
 * escuro, celular claro e escuro). A pior separação de par adjacente sob simulação de
 * daltonismo fica em ΔE 9,1 / 8,4 na web e 9,1 / 8,5 no celular — acima do piso de 8.
 */

// ─── Status do temperature report ───────────────────────────────────────────

/**
 * Cores RESERVADAS. Elas nunca viram "série 4": um status que se parece com uma categoria
 * faz a pessoa ler saúde de conta onde só há um item de lista. E nunca aparecem sozinhas —
 * sempre com o rótulo ao lado, porque duas delas ficam abaixo de 3:1 na superfície clara.
 */
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

/** O cinza de "esta conta não tem cadastro na plataforma" — ausência, não status. */
export const STATUS_SEM_DADO = '#94a3b8'

// ─── Paleta categórica ──────────────────────────────────────────────────────

export const CATEGORICA_CLARO = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300']
export const CATEGORICA_ESCURO = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300']

export const paletaCategorica = (escuro: boolean): string[] =>
  escuro ? CATEGORICA_ESCURO : CATEGORICA_CLARO

// ─── A cor da espera ────────────────────────────────────────────────────────

/**
 * Azul às 0h, vermelho às 96h.
 *
 * É codificação REDUNDANTE de propósito — o eixo já diz quantas horas passaram, e a cor
 * repete. É o que torna legítimo usar dois tons numa grandeza que só cresce: ela não
 * separa categorias, ela grita.
 */
export function corPorEspera(horas: number, limite = 96): string {
  const t = Math.min(Math.max(horas / limite, 0), 1)
  const de = [42, 120, 214]
  const para = [208, 59, 59]
  const c = de.map((v, i) => Math.round(v + (para[i]! - v) * t))
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}

// ─── A tinta que fica legível sobre uma cor ─────────────────────────────────

/**
 * As quatro cores de status são reservadas e não se mexem; o que se escolhe é o texto por
 * cima. Branco sobre o amarelo de `low_operation` (#fab219) dá 1,7:1, ilegível; preto
 * sobre o vermelho de `inoperative` também não serve. A luminância decide.
 */
export function tintaSobre(fundo: string): string {
  const hex = fundo.replace('#', '')
  if (hex.length < 6) return '#0b0b0b'
  const canal = (i: number) => {
    const v = parseInt(hex.slice(i * 2, i * 2 + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const l = 0.2126 * canal(0) + 0.7152 * canal(1) + 0.0722 * canal(2)
  return l > 0.42 ? '#0b0b0b' : '#ffffff'
}

// ─── Treemap ────────────────────────────────────────────────────────────────

export interface Retangulo {
  x: number
  y: number
  w: number
  h: number
}

/**
 * O algoritmo squarify (Bruls, Huizing & van Wijk, 2000).
 *
 * A alternativa era uma fileira de quadrados com quebra de linha, cada um com o lado
 * proporcional à raiz do valor. Ficava bonito e deixava um rio de espaço vazio à direita —
 * e o vazio ENTRAVA na leitura: a última linha meio cheia parecia dizer alguma coisa sobre
 * as contas dela. No treemap a área é a fração do valor e a soma das áreas é o componente
 * inteiro; não há espaço morto para interpretar.
 *
 * Squarify existe para que os retângulos saiam perto do quadrado em vez de tiras finas —
 * uma tira de 4px de largura tem área correta e é ilegível.
 *
 * A entrada precisa vir em ordem DECRESCENTE: é isso que dá ao algoritmo a chance de
 * fechar cada faixa antes que a proporção piore.
 */
export function squarify(valores: readonly number[], largura: number, altura: number): Retangulo[] {
  const vazio = valores.map(() => ({ x: 0, y: 0, w: 0, h: 0 }))
  if (largura <= 0 || altura <= 0 || valores.length === 0) return vazio

  /* Um piso por item: quem tem limite zero ainda é um cliente, e um retângulo de área zero
     o apagaria do mapa sem dizer que ele existe. */
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

// ─── Composição por chave ───────────────────────────────────────────────────

export interface FatiaComposicao {
  nome: string
  valor: number
}

/**
 * Cinco fatias e "Outros".
 *
 * Além disso a legenda deixa de caber e as fatias finas viram uma faixa de cor que
 * ninguém distingue — e no celular esse limite chega antes ainda.
 */
export function composicaoPorChave(
  itens: readonly { meta: Record<string, unknown>; titulo: string; valor: number | null }[],
  chave: string,
  topo = 5,
): FatiaComposicao[] {
  const acc = new Map<string, number>()
  for (const i of itens) {
    const k = String(i.meta[chave] ?? i.titulo)
    acc.set(k, (acc.get(k) ?? 0) + (i.valor ?? 0))
  }
  const ord = [...acc.entries()].sort((a, b) => b[1] - a[1])
  const cabeca = ord.slice(0, topo).map(([nome, valor]) => ({ nome, valor }))
  const resto = ord.slice(topo).reduce((s, [, v]) => s + v, 0)
  return resto > 0 ? [...cabeca, { nome: 'Outros', valor: resto }] : cabeca
}
