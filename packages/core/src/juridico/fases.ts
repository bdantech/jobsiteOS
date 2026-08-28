import { ordemDaFase, type BenchmarkFases, type Fase } from './schemas.js'

/**
 * Classificador de fases (08 §5): que fase do processo uma movimentação marca.
 *
 * ── DETERMINÍSTICO, E NÃO UM MODELO ─────────────────────────────────────────
 * O cronograma da ação alimenta um badge vermelho, uma notificação ao advogado e um
 * evento. Um classificador probabilístico que acerta 90% das vezes produz, numa base de
 * trezentos processos, trinta cronogramas errados por rodada — e ninguém tem como saber
 * QUAIS. Palavra-chave erra também, mas erra de um jeito auditável: dá para abrir a
 * regra, ver a expressão que casou e corrigi-la. É por isso que a tabela de regras é
 * EDITÁVEL e vive em `juridico_config.classificador`, e não neste arquivo — este arquivo
 * é o motor, não a lista.
 *
 * ── A REGRA QUE GOVERNA TUDO: FASE SÓ ANDA PARA A FRENTE ────────────────────
 * `processos.fase_atual` é a fase MAIS AVANÇADA já detectada, não a última. Uma
 * publicação de "juntada de petição" depois da penhora não devolve o processo para a
 * instrução — e é exatamente isso que aconteceria se o classificador simplesmente
 * gravasse o resultado da movimentação mais recente. O cronograma mede tempo DECORRIDO
 * por fase; um retrocesso reiniciaria o relógio e apagaria a lentidão que ele existe
 * para mostrar.
 */

// ─── A tabela de regras ─────────────────────────────────────────────────────

export interface RegraFase {
  fase: Fase
  /**
   * Expressões procuradas no conteúdo da movimentação, já normalizado (minúsculas, sem
   * acento). Uma expressão pode conter espaços: "transitado em julgado" é uma frase, e
   * quebrá-la em três palavras casaria com qualquer texto que contivesse "julgado".
   */
  termos: readonly string[]
  /**
   * Termos que ANULAM o casamento quando aparecem no mesmo texto. Existem porque a
   * negação é o modo de errar mais comum do português forense: "deixo de designar
   * audiência" contém "audiência" e não marca instrução nenhuma.
   */
  excecoes?: readonly string[]
  /**
   * Movimentação que o advogado precisa ver assim que chega, mesmo sem mudar a fase
   * (grava `relevante = true`, notifica). Citação e penhora são as duas que mudam o que
   * se pode fazer amanhã de manhã.
   */
  relevante?: boolean
}

/**
 * As regras padrão, semeadas em `juridico_config.classificador` pela migração 0143.
 *
 * Ficam aqui TAMBÉM (e não só no banco) porque o job precisa de um comportamento quando
 * a linha de config sumir: classificar com a régua de fábrica é melhor que não
 * classificar — um cronograma vazio parece "processo sem andamento".
 */
export const REGRAS_FASE_PADRAO: readonly RegraFase[] = [
  {
    fase: 'distribuicao',
    termos: ['distribuido', 'distribuicao por sorteio', 'autuacao', 'protocolo da peticao inicial'],
  },
  {
    fase: 'citacao',
    termos: ['citacao', 'citado', 'mandado de citacao', 'ar positivo', 'carta precatoria para citacao'],
    // "Citação negativa" é o contrário do marco: o réu NÃO foi encontrado, e tratar isso
    // como citação faria o cronograma dizer que a fase venceu quando ela nem começou.
    excecoes: ['citacao negativa', 'ar negativo', 'nao foi possivel citar', 'frustrada'],
    relevante: true,
  },
  {
    fase: 'contestacao_embargos',
    termos: [
      'contestacao',
      'embargos a execucao',
      'embargos de devedor',
      'excecao de pre-executividade',
      'impugnacao ao cumprimento',
    ],
    relevante: true,
  },
  {
    fase: 'instrucao',
    termos: [
      'audiencia de instrucao',
      'designada audiencia',
      'saneamento',
      'especificacao de provas',
      'pericia deferida',
      'oitiva de testemunha',
    ],
    excecoes: ['deixo de designar', 'cancelada a audiencia', 'redesignada'],
  },
  {
    fase: 'sentenca',
    termos: ['sentenca', 'julgo procedente', 'julgo improcedente', 'extincao do processo', 'homologo o acordo'],
    excecoes: ['embargos de declaracao contra a sentenca'],
    relevante: true,
  },
  {
    fase: 'recurso',
    termos: ['apelacao', 'agravo de instrumento', 'recurso especial', 'recurso extraordinario', 'contrarrazoes'],
  },
  {
    fase: 'transito_julgado',
    termos: ['transitado em julgado', 'transito em julgado', 'certidao de transito'],
    relevante: true,
  },
  {
    fase: 'cumprimento_execucao',
    termos: [
      'cumprimento de sentenca',
      'inicio da execucao',
      'intimacao para pagamento',
      'art. 523',
      'penhora online',
      'sisbajud',
      'bacenjud',
    ],
    relevante: true,
  },
  {
    fase: 'penhora',
    termos: ['auto de penhora', 'penhora efetivada', 'bloqueio de valores', 'renajud', 'arresto'],
    excecoes: ['penhora negativa', 'bloqueio infrutifero', 'sem saldo'],
    relevante: true,
  },
  {
    fase: 'leilao_expropriacao',
    termos: ['leilao', 'hasta publica', 'praca', 'adjudicacao', 'expropriacao', 'edital de leilao'],
    relevante: true,
  },
  {
    fase: 'arquivamento',
    termos: ['arquivado', 'arquivamento definitivo', 'baixa definitiva', 'remessa ao arquivo'],
    excecoes: ['arquivamento provisorio', 'desarquivamento'],
  },
]

/**
 * Minúsculas, sem acento, espaços colapsados.
 *
 * O tribunal escreve "CITAÇÃO", "Citacao" e "citação" para o mesmo fato — às vezes na
 * mesma semana, porque os sistemas de origem são diferentes. Comparar cru transformaria
 * a régua num sorteio.
 */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** `Fase` no nome: `Classificacao` já existe no Crédito, e os dois saem pelo barril. */
export interface ClassificacaoFase {
  fase: Fase | null
  relevante: boolean
  /** Qual expressão casou. É o que a tela mostra quando alguém pergunta "por quê?". */
  termo: string | null
}

/**
 * A fase que ESTA movimentação marca — não a fase do processo.
 *
 * Quando duas regras casam no mesmo texto (uma sentença que já determina o cumprimento,
 * por exemplo), vence a MAIS AVANÇADA. Uma movimentação que menciona os dois marcos
 * aconteceu depois dos dois, e escolher a mais atrasada faria o relógio da fase seguinte
 * só começar na movimentação seguinte.
 */
export function classificarMovimentacao(
  conteudo: string,
  regras: readonly RegraFase[] = REGRAS_FASE_PADRAO,
): ClassificacaoFase {
  const texto = normalizarTexto(conteudo)
  let melhor: ClassificacaoFase = { fase: null, relevante: false, termo: null }

  for (const regra of regras) {
    if (regra.excecoes?.some((e) => texto.includes(normalizarTexto(e)))) continue
    const termo = regra.termos.find((t) => texto.includes(normalizarTexto(t)))
    if (!termo) continue
    if (melhor.fase === null || ordemDaFase(regra.fase) > ordemDaFase(melhor.fase)) {
      melhor = { fase: regra.fase, relevante: regra.relevante === true, termo }
    }
  }

  return melhor
}

// ─── O cronograma ───────────────────────────────────────────────────────────

export interface MovimentacaoClassificada {
  data: string
  fase_detectada: string | null
}

export interface EtapaCronograma {
  fase: Fase
  /** Data da movimentação que marcou a entrada nesta fase. */
  desde: string
  /** Data em que a fase seguinte começou. `null` na fase atual. */
  ate: string | null
  dias: number
  benchmark: number | null
  /** `dias` passou do benchmark. Só a fase ATUAL vira alerta — as passadas viram história. */
  estourou: boolean
}

const DIA_MS = 86_400_000

function diasEntre(de: string, ate: string): number {
  const a = Date.parse(`${de.slice(0, 10)}T00:00:00Z`)
  const b = Date.parse(`${ate.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.max(0, Math.round((b - a) / DIA_MS))
}

export interface Cronograma {
  etapas: EtapaCronograma[]
  fase_atual: Fase | null
  fase_desde: string | null
  dias_na_fase_atual: number
  /** Da distribuição (ou da primeira movimentação classificada) até hoje. */
  dias_total: number
  /** A fase atual estourou o benchmark. É o que acende o badge vermelho. */
  lenta: boolean
}

/**
 * O cronograma visual do detalhe do processo (§5).
 *
 * ── POR QUE AS MOVIMENTAÇÕES SÃO REORDENADAS E DEPOIS FILTRADAS ─────────────
 * A base do Escavador devolve movimentação fora de ordem com frequência (graus
 * diferentes, fontes diferentes, republicação). Ordenar por data é obrigatório antes de
 * qualquer conta de tempo. E o filtro "só as que AVANÇAM" é o que aplica a regra de que
 * a fase não retrocede: uma juntada classificada como `instrucao` depois da `penhora` é
 * descartada do cronograma, não empurra o processo de volta.
 */
export function montarCronograma(
  movimentacoes: readonly MovimentacaoClassificada[],
  benchmark: BenchmarkFases,
  hoje: Date = new Date(),
): Cronograma {
  const hojeIso = hoje.toISOString().slice(0, 10)

  const marcos: { fase: Fase; data: string }[] = []
  const ordenadas = [...movimentacoes]
    .filter((m) => m.fase_detectada !== null && ordemDaFase(m.fase_detectada) >= 0)
    .sort((a, b) => a.data.localeCompare(b.data))

  for (const m of ordenadas) {
    const fase = m.fase_detectada as Fase
    const ultima = marcos[marcos.length - 1]
    // Só avança. Repetir a mesma fase também não abre etapa nova: o relógio dela
    // começou na PRIMEIRA vez, e reiniciá-lo a cada movimentação zeraria a lentidão
    // justamente nos processos que mais se movem sem sair do lugar.
    if (ultima && ordemDaFase(fase) <= ordemDaFase(ultima.fase)) continue
    marcos.push({ fase, data: m.data.slice(0, 10) })
  }

  if (marcos.length === 0) {
    return {
      etapas: [],
      fase_atual: null,
      fase_desde: null,
      dias_na_fase_atual: 0,
      dias_total: 0,
      lenta: false,
    }
  }

  const primeiro = marcos[0] as { fase: Fase; data: string }

  const etapas: EtapaCronograma[] = marcos.map((marco, i) => {
    const proxima = marcos[i + 1]
    const ate = proxima ? proxima.data : null
    const dias = diasEntre(marco.data, ate ?? hojeIso)
    const bench = benchmark[marco.fase] ?? null
    return {
      fase: marco.fase,
      desde: marco.data,
      ate,
      dias,
      benchmark: bench,
      // Uma fase passada que demorou demais também aparece marcada — é o histórico que
      // explica por que a ação está onde está. O ALERTA (evento, notificação) é só da
      // fase atual, e essa distinção é feita por quem lê `lenta`, abaixo.
      estourou: bench !== null && dias > bench,
    }
  })

  // `marcos.length > 0` garante `etapas.length > 0`, mas o compilador não sabe disso.
  const atual = etapas[etapas.length - 1] as EtapaCronograma
  return {
    etapas,
    fase_atual: atual.fase,
    fase_desde: atual.desde,
    dias_na_fase_atual: atual.dias,
    dias_total: diasEntre(primeiro.data, hojeIso),
    lenta: atual.estourou,
  }
}
