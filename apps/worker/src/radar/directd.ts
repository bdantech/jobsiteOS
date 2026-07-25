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

/** A resposta da DirectD varia por endpoint/versão; extrai defensivamente e guarda o bruto. */
function extrair(payload: unknown, custo: number): ResultadoConsultaCredito {
  const p = (payload ?? {}) as Record<string, unknown>
  const raiz = (p.retorno ?? p.RetornoProtestos ?? p.dados ?? p) as Record<string, unknown>
  const num = (...chaves: string[]): number => {
    for (const k of chaves) {
      const v = Number(raiz[k])
      if (Number.isFinite(v)) return v
    }
    return 0
  }
  const qtd = num('qtdTitulos', 'totalTitulos', 'TotalTitulos', 'quantidadeProtestos', 'qtdeProtestos')
  const valor = num('valorTotal', 'ValorTotal', 'valorProtestado', 'valorTotalProtestos')
  const cartorios = (raiz.cartorios ?? raiz.Cartorios ?? raiz.detalhes ?? raiz.protestos ?? null) as unknown
  const tem = qtd > 0 || valor > 0 || (Array.isArray(cartorios) && cartorios.length > 0)
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
