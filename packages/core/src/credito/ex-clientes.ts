/**
 * Quem é ex-cliente, decidido a partir das análises de crédito da plataforma (04h §3).
 *
 * A função é PURA e mora aqui, e não dentro do job do worker, porque a regra tem
 * quatro saídas e três armadilhas, e nenhuma delas se testa contra um endpoint
 * paginado. O worker busca e grava; quem decide é isto.
 *
 * AS TRÊS ARMADILHAS, na ordem em que mordem:
 *
 *  1. "Não tem análise vigente" NÃO é o mesmo que "foi cliente e saiu". Uma empresa
 *     que só teve análise negada nunca foi cliente — rebaixá-la para `ex_cliente`
 *     inventaria uma perda que não houve, e ainda a tiraria da fila de prospecção.
 *     Por isso exige-se ao menos uma análise APROVADA no passado.
 *
 *  2. `company.id`/`company.name` nulos é a "regra de ouro" da fonte: a empresa teve
 *     análise mas nunca foi cadastrada na plataforma. Nunca foi cliente, logo não
 *     pode ser ex. É outra coisa — e uma coisa valiosa: análise paga, aprovada, e
 *     ninguém operou.
 *
 *  3. O temperature report GANHA SEMPRE. Se o CNPJ está lá como `active`, ou
 *     converteu antecipação há pouco, a análise vencida é atraso de cadastro na
 *     plataforma, não saída do cliente. Rebaixar aqui apagaria um cliente ativo da
 *     carteira de alguém — por isso o caso vira CONFLITO (alguém olha), não decisão.
 */

/** Uma linha de `analises_plataforma`, no mínimo que a classificação precisa. */
export interface AnaliseDoCnpj {
  status: string | null
  /** ISO `YYYY-MM-DD`. Nulo = análise sem validade declarada. */
  expiration_date: string | null
  empresa_cadastrada: boolean
  credit_limit?: number | null
  consumed_limit?: number | null
  monthly_rate_d0?: number | null
}

/** O que o sync sabe do CNPJ FORA das análises — e que tem prioridade sobre elas. */
export interface ContextoCliente {
  /** `clientes_onepay.status` do temperature report. `'active'` blinda o CNPJ. */
  statusOnepay?: string | null
  /** Houve antecipação convertida (04e) nos últimos 60 dias? Também blinda. */
  converteuRecentemente?: boolean
}

export type SituacaoCnpj =
  /** Tem análise aprovada valendo hoje. Este sync não mexe — quem promove é o 03. */
  | 'analise_vigente'
  /** Teve aprovada, não tem vigente, e É cadastrada. Rebaixa para `ex_cliente`. */
  | 'ex_cliente'
  /** Aprovada (vigente ou não) sem cadastro na plataforma. Nunca operou. */
  | 'analise_sem_cadastro'
  /** Seria ex-cliente, mas o temperature report diz que está ativo. Ninguém rebaixa. */
  | 'conflito'
  /** Tem análise, nenhuma aprovada. Nunca foi cliente; nada a fazer. */
  | 'sem_analise_aprovada'

export interface Classificacao {
  situacao: SituacaoCnpj
  /** A maior `expiration_date` entre as análises aprovadas. Só em `ex_cliente`. */
  exClienteDesde: string | null
  /** Dados da análise aprovada mais recente, para a lista e para o snapshot. */
  ultimaAprovada: AnaliseDoCnpj | null
  /** Por que houve conflito — vai no payload do evento que pede revisão humana. */
  motivoConflito: 'cliente_ativo_no_temperature_report' | 'conversao_recente' | null
}

const APROVADA = 'approved'

function normalizarStatus(status: string | null): string {
  return (status ?? '').trim().toLowerCase()
}

/**
 * Vigente = aprovada E com validade hoje ou no futuro.
 *
 * Análise aprovada SEM `expiration_date` conta como vigente, e é decisão: a data é o
 * que a plataforma usa para expirar, e sua ausência significa "sem prazo definido",
 * não "venceu". Tratá-la como vencida rebaixaria a cliente por um campo em branco.
 */
function vigente(a: AnaliseDoCnpj, hojeIso: string): boolean {
  if (normalizarStatus(a.status) !== APROVADA) return false
  if (!a.expiration_date) return true
  return a.expiration_date >= hojeIso
}

function maisRecente(a: AnaliseDoCnpj, b: AnaliseDoCnpj): AnaliseDoCnpj {
  // Sem data vai para o fim: entre uma aprovada datada e uma sem data, a datada é a
  // que consegue responder "desde quando".
  if (!a.expiration_date) return b
  if (!b.expiration_date) return a
  return a.expiration_date >= b.expiration_date ? a : b
}

/**
 * Classifica UM CNPJ a partir de TODAS as análises `drawee` dele.
 *
 * `hojeIso` entra como parâmetro (e não `new Date()` aqui dentro) porque a fronteira
 * "expirou ontem / expira hoje" é exatamente o que os testes precisam fixar.
 */
export function classificarCnpj(
  analises: readonly AnaliseDoCnpj[],
  contexto: ContextoCliente = {},
  hojeIso: string = new Date().toISOString().slice(0, 10),
): Classificacao {
  const vazio: Classificacao = {
    situacao: 'sem_analise_aprovada',
    exClienteDesde: null,
    ultimaAprovada: null,
    motivoConflito: null,
  }
  if (analises.length === 0) return vazio

  const aprovadas = analises.filter((a) => normalizarStatus(a.status) === APROVADA)
  if (aprovadas.length === 0) return vazio

  const ultimaAprovada = aprovadas.reduce(maisRecente)

  // A "regra de ouro" vem ANTES da vigência: sem cadastro, o CNPJ não é cliente nem
  // ex-cliente, tenha a análise vencido ou não. É uma terceira categoria inteira.
  //
  // Vale sobre TODAS as aprovadas, e não sobre a última: basta uma aprovada com
  // cadastro para a empresa ter existido na plataforma, e aí ela é cliente ou ex.
  const algumaCadastrada = aprovadas.some((a) => a.empresa_cadastrada)
  if (!algumaCadastrada) {
    return { situacao: 'analise_sem_cadastro', exClienteDesde: null, ultimaAprovada, motivoConflito: null }
  }

  if (aprovadas.some((a) => vigente(a, hojeIso))) {
    return { situacao: 'analise_vigente', exClienteDesde: null, ultimaAprovada, motivoConflito: null }
  }

  // Daqui para baixo: teve aprovada, é cadastrada, nenhuma vale hoje. É o candidato a
  // ex-cliente — a menos que o temperature report discorde.
  const motivoConflito: Classificacao['motivoConflito'] =
    normalizarStatus(contexto.statusOnepay ?? null) === 'active'
      ? 'cliente_ativo_no_temperature_report'
      : contexto.converteuRecentemente
        ? 'conversao_recente'
        : null

  if (motivoConflito) {
    return { situacao: 'conflito', exClienteDesde: null, ultimaAprovada, motivoConflito }
  }

  // `exClienteDesde` é a MAIOR expiração entre as aprovadas: é o dia em que a última
  // porta se fechou. A menor diria a data de uma análise que foi substituída.
  const datas = aprovadas.map((a) => a.expiration_date).filter((d): d is string => Boolean(d))
  const exClienteDesde = datas.length > 0 ? datas.reduce((a, b) => (a >= b ? a : b)) : null

  return { situacao: 'ex_cliente', exClienteDesde, ultimaAprovada, motivoConflito: null }
}

/** Quantos meses inteiros desde a saída. É o "há X meses" da lista de ex-clientes. */
export function mesesDesde(
  desdeIso: string | null | undefined,
  hojeIso: string = new Date().toISOString().slice(0, 10),
): number | null {
  if (!desdeIso) return null
  const [ay, am, ad] = desdeIso.split('-').map(Number)
  const [by, bm, bd] = hojeIso.split('-').map(Number)
  if (!ay || !am || !ad || !by || !bm || !bd) return null
  let meses = (by - ay) * 12 + (bm - am)
  // O mês só fecha quando o DIA passa: 15/01 → 14/02 é zero mês, não um.
  if (bd < ad) meses--
  return Math.max(0, meses)
}
