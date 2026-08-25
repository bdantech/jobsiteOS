import type { EstagioFornecedor } from './schemas.js'

/**
 * A munição do card (§3 e §5): os números que o originador olha ANTES de ligar.
 *
 * O cálculo mora aqui, e não só no SQL do job, porque a mesma conta aparece em três
 * lugares — o job que grava, o simulador do corte de volume na tela de settings, e a
 * tool de IA que responde "quanto vale este fornecedor?". Três implementações da
 * divisão por três é como o card diz 180 mil e a IA diz 200.
 */

export interface NotaDoFornecedor {
  sacado_cnpj: string
  sacado_nome: string | null
  valor: number
  /** YYYY-MM-DD */
  emitida_em: string | null
  /** YYYY-MM-DD. Null quando o XML não trouxe e o endpoint não estimou. */
  vencimento: string | null
}

export interface SacadoPrincipal {
  cnpj: string
  nome: string | null
  valor: number
  notas: number
}

export interface Municao {
  volume_90d: number
  qtd_nfs_90d: number
  /** Média ponderada por valor de (vencimento − emissão). Null se nenhuma nota tem prazo. */
  prazo_medio_dias: number | null
  sacados_principais: SacadoPrincipal[]
  potencial_mensal: number
  /** YYYY-MM-DD da nota mais recente da janela de 180 dias. */
  ultima_nf_em: string | null
}

const DIA = 86_400_000

function diasEntre(de: string, ate: string): number | null {
  const a = Date.parse(`${de}T00:00:00Z`)
  const b = Date.parse(`${ate}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.round((b - a) / DIA)
}

/**
 * `potencial_mensal = volume 90d ÷ 3`.
 *
 * É a conta mais simples possível e isso é deliberado: ela responde "quanto ele
 * fatura por mês contra nossos sacados", não "quanto ele vai antecipar". A segunda
 * pergunta depende de apetite, prazo e limite do sacado — e um número que finge
 * responder a ela colocaria o originador numa ligação com uma expectativa que não é
 * dele para prometer.
 *
 * O LIMITE DO SACADO NÃO ENTRA (§3, explícito). Ele é o teto da operação, não do
 * lead: um fornecedor de R$ 900 mil/mês contra um sacado com limite estourado
 * continua sendo o melhor telefone da lista — o limite se resolve com análise, o
 * fornecedor grande não aparece por decreto.
 */
export function calcularMunicao(
  notas: readonly NotaDoFornecedor[],
  opcoes: { hoje?: Date; maxSacados?: number } = {},
): Municao {
  const hoje = opcoes.hoje ?? new Date()
  const corte = new Date(hoje.getTime() - 90 * DIA).toISOString().slice(0, 10)
  const maxSacados = opcoes.maxSacados ?? 5

  let volume = 0
  let qtd = 0
  let somaPrazoPonderada = 0
  let pesoPrazo = 0
  let ultima: string | null = null

  const porSacado = new Map<string, SacadoPrincipal>()

  for (const n of notas) {
    const dia = n.emitida_em?.slice(0, 10) ?? null
    if (dia && (!ultima || dia > ultima)) ultima = dia
    if (!dia || dia < corte) continue

    const valor = Number(n.valor) || 0
    volume += valor
    qtd += 1

    if (n.vencimento) {
      const d = diasEntre(dia, n.vencimento.slice(0, 10))
      // Prazo negativo é nota vencida antes de emitida — dado corrompido, não um
      // prazo de zero dia. Entra na contagem de volume e fica fora da média.
      if (d !== null && d >= 0 && d <= 365) {
        somaPrazoPonderada += d * valor
        pesoPrazo += valor
      }
    }

    const s = porSacado.get(n.sacado_cnpj) ?? {
      cnpj: n.sacado_cnpj,
      nome: n.sacado_nome,
      valor: 0,
      notas: 0,
    }
    s.valor += valor
    s.notas += 1
    if (!s.nome && n.sacado_nome) s.nome = n.sacado_nome
    porSacado.set(n.sacado_cnpj, s)
  }

  return {
    volume_90d: Math.round(volume * 100) / 100,
    qtd_nfs_90d: qtd,
    // Ponderada por valor, não simples: uma nota de R$ 500 a 7 dias e uma de R$ 500
    // mil a 90 não têm o mesmo peso na decisão de quem vai operar essa carteira.
    prazo_medio_dias: pesoPrazo > 0 ? Math.round(somaPrazoPonderada / pesoPrazo) : null,
    sacados_principais: [...porSacado.values()]
      .sort((a, b) => b.valor - a.valor || b.notas - a.notas)
      .slice(0, maxSacados)
      .map((s) => ({ ...s, valor: Math.round(s.valor * 100) / 100 })),
    potencial_mensal: Math.round((volume / 3) * 100) / 100,
    ultima_nf_em: ultima,
  }
}

/**
 * Entra no funil? (§3)
 *
 * Sem o corte a lista tem 7.892 fornecedores; com ele, 688 — que somam R$ 289,2
 * milhões em 90 dias. Não é filtro de conveniência: uma lista de oito mil nomes não é
 * um funil, é a mesma lista morta com kanban em volta. O corte é o que faz a
 * ordenação por potencial significar alguma coisa.
 */
export function entraNoFunil(municao: Municao, corteVolume: number): boolean {
  return municao.volume_90d >= corteVolume
}

/**
 * Estágios em que um fornecedor não deve reaparecer por conta do volume.
 *
 * `cadastrado` é ganho e `sem_interesse` é suprimido — ressuscitar qualquer um dos
 * dois porque ele emitiu mais notas transformaria o job numa máquina de reabrir
 * conversa encerrada. A supressão soft já tem a sua própria data de volta.
 */
export const ESTAGIOS_TERMINAIS: readonly EstagioFornecedor[] = ['cadastrado', 'sem_interesse']
