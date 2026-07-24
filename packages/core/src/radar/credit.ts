/**
 * Porta de provedor de dados de crédito (§5).
 *
 * Protestos hoje (DirectD SP e Nacional); score e negativação entram depois SEM
 * refatoração — basta registrar outro provedor. A implementação concreta (com
 * secret e HTTP) mora no worker, nunca no bundle do cliente; aqui é só o contrato.
 */

/** Resultado normalizado de uma consulta, independente do provedor. */
export interface ResultadoConsultaCredito {
  tem_protesto: boolean
  qtd_protestos: number
  valor_total: number
  /** Detalhe por cartório/UF, cru do provedor. */
  cartorios: unknown
  /** Resposta bruta, para auditoria/reprocessamento. */
  payload: unknown
  /** Custo real em R$ desta consulta. */
  custo: number
}

export interface ProvedorCredito {
  /** Identificador da fonte, ex.: 'directd_sp' | 'directd_nacional'. */
  readonly fonte: string
  /** Este provedor cobre a UF dada? (ex.: SP-only vs nacional). null = desconhecida. */
  cobreUf(uf: string | null): boolean
  /** Consulta protestos de um CNPJ (14 dígitos). */
  consultar(cnpj: string): Promise<ResultadoConsultaCredito>
}

/** Registro de provedores por tipo de dado — resolvido por cobertura de UF. */
export class RegistroProvedoresCredito {
  private readonly provedores = new Map<string, ProvedorCredito>()

  registrar(p: ProvedorCredito): void {
    this.provedores.set(p.fonte, p)
  }

  obter(fonte: string): ProvedorCredito | undefined {
    return this.provedores.get(fonte)
  }

  todos(): ProvedorCredito[] {
    return [...this.provedores.values()]
  }
}
