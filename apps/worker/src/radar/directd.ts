import type {
  ProvedorCredito,
  ResultadoConsultaCredito,
} from '../../../../packages/core/src/radar/credit.js'
import { env } from '../env.js'
import { requisitarJson } from '../net/http.js'

/**
 * Provedores de protesto DirectD (§5), implementando a porta ProvedorCredito do core.
 * Dois endpoints, custos bem diferentes:
 *   SP       — ProtestosSP      (R$ 0,36) — só cartórios de SP.
 *   Nacional — ProtestosOnline  (R$ 3,50) — cobertura nacional.
 * Score/negativação entram depois registrando outro provedor, sem refatorar.
 */

const BASE = 'https://apiv3.directd.com.br/api'

/**
 * Um valor de protesto chega ora como number, ora como string no formato BR
 * ("293.265,96" = 293265,96): ponto é milhar, vírgula é decimal. `Number("293.265,96")`
 * é NaN — por isso o valor caía para 0 e a empresa aparecia com R$ 0 protestado.
 */
function parseNumero(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v !== 'string') return 0
  const s = v.trim()
  if (!s) return 0
  // Se há vírgula, ela é o decimal e o ponto é separador de milhar (BR). Sem vírgula,
  // o ponto (se houver) já é o decimal (US) — não o apague.
  const normal = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s
  const n = Number(normal.replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** Fallback: soma qtd/valor descendo na árvore de cartórios (por UF, senão por cartório). */
function somarCartorios(cartorios: unknown): { qtd: number; valor: number } {
  let qtd = 0
  let valor = 0
  if (!Array.isArray(cartorios)) return { qtd, valor }
  for (const uf of cartorios) {
    const e = (uf ?? {}) as Record<string, unknown>
    const qUf = parseNumero(e.totalNumProtestosUf)
    const vUf = parseNumero(e.valorTotalProtestosEstado)
    if (qUf > 0 || vUf > 0) {
      qtd += qUf
      valor += vUf
      continue
    }
    const lista = e.cartoriosProtesto ?? e.protesto
    if (Array.isArray(lista)) {
      for (const c of lista) {
        const cc = (c ?? {}) as Record<string, unknown>
        qtd += parseNumero(cc.numProtestos)
        valor += parseNumero(cc.valorTotalProtestosCartorio ?? cc.valorProtestado)
      }
    }
  }
  return { qtd, valor }
}

/** A resposta da DirectD varia por endpoint/versão; extrai defensivamente e guarda o bruto. */
function extrair(payload: unknown, custo: number): ResultadoConsultaCredito {
  const p = (payload ?? {}) as Record<string, unknown>
  const raiz = (p.retorno ?? p.RetornoProtestos ?? p.dados ?? p) as Record<string, unknown>
  const num = (...chaves: string[]): number => {
    for (const k of chaves) {
      if (k in raiz) {
        const n = parseNumero(raiz[k])
        if (n > 0) return n
      }
    }
    return 0
  }
  let qtd = num('totalNumProtestos', 'qtdTitulos', 'totalTitulos', 'TotalTitulos', 'quantidadeProtestos', 'qtdeProtestos')
  let valor = num('valorTotalProtestos', 'valorTotal', 'ValorTotal', 'valorProtestado')
  const cartorios = (raiz.protestos ?? raiz.cartorios ?? raiz.Cartorios ?? raiz.detalhes ?? null) as unknown
  // Endpoints que só devolvem o detalhe por cartório: soma o que der.
  if (qtd === 0 && valor === 0) {
    const s = somarCartorios(cartorios)
    qtd = s.qtd
    valor = s.valor
  }
  const constam = raiz.constamProtestos === true || raiz.constaProtesto === true
  const tem = constam || qtd > 0 || valor > 0 || (Array.isArray(cartorios) && cartorios.length > 0)
  return { tem_protesto: tem, qtd_protestos: qtd, valor_total: valor, cartorios, payload, custo }
}

class ProvedorDirectD implements ProvedorCredito {
  constructor(
    readonly fonte: string,
    private readonly rota: string,
    private readonly custo: number,
    private readonly soSp: boolean,
  ) {}

  cobreUf(uf: string | null): boolean {
    return this.soSp ? uf === 'SP' : true
  }

  async consultar(cnpj: string): Promise<ResultadoConsultaCredito> {
    const url = `${BASE}/${this.rota}?CNPJ=${cnpj}&TOKEN=${env.DIRECTD_API_KEY ?? ''}`
    const payload = await requisitarJson(url, { timeoutMs: 30_000, tentativas: 2 })
    return extrair(payload, this.custo)
  }
}

export function provedoresDirectD(
  custoSp: number,
  custoNacional: number,
): { sp: ProvedorCredito; nacional: ProvedorCredito } {
  return {
    sp: new ProvedorDirectD('directd_sp', 'ProtestosSP', custoSp, true),
    nacional: new ProvedorDirectD('directd_nacional', 'ProtestosOnline', custoNacional, false),
  }
}
