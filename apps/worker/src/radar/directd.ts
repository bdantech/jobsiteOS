import type {
  ProvedorCredito,
  ResultadoConsultaCredito,
} from '../../../../packages/core/src/radar/credit.js'
import { env } from '../env.js'
import { requisitarJson } from '../net/http.js'
import { extrair } from './directd-parser.js'

export { extrair, parseNumero, somarCartorios } from './directd-parser.js'

/**
 * Protestos DirectD (§5), implementando a porta ProvedorCredito do core.
 *
 * ─── UM ENDPOINT, DESDE 01/09/2026 ──────────────────────────────────────────
 * Havia dois: `ProtestosSP` (R$ 0,36, só cartórios de SP) e `ProtestosOnline`
 * (R$ 3,50, nacional). A DirectD consolidou as consultas numa integração direta
 * com o IEPTB e **desativou o ProtestosSP em 01/09/2026** — requisições àquele
 * endereço deixaram de ser processadas.
 *
 * O roteamento por UF morreu junto: não existe mais uma opção barata a escolher,
 * e manter a bifurcação seria manter um `if` cujo lado curto nunca executa. O
 * valor `directd_sp` continua aceito em `protestos_consultas.fonte` porque as
 * consultas antigas existem e o histórico não muda de nome quando um fornecedor
 * muda de produto.
 *
 * O efeito prático é de PREÇO, não de cobertura: onde antes se pagava R$ 0,36
 * por uma resposta que só via SP, paga-se R$ 3,50 por uma que vê o país. A
 * estimativa de lote e o botão do funil passam a mostrar sempre o preço nacional.
 */

const BASE = 'https://apiv3.directd.com.br/api'

class ProvedorDirectD implements ProvedorCredito {
  readonly fonte = 'directd_nacional'

  // Campo explícito, e não parameter property: `node --experimental-strip-types`
  // (que roda os testes) recusa `constructor(private readonly x)`.
  private readonly custo: number

  constructor(custo: number) {
    this.custo = custo
  }

  /** Nacional: cobre qualquer UF, inclusive a desconhecida. */
  cobreUf(): boolean {
    return true
  }

  async consultar(cnpj: string): Promise<ResultadoConsultaCredito> {
    const url = `${BASE}/ProtestosOnline?CNPJ=${cnpj}&TOKEN=${env.DIRECTD_API_KEY ?? ''}`
    const payload = await requisitarJson(url, { timeoutMs: 30_000, tentativas: 2 })
    return extrair(payload, this.custo)
  }
}

/** O único provedor de protesto que existe desde 01/09/2026. */
export function provedorProtestos(custoNacional: number): ProvedorCredito {
  return new ProvedorDirectD(custoNacional)
}
