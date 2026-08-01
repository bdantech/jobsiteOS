import { isGrupo, type Condicao, type Grupo, type No } from '../mercado/filters.js'
import type { AuditoriaCamada, CondicaoBarreira } from './auditoria.js'
import {
  liftRelevante,
  type AchadoContraste,
  type ParametrosContraste,
} from './contraste.js'
import type { LinhaPerfil, VariavelPerfil } from './variaveis.js'

/**
 * O motor de sugestões (04f §6) — o um-clique.
 *
 * Dois padrões, e nada além deles:
 *
 *   1. AFROUXAR o que barra operadores. Se uma condição da regra vigente exclui
 *      uma fatia grande de quem comprovadamente opera, ela está cobrando um
 *      preço que a evidência não sustenta.
 *
 *   2. ADICIONAR sinal com lift alto que a regra ainda não usa.
 *
 * Nenhuma sugestão APLICA nada. Cada uma carrega a árvore proposta inteira, e o
 * botão abre o editor da regra com ela já no rascunho — o fluxo normal segue:
 * preview de impacto, depois ativação humana. É a mesma razão pela qual a
 * calibração da carteira (04e §5) não se aplica sozinha: uma régua que se
 * reescreve sem ninguém olhando é uma régua em que ninguém confia.
 *
 * O que este arquivo DELIBERADAMENTE não faz: apertar. Sugerir exclusão a partir
 * de lift baixo transformaria um viés de amostragem ("nunca prospectamos no
 * Norte") numa regra que garante que nunca prospectaremos — o exato mecanismo que
 * o aviso de viés do rodapé existe para denunciar.
 */

export interface ParametrosSugestao extends ParametrosContraste {
  /** Fração da coorte operadora barrada a partir da qual vale afrouxar. */
  fracao_barrada_minima: number
  /** Fração da coorte que o novo corte deve passar a incluir. */
  cobertura_alvo: number
}

export const PARAMETROS_SUGESTAO_PADRAO: ParametrosSugestao = {
  n_minimo: 15,
  cobertura_minima: 0.4,
  lift_minimo: 2,
  fracao_barrada_minima: 0.1,
  cobertura_alvo: 0.95,
}

export type TipoSugestao = 'afrouxar' | 'adicionar_sinal'

export interface AlvoSugestao {
  tipo: 'camada' | 'faixa'
  /** 'som' | 'sam' | 'tam' — ou 'alta' | 'boa' | 'media'. */
  chave: string
  /** Versão vigente no momento em que a sugestão foi gerada. */
  versao: number
}

export interface Sugestao {
  /** Estável dentro de um snapshot — é a chave que o log e a UI usam. */
  id: string
  tipo: TipoSugestao
  trilha: 'sacados' | 'fornecedores'
  alvo: AlvoSugestao
  /** A frase do card, em português e sem jargão. */
  frase: string
  /** O detalhe técnico, para o "ver como calculamos". */
  detalhe: string
  de: string
  para: string
  /** A árvore COMPLETA já com o ajuste. É ela que abre o editor. */
  definicao_proposta: Grupo
  evidencia: {
    variavel: string
    categoria?: string
    lift?: number | null
    n_a?: number
    n_b?: number
    barrados?: number
    fracao?: number
  }
}

// ─── Números redondos ───────────────────────────────────────────────────────

/**
 * Um corte que uma pessoa reconheceria: 3, não 2,7; 500 mil, não 483.219.
 *
 * Não é cosmético. O corte proposto vai virar uma regra que alguém defende numa
 * reunião, e "capital ≥ R$ 483.219" não se defende — a primeira pergunta é "de
 * onde saiu esse número?", e a resposta honesta ("é o percentil 5 de 34
 * empresas") destrói a sugestão em vez de sustentá-la.
 */
export function arredondarParaBaixo(valor: number): number {
  if (valor <= 0) return 0
  if (valor < 1) return Math.floor(valor * 20) / 20
  if (valor < 10) return Math.floor(valor)
  const magnitude = 10 ** Math.floor(Math.log10(valor))
  const passo = magnitude / 2
  return Math.floor(valor / passo) * passo
}

/**
 * O valor que passa a incluir `cobertura` da coorte, olhando de baixo.
 *
 * Deliberadamente um PERCENTIL e não o mínimo: uma única empresa recém-aberta na
 * coorte de operadores puxaria o corte de idade para zero, e a regra deixaria de
 * filtrar qualquer coisa.
 */
export function corteQueInclui(
  valores: readonly number[],
  cobertura: number,
): number | null {
  const ordenados = valores.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (ordenados.length === 0) return null
  const indice = Math.floor((1 - cobertura) * ordenados.length)
  return ordenados[Math.min(indice, ordenados.length - 1)] ?? null
}

// ─── Leitura da árvore ──────────────────────────────────────────────────────

function variaveisDaArvore(no: No, saida: Set<string> = new Set()): Set<string> {
  if (isGrupo(no)) {
    for (const c of no.condicoes) variaveisDaArvore(c, saida)
  } else {
    saida.add(no.variavel)
  }
  return saida
}

/** Troca o nó de índice `i` do topo, sem mutar a árvore original. */
function substituirNoTopo(arvore: Grupo, indice: number, novo: No): Grupo {
  return {
    operador: arvore.operador,
    condicoes: arvore.condicoes.map((c, i) => (i === indice ? novo : c)),
  }
}

function adicionarNoTopo(arvore: Grupo, novo: No): Grupo {
  return { operador: arvore.operador, condicoes: [...arvore.condicoes, novo] }
}

function ehCondicao(no: No): no is Condicao {
  return !isGrupo(no)
}

// ─── Padrão 1: afrouxar ─────────────────────────────────────────────────────

/**
 * Só condições NUMÉRICAS de piso/teto e listas são afrouxáveis.
 *
 * `situacao_cadastral = ativa` barra empresas baixadas, e afrouxar isso não é
 * uma sugestão — é um bug. O mesmo vale para os booleanos de recorte
 * (`fora_recorte_cnae = false`). O gerador se cala nesses casos em vez de
 * inventar um ajuste plausível.
 */
const OPERADORES_AFROUXAVEIS = new Set(['maior_ou_igual', 'maior_que', 'menor_ou_igual', 'menor_que', 'em'])

function afrouxarCondicao(
  cond: Condicao,
  valores: readonly unknown[],
  params: ParametrosSugestao,
): { nova: Condicao; de: string; para: string } | null {
  if (!OPERADORES_AFROUXAVEIS.has(cond.operador)) return null

  if (cond.operador === 'em') {
    const atuais = new Set((cond.valor as unknown[]).map(String))
    const faltantes = [...new Set(valores.filter((v) => v !== null && v !== undefined).map(String))]
      .filter((v) => !atuais.has(v))
      .sort()
    if (faltantes.length === 0) return null
    const novaLista = [...atuais, ...faltantes]
    return {
      nova: { ...cond, valor: novaLista },
      de: [...atuais].join(', '),
      para: novaLista.join(', '),
    }
  }

  const numeros = valores.map(Number).filter((n) => Number.isFinite(n))
  const corte = corteQueInclui(numeros, params.cobertura_alvo)
  if (corte === null) return null

  const atual = Number(cond.valor)
  if (!Number.isFinite(atual)) return null

  const ehPiso = cond.operador === 'maior_ou_igual' || cond.operador === 'maior_que'
  const proposto = ehPiso ? arredondarParaBaixo(corte) : Math.ceil(corte)

  // Afrouxar significa mover na direção que INCLUI mais. Se o corte calculado já
  // é mais restritivo que o vigente, não há sugestão — a regra não é o problema.
  if (ehPiso ? proposto >= atual : proposto <= atual) return null

  return {
    nova: { ...cond, valor: proposto },
    de: String(atual),
    para: String(proposto),
  }
}

// ─── O gerador ──────────────────────────────────────────────────────────────

export interface EntradaSugestoes {
  trilha: 'sacados' | 'fornecedores'
  /** Auditoria das camadas (trilha sacados) — de onde saem os "afrouxar". */
  auditorias: readonly AuditoriaCamada[]
  /** Achados do contraste — de onde saem os "adicionar sinal". */
  achados: readonly AchadoContraste[]
  /** As linhas CRUAS da coorte operadora, para calcular o corte proposto. */
  linhas: readonly LinhaPerfil[]
  /** Catálogo da trilha, para ligar achado → condição. */
  variaveis: readonly VariavelPerfil[]
  /** Alvo dos "adicionar sinal": a regra que ganha o novo termo. */
  alvoSinal: AlvoSugestao | null
  /** Árvore vigente do alvo acima. */
  definicaoSinal: Grupo | null
  /** Rótulo humano da coorte operadora, para a frase. */
  rotuloCoorte: string
  descrever: (no: No) => string
  rotuloVariavel: (id: string) => string
}

export function gerarSugestoes(
  entrada: EntradaSugestoes,
  params: ParametrosSugestao = PARAMETROS_SUGESTAO_PADRAO,
): Sugestao[] {
  return [...afrouxamentos(entrada, params), ...novosSinais(entrada, params)]
}

function afrouxamentos(entrada: EntradaSugestoes, params: ParametrosSugestao): Sugestao[] {
  const saida: Sugestao[] = []

  for (const auditoria of entrada.auditorias) {
    if (!auditoria.definicao || auditoria.total === 0) continue

    for (const barreira of auditoria.barreiras) {
      if (barreira.fracao < params.fracao_barrada_minima) continue
      if (!ehCondicao(barreira.no)) continue

      const cond = barreira.no
      const valores = entrada.linhas.map((l) => l[cond.variavel])
      const ajuste = afrouxarCondicao(cond, valores, params)
      if (!ajuste) continue

      const rotulo = entrada.rotuloVariavel(cond.variavel)
      const pct = Math.round(barreira.fracao * 100)

      saida.push({
        id: `afrouxar:${auditoria.camada}:${barreira.indice}`,
        tipo: 'afrouxar',
        trilha: entrada.trilha,
        alvo: { tipo: 'camada', chave: auditoria.camada, versao: auditoria.versao },
        frase:
          `${pct}% dos ${entrada.rotuloCoorte} não passariam na regra de ` +
          `${auditoria.camada.toUpperCase()} por causa de "${rotulo}".`,
        detalhe:
          `A condição "${barreira.descricao}" sozinha reprova ${barreira.barrados} de ` +
          `${auditoria.total}. Mudar de ${ajuste.de} para ${ajuste.para} passa a incluir ` +
          `${Math.round(params.cobertura_alvo * 100)}% da coorte.`,
        de: `${rotulo}: ${ajuste.de}`,
        para: `${rotulo}: ${ajuste.para}`,
        definicao_proposta: substituirNoTopo(auditoria.definicao, barreira.indice, ajuste.nova),
        evidencia: {
          variavel: cond.variavel,
          barrados: barreira.barrados,
          fracao: barreira.fracao,
        },
      })
    }
  }

  return saida
}

function novosSinais(entrada: EntradaSugestoes, params: ParametrosSugestao): Sugestao[] {
  const { alvoSinal, definicaoSinal } = entrada
  if (!alvoSinal || !definicaoSinal) return []

  const jaNaRegra = variaveisDaArvore(definicaoSinal)
  const saida: Sugestao[] = []

  for (const achado of entrada.achados) {
    if (achado.suprimido) continue
    const destaque = achado.destaque
    if (!liftRelevante(destaque, params)) continue
    // Lift ABAIXO de 1 significa "opera menos" — vira evidência para apertar, e
    // apertar não é um padrão deste gerador (ver o comentário do topo).
    if (!destaque || destaque.lift === null || destaque.lift < 1) continue

    const variavel = entrada.variaveis.find((v) => v.id === achado.variavel)
    if (!variavel?.regra) continue
    if (jaNaRegra.has(variavel.regra.variavel)) continue

    const cond = variavel.regra.condicaoDe(destaque.chave)
    if (!cond) continue

    saida.push({
      id: `sinal:${alvoSinal.tipo}:${alvoSinal.chave}:${achado.variavel}`,
      tipo: 'adicionar_sinal',
      trilha: entrada.trilha,
      alvo: alvoSinal,
      frase:
        `${entrada.rotuloCoorte} com "${variavel.label}: ${destaque.chave}" aparecem ` +
        `${formatarLift(destaque.lift)} mais que no grupo de comparação.`,
      detalhe:
        `${destaque.n_a} de ${achado.n_a} (${pct(destaque.prevalencia_a)}) contra ` +
        `${destaque.n_b} de ${achado.n_b} (${pct(destaque.prevalencia_b)}). ` +
        `Esta variável ainda não aparece na regra vigente.`,
      de: entrada.descrever(definicaoSinal),
      para: `… E ${entrada.descrever(cond)}`,
      definicao_proposta: adicionarNoTopo(definicaoSinal, cond),
      evidencia: {
        variavel: achado.variavel,
        categoria: destaque.chave,
        lift: destaque.lift,
        n_a: destaque.n_a,
        n_b: destaque.n_b,
      },
    })
  }

  return saida
}

export function formatarLift(lift: number | null): string {
  if (lift === null) return '—'
  return `${lift.toFixed(1).replace('.', ',')}×`
}

function pct(fracao: number): string {
  return `${Math.round(fracao * 100)}%`
}

/** Exporta o helper de leitura da árvore — o gerador e a UI precisam da mesma resposta. */
export function variaveisUsadas(arvore: Grupo): string[] {
  return [...variaveisDaArvore(arvore)]
}
