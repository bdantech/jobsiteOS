/**
 * O pitch do SDR: o dossiê que a base sabe montar, e o texto que o modelo escreve
 * a partir dele.
 *
 * ─── POR QUE A AGREGAÇÃO MORA AQUI ──────────────────────────────────────────
 * O worker monta o dossiê, a tela mostra os mesmos números ao lado do texto, e um
 * dia a tool de IA vai responder "por que esta empresa?" com eles. Três somas do
 * mesmo conjunto de notas é como o pitch diz cinco fornecedores e o card diz seis.
 *
 * ─── É O ESPELHO DA MUNIÇÃO, E NÃO ELA ──────────────────────────────────────
 * `calcularMunicao` (Fornecedores, 04l) responde "quanto este FORNECEDOR emite, e
 * contra quem". Aqui a pergunta é a inversa — "quem emite contra esta
 * CONSTRUTORA, e com que prazo" — e a inversa tem consequências diferentes: o
 * prazo médio não é apetite de antecipação, é o prazo que ela já pratica com a
 * cadeia, ou seja, o número em cima do qual se conversa sobre alongar.
 */

/** Uma nota emitida CONTRA a empresa do lead. O lado sacado da relação. */
export interface NotaContraOSacado {
  fornecedor_cnpj: string | null
  fornecedor_nome: string | null
  /** Se este fornecedor já é cadastrado na plataforma — muda o pitch inteiro. */
  fornecedor_cadastrado: boolean | null
  valor: number | null
  /** YYYY-MM-DD */
  emitida_em: string | null
  /** YYYY-MM-DD. Null quando o XML não trouxe e o endpoint não estimou. */
  vencimento: string | null
}

export interface FornecedorEngajado {
  cnpj: string
  nome: string | null
  valor: number
  notas: number
  /** Já é cadastrado na plataforma. Vira "seu fornecedor X já antecipa com a gente". */
  cadastrado: boolean
}

export interface CadeiaDoSacado {
  /** Quantas notas entraram na janela. */
  notas: number
  valor_total: number
  /** Média ponderada por valor de (vencimento − emissão). Null se nenhuma nota tem prazo. */
  prazo_medio_dias: number | null
  /** Quantos CNPJs distintos emitem contra ela. */
  fornecedores_distintos: number
  /** Quantos deles já são cadastrados na plataforma. */
  fornecedores_cadastrados: number
  /** Os maiores por valor, para citar pelo nome na ligação. */
  principais: FornecedorEngajado[]
  /** YYYY-MM-DD da nota mais recente da janela. */
  ultima_nota_em: string | null
}

const DIA = 86_400_000

function diasEntre(de: string, ate: string): number | null {
  const a = Date.parse(`${de}T00:00:00Z`)
  const b = Date.parse(`${ate}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.round((b - a) / DIA)
}

/**
 * Quem emite contra esta empresa, quanto, e com que prazo.
 *
 * A JANELA É DE 180 DIAS, e não os 90 da munição: aqui não se está medindo apetite
 * corrente de antecipação, e sim provando conhecimento da cadeia. Um fornecedor que
 * emitiu R$ 400 mil há cinco meses continua sendo um nome que abre a conversa —
 * "vocês trabalham com a X, não é?" — enquanto para o funil de notas ele já é velho.
 *
 * `nome` vem da nota, não do cadastro: é o nome pelo qual QUEM ATENDE o telefone
 * conhece o fornecedor, e é esse que o SDR precisa dizer em voz alta.
 */
export function resumirCadeiaDoSacado(
  notas: readonly NotaContraOSacado[],
  opcoes: { janelaDias?: number; hoje?: Date; maxPrincipais?: number } = {},
): CadeiaDoSacado {
  const hoje = opcoes.hoje ?? new Date()
  const janela = opcoes.janelaDias ?? 180
  const corte = new Date(hoje.getTime() - janela * DIA).toISOString().slice(0, 10)
  const maxPrincipais = opcoes.maxPrincipais ?? 5

  const porFornecedor = new Map<string, FornecedorEngajado>()
  let valorTotal = 0
  let qtd = 0
  let somaPrazoPonderada = 0
  let pesoPrazo = 0
  let ultima: string | null = null

  for (const n of notas) {
    const dia = n.emitida_em?.slice(0, 10) ?? null
    if (!dia || dia < corte) continue
    if (!ultima || dia > ultima) ultima = dia

    const valor = Number(n.valor) || 0
    valorTotal += valor
    qtd += 1

    if (n.vencimento) {
      const d = diasEntre(dia, n.vencimento.slice(0, 10))
      // Prazo negativo é nota vencida antes de emitida — dado corrompido. Ponderar
      // por valor (e não a média simples) porque é a nota grande que define o prazo
      // que a tesouraria sente.
      if (d !== null && d >= 0 && valor > 0) {
        somaPrazoPonderada += d * valor
        pesoPrazo += valor
      }
    }

    // Sem CNPJ não dá para agrupar nem para checar protesto. O valor continua
    // contando no total: ele aconteceu.
    const cnpj = n.fornecedor_cnpj
    if (!cnpj) continue
    const atual = porFornecedor.get(cnpj)
    if (atual) {
      atual.valor += valor
      atual.notas += 1
      atual.cadastrado = atual.cadastrado || n.fornecedor_cadastrado === true
      atual.nome = atual.nome ?? n.fornecedor_nome
    } else {
      porFornecedor.set(cnpj, {
        cnpj,
        nome: n.fornecedor_nome,
        valor,
        notas: 1,
        cadastrado: n.fornecedor_cadastrado === true,
      })
    }
  }

  const todos = [...porFornecedor.values()].sort((a, b) => b.valor - a.valor)

  return {
    notas: qtd,
    valor_total: Math.round(valorTotal * 100) / 100,
    prazo_medio_dias: pesoPrazo > 0 ? Math.round(somaPrazoPonderada / pesoPrazo) : null,
    fornecedores_distintos: todos.length,
    fornecedores_cadastrados: todos.filter((f) => f.cadastrado).length,
    principais: todos.slice(0, maxPrincipais),
    ultima_nota_em: ultima,
  }
}

// ─── O texto ────────────────────────────────────────────────────────────────

/**
 * O que o modelo devolve, e o que a tela mostra.
 *
 * Cinco campos e não um blocão de texto: o SDR lê isto com o telefone tocando, e
 * "abertura" é a única parte que ele lê em voz alta. Um texto único obrigaria a
 * procurar, no meio da própria leitura, onde termina o que se fala e começa o que
 * só se sabe.
 */
export interface PitchDoLead {
  /** As duas primeiras frases da ligação, prontas para ler. */
  abertura: string
  /** Quem é a empresa: região, porte, momento de vida. */
  contexto: string
  /** Por que o produto interessa a ELA. */
  angulo: string
  /** Com quem se fala e como esse cargo pensa. Null quando não há contato na base. */
  persona: string | null
  /** Os pontos a levantar durante a ligação. */
  pontos: string[]
  /** Expressões da região/segmento, para não soar de fora. */
  jargoes: string[]
}
