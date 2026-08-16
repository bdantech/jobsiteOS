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
  /**
   * `everApproved` da fonte: o par empresa+papel já teve aprovação em algum momento,
   * agregado sobre todo o histórico. Quando presente, é a resposta AUTORITATIVA para
   * "foi cliente?" e dispensa qualquer inferência.
   *
   * Nulo nas linhas gravadas antes de a fonte publicar o campo — daí o fallback.
   */
  ever_approved?: boolean | null
}

/** O que o sync sabe do CNPJ FORA das análises — e que tem prioridade sobre elas. */
export interface ContextoCliente {
  /** `clientes_onepay.status` do temperature report. `'active'` blinda o CNPJ. */
  statusOnepay?: string | null
  /** Houve antecipação convertida (04e) nos últimos 60 dias? Também blinda. */
  converteuRecentemente?: boolean
  /**
   * Outro CNPJ da MESMA RAIZ (mesmos 8 primeiros dígitos) é cliente ativo.
   *
   * Filial não é empresa: é endereço da mesma pessoa jurídica. Uma análise de
   * filial que venceu enquanto a matriz opera não é saída de cliente nenhum — na
   * primeira carga isso pintou a VALKA CONSTRUÇÕES como ex-cliente QUATRO vezes,
   * uma por filial, com ela ativa o tempo todo.
   */
  raizTemClienteAtivo?: boolean
  /**
   * Outro CNPJ do mesmo GRUPO ECONÔMICO é cliente ativo.
   *
   * Herança da prática antiga de abrir análise por SPE: a SPE é veículo de obra, o
   * cliente é a holding. SPE com análise vencida e grupo operando é obra que
   * acabou, não cliente que saiu.
   */
  grupoTemClienteAtivo?: boolean
  /**
   * Há prova de OPERAÇÃO fora das análises: antecipação casada (04e) ou presença
   * histórica no temperature report.
   *
   * Existe porque `consumed_limit` é um saldo, não um acumulado: quem antecipou e
   * liquidou tudo volta a zero. Sozinho, ele produziria falso negativo justamente
   * no cliente antigo e adimplente — o que mais interessa reativar.
   */
  operouAlgumaVez?: boolean
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
  /**
   * Seria ex-cliente, mas outro CNPJ da mesma raiz ou do mesmo grupo é cliente
   * ativo. NÃO é conflito de dado — é o desenho da carteira: filial e SPE não são
   * clientes, a matriz e a holding são. Silencioso de propósito: notificar o Admin
   * a cada obra encerrada de um cliente ativo seria alarme sobre o normal.
   */
  | 'grupo_ainda_cliente'
  /** Tem análise, nenhuma aprovada. Nunca foi cliente; nada a fazer. */
  | 'sem_analise_aprovada'
  /**
   * Teve limite aprovado e **nunca operou** — nenhuma antecipação, consumo zero.
   *
   * NÃO é ex-cliente: nunca foi cliente. Aprovação não é operação, e a diferença
   * entre as duas é a diferença entre "perdemos" e "nunca ganhamos". É lead quente
   * (o crédito já saiu, falta usar), não perda.
   */
  | 'aprovado_nunca_operou'

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
 * A análise concedeu crédito em algum momento — ou seja, o CNPJ FOI cliente.
 *
 * Não é `status = 'approved'`, e essa foi a lição da primeira carga real. O
 * vocabulário do endpoint não é o que a especificação previa (`approved | expired`):
 * existem `to_approve`, `approved` e **`blocked`**, e são os `blocked` que carregam
 * as saídas — 21 de 74 na primeira corrida, TODOS com limite consumido (operaram de
 * verdade) e NENHUM presente no temperature report. Exigir `approved` fazia os 21
 * caírem em "nunca foi cliente" e a lista nascer vazia com a base cheia deles.
 *
 * A resposta certa passou a existir na fonte: **`everApproved`**, agregado sobre todo
 * o histórico do par empresa+papel e independente do filtro de status. Quando ele
 * vem, ele decide — é fato declarado, não inferência.
 *
 * O fallback por LIMITE CONCEDIDO fica para as linhas gravadas antes de o campo
 * existir. Ele acerta pelo mesmo motivo: uma análise com limite abriu a porta, tenha
 * sido bloqueada depois ou não. Uma negada não concede limite, então continua de
 * fora — que é o ponto da armadilha nº 1.
 *
 * `to_approve` sem `everApproved` e sem limite é o caso que o campo novo separa bem:
 * empresa em análise pela primeira vez nunca foi cliente, e antes ela dependia de o
 * limite ainda não ter sido preenchido para não ser confundida com uma saída.
 */
function concedeuCredito(a: AnaliseDoCnpj): boolean {
  if (a.ever_approved === true) return true
  if (a.ever_approved === false) return false
  if (normalizarStatus(a.status) === APROVADA) return true
  return Number(a.credit_limit ?? 0) > 0 || Number(a.consumed_limit ?? 0) > 0
}

/**
 * Vigente = **aprovada** E com validade hoje ou no futuro.
 *
 * Aqui o `approved` continua sendo exigido, e a assimetria com `concedeuCredito` é o
 * ponto: `blocked` com data futura NÃO é cliente vigente — a plataforma bloqueou, ele
 * não consegue operar. São 10 casos na base, todos fora do temperature report.
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

  const aprovadas = analises.filter(concedeuCredito)
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

  /*
   * A perda é do CLIENTE, e cliente é a matriz/holding — não a filial nem a SPE.
   *
   * Vem DEPOIS do conflito porque é mais específico: se o próprio CNPJ está ativo, o
   * caso é de dado divergente e alguém precisa olhar. Aqui o próprio CNPJ realmente
   * parou, e não há nada errado nisso — quem continua operando é o resto da casa.
   */
  if (contexto.raizTemClienteAtivo || contexto.grupoTemClienteAtivo) {
    return { situacao: 'grupo_ainda_cliente', exClienteDesde: null, ultimaAprovada, motivoConflito: null }
  }

  /*
   * APROVAÇÃO NÃO É OPERAÇÃO, e confundir as duas foi o que inflou a lista de 21
   * para 166.
   *
   * O grupo RFM é o caso puro: 27 empresas, uma análise para cada SPE numa leva só,
   * R$ 1 milhão de limite em cada, a mesma data de expiração — e consumo ZERO em
   * todas. Nenhuma antecipou uma nota sequer. Elas não saíram: nunca entraram.
   *
   * Na base inteira o corte é limpo: 145 dos 166 nunca consumiram, nunca tiveram
   * antecipação casada e nunca apareceram no temperature report. Os 21 que
   * consumiram são os ex-clientes de verdade — os mesmos 21 da primeira detecção.
   *
   * Chamar os 145 de perda faria a tela responder a pergunta errada com R$ 132 mi de
   * autoridade: "por que perdemos clientes?" viraria uma lista de gente que nunca
   * foi cliente.
   */
  const consumiu = analises.some((a) => Number(a.consumed_limit ?? 0) > 0)
  if (!consumiu && !contexto.operouAlgumaVez) {
    return { situacao: 'aprovado_nunca_operou', exClienteDesde: null, ultimaAprovada, motivoConflito: null }
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
